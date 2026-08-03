const http = require("http");
const fs = require("fs");
const path = require("path");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);
const ROOT_DIR = __dirname;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT_DIR, "..", "kcit-private"));
const SUBMISSIONS_FILE = path.join(DATA_DIR, "contact-submissions.txt");
const LEGACY_SUBMISSIONS_FILE = path.join(ROOT_DIR, "submissions", "contact-submissions.txt");
const BODY_LIMIT_BYTES = Number(process.env.BODY_LIMIT_BYTES || 16 * 1024);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 10 * 60 * 1000);
const RATE_LIMIT_MAX_SUBMISSIONS = Number(process.env.RATE_LIMIT_MAX_SUBMISSIONS || 5);
const MAILGUN_API_KEY = String(process.env.MAILGUN_API_KEY || "").trim();
const MAILGUN_DOMAIN = String(process.env.MAILGUN_DOMAIN || "").trim();
const MAILGUN_TO = String(process.env.MAILGUN_TO || "").trim();
const MAILGUN_FROM = String(
  process.env.MAILGUN_FROM ||
    (MAILGUN_DOMAIN ? `Kelley Computers Website <postmaster@${MAILGUN_DOMAIN}>` : "")
).trim();
const MAILGUN_API_BASE = normalizeMailgunApiBase(
  process.env.MAILGUN_API_BASE || "https://api.mailgun.net"
);
const MAILGUN_TIMEOUT_MS = Number(process.env.MAILGUN_TIMEOUT_MS || 10 * 1000);
const TRUSTED_PROXY_IPS = new Set(
  String(process.env.TRUSTED_PROXY_IPS || "127.0.0.1,::1")
    .split(",")
    .map((address) => normalizeIpAddress(address))
    .filter(Boolean)
);
const ALLOWED_SERVICES = new Set([
  "Business IT",
  "Managed Networks",
  "Business IT + Managed Networks"
]);

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".xml": "application/xml; charset=utf-8"
};

const PAGE_ALIASES = {
  "/": "/index.html",
  "/business-it": "/business-it.html",
  "/contact": "/contact.html",
  "/contact-development": "/contact-development.html",
  "/index": "/index.html",
  "/managed-networks": "/managed-networks.html",
  "/under-development": "/under-development.html"
};

const PUBLIC_PAGE_FILES = new Set(Object.values(PAGE_ALIASES));
const PUBLIC_ROOT_FILES = new Set(["/robots.txt", "/sitemap.xml"]);
const PUBLIC_PATH_PREFIXES = ["/assets/", "/scripts/", "/styles/"];
const DEFAULT_ALLOWED_ORIGINS = [
  "https://kelleycomputers-it.com",
  "https://www.kelleycomputers-it.com",
  "http://kelleycomputers-it.com",
  "http://www.kelleycomputers-it.com",
  "http://localhost",
  "http://localhost:3000",
  "http://127.0.0.1",
  "http://127.0.0.1:3000"
];
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(","))
    .split(",")
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean)
);
const RATE_LIMIT_BUCKETS = new Map();

initializeStorage();

const server = http.createServer(async (request, response) => {
  const requestPath = getRequestPath(request.url);

  try {
    if (requestPath === "/api/contact") {
      const access = getApiAccess(request);

      if (!access.allowed) {
        sendJson(response, 403, { ok: false, error: "Origin not allowed." }, access.headers);
        return;
      }

      if (request.method === "OPTIONS") {
        sendEmpty(response, 204, access.headers);
        return;
      }

      if (request.method === "POST") {
        await handleContactSubmit(request, response, access.headers);
        return;
      }

      sendJson(response, 405, { ok: false, error: "Method not allowed." }, access.headers);
      return;
    }

    if (request.method === "GET" || request.method === "HEAD") {
      serveStaticFile(requestPath, response, request.method === "HEAD");
      return;
    }

    sendJson(response, 405, { ok: false, error: "Method not allowed." });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { ok: false, error: "Internal server error." });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Kelley Computers site running at http://${HOST}:${PORT}`);
  console.log(`Contact submissions append to ${SUBMISSIONS_FILE}`);
  console.log(
    isMailgunConfigured()
      ? `Mailgun notifications enabled for ${MAILGUN_TO}`
      : "Mailgun notifications disabled: configure MAILGUN_API_KEY, MAILGUN_DOMAIN, and MAILGUN_TO."
  );
});

async function handleContactSubmit(request, response, responseHeaders) {
  if (!isJsonRequest(request)) {
    sendJson(
      response,
      415,
      { ok: false, error: "Content-Type must be application/json." },
      responseHeaders
    );
    return;
  }

  const clientIp = getClientIp(request);

  if (!consumeRateLimitSlot(clientIp)) {
    sendJson(
      response,
      429,
      { ok: false, error: "Too many requests. Please try again later." },
      responseHeaders
    );
    return;
  }

  try {
    const body = await readRequestBody(request);
    const payload = JSON.parse(body || "{}");
    const record = toSubmissionRecord(payload);
    const entry = formatSubmission(record);

    await fs.promises.appendFile(SUBMISSIONS_FILE, entry, "utf8");
    await sendContactEmail(record);

    sendJson(
      response,
      200,
      { ok: true, message: "Request saved and notification sent." },
      responseHeaders
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      sendJson(response, 400, { ok: false, error: "Invalid JSON payload." }, responseHeaders);
      return;
    }

    if (error && typeof error.statusCode === "number") {
      sendJson(response, error.statusCode, { ok: false, error: error.message }, responseHeaders);
      return;
    }

    throw error;
  }
}

function serveStaticFile(requestPath, response, isHeadRequest = false) {
  const publicPath = normalizePublicPath(resolvePagePath(requestPath));

  if (!isPublicPath(publicPath)) {
    sendText(response, 404, "Not found");
    return;
  }

  const filePath = path.resolve(ROOT_DIR, `.${publicPath}`);

  if (!filePath.startsWith(ROOT_DIR)) {
    sendText(response, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === "ENOENT") {
        sendText(response, 404, "Not found");
        return;
      }

      sendText(response, 500, "Internal server error");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = CONTENT_TYPES[ext] || "application/octet-stream";
    response.writeHead(200, buildHeaders({ "Content-Type": contentType }));
    response.end(isHeadRequest ? undefined : content);
  });
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;

      if (Buffer.byteLength(body, "utf8") > BODY_LIMIT_BYTES) {
        reject(createHttpError(413, "Request body too large."));
        request.destroy();
      }
    });

    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function toSubmissionRecord(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw createHttpError(400, "Invalid request payload.");
  }

  const record = {
    submittedAt: new Date().toISOString(),
    page: toCleanLine(payload.page, 64),
    name: toRequiredLine(payload.name, "Name", 120),
    occupation: toRequiredLine(payload.occupation, "Occupation", 120),
    phone: toPhoneNumber(payload.phone),
    company: toCleanLine(payload.company, 120),
    service: toServiceValue(payload.service),
    notes: toCleanBlock(payload.notes, 2000)
  };

  return record;
}

function formatSubmission(record) {
  const lines = [
    "----------------------------------------",
    `Submitted: ${record.submittedAt}`,
    `Source page: ${record.page || "website"}`,
    `Name: ${record.name}`,
    `Occupation: ${record.occupation}`,
    `Phone: ${record.phone}`,
    `Company: ${record.company || "(blank)"}`,
    `Service: ${record.service || "(blank)"}`,
    "Notes:",
    record.notes || "(blank)",
    ""
  ];

  return `${lines.join("\n")}\n`;
}

async function sendContactEmail(record) {
  if (!isMailgunConfigured()) {
    throw createHttpError(
      503,
      "Your request was saved, but email notifications are not configured. Please contact us directly."
    );
  }

  const form = new URLSearchParams({
    from: MAILGUN_FROM,
    to: MAILGUN_TO,
    subject: `[KCIT Website] ${record.service || "Contact request"} from ${record.name}`,
    text: formatSubmissionEmail(record)
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MAILGUN_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${MAILGUN_API_BASE}/v3/${encodeURIComponent(MAILGUN_DOMAIN)}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`api:${MAILGUN_API_KEY}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: form.toString(),
        signal: controller.signal
      }
    );

    if (!response.ok) {
      const responseText = (await response.text()).trim().slice(0, 500);
      console.error(`Mailgun request failed (${response.status}): ${responseText}`);
      throw createHttpError(
        502,
        "Your request was saved, but the notification email could not be sent. Please contact us directly."
      );
    }
  } catch (error) {
    if (error && typeof error.statusCode === "number") {
      throw error;
    }

    console.error("Mailgun request failed:", error && error.message ? error.message : error);
    throw createHttpError(
      502,
      "Your request was saved, but the notification email could not be sent. Please contact us directly."
    );
  } finally {
    clearTimeout(timeout);
  }
}

function formatSubmissionEmail(record) {
  return [
    "New Kelley Computers website contact request",
    "",
    `Submitted: ${record.submittedAt}`,
    `Source page: ${record.page || "website"}`,
    `Name: ${record.name}`,
    `Occupation: ${record.occupation}`,
    `Phone: ${record.phone}`,
    `Company: ${record.company || "(blank)"}`,
    `Service: ${record.service || "(blank)"}`,
    "",
    "Notes:",
    record.notes || "(blank)"
  ].join("\n");
}

function isMailgunConfigured() {
  return Boolean(MAILGUN_API_KEY && MAILGUN_DOMAIN && MAILGUN_TO && MAILGUN_FROM);
}

function normalizeMailgunApiBase(value) {
  const normalized = String(value || "").trim().replace(/\/+$/, "");

  try {
    const parsed = new URL(normalized);

    if (parsed.protocol !== "https:" && parsed.hostname !== "127.0.0.1") {
      throw new Error("Mailgun API base must use HTTPS.");
    }

    return parsed.toString().replace(/\/+$/, "");
  } catch (error) {
    throw new Error(`Invalid MAILGUN_API_BASE: ${error.message}`);
  }
}

function toRequiredLine(value, fieldName, maxLength) {
  const cleaned = toCleanLine(value, maxLength);

  if (!cleaned) {
    throw createHttpError(400, `${fieldName} is required.`);
  }

  return cleaned;
}

function toPhoneNumber(value) {
  const cleaned = toRequiredLine(value, "Phone number", 40);

  if (!/^[0-9+() .-]{7,25}$/.test(cleaned)) {
    throw createHttpError(400, "Phone number format is not valid.");
  }

  return cleaned;
}

function toServiceValue(value) {
  const cleaned = toCleanLine(value, 64);

  if (!cleaned) {
    return "";
  }

  if (!ALLOWED_SERVICES.has(cleaned)) {
    throw createHttpError(400, "Service value is not valid.");
  }

  return cleaned;
}

function toCleanLine(value, maxLength = 256) {
  return String(value || "")
    .replace(/\r?\n/g, " ")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .trim()
    .slice(0, maxLength);
}

function toCleanBlock(value, maxLength = 2000) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .trim()
    .slice(0, maxLength);
}

function getApiAccess(request) {
  const origin = normalizeOrigin(request.headers.origin);

  if (origin) {
    if (!ALLOWED_ORIGINS.has(origin)) {
      return { allowed: false, headers: buildCorsHeaders("") };
    }

    return { allowed: true, headers: buildCorsHeaders(origin) };
  }

  if (request.headers.origin === "null" && isLoopbackAddress(request.socket.remoteAddress || "")) {
    return { allowed: true, headers: buildCorsHeaders("null") };
  }

  if (isTrustedProxyAddress(request.socket.remoteAddress || "")) {
    return { allowed: true, headers: buildCorsHeaders("") };
  }

  return { allowed: false, headers: buildCorsHeaders("") };
}

function buildCorsHeaders(origin) {
  const headers = {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin"
  };

  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

function isJsonRequest(request) {
  const contentType = String(request.headers["content-type"] || "").toLowerCase();
  return contentType.startsWith("application/json");
}

function consumeRateLimitSlot(clientIp) {
  const now = Date.now();
  const timestamps = (RATE_LIMIT_BUCKETS.get(clientIp) || []).filter(
    (timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS
  );

  if (timestamps.length >= RATE_LIMIT_MAX_SUBMISSIONS) {
    RATE_LIMIT_BUCKETS.set(clientIp, timestamps);
    return false;
  }

  timestamps.push(now);
  RATE_LIMIT_BUCKETS.set(clientIp, timestamps);
  return true;
}

function getClientIp(request) {
  const socketAddress = request.socket.remoteAddress || "";
  const forwardedFor = String(request.headers["x-forwarded-for"] || "");

  if (forwardedFor && isTrustedProxyAddress(socketAddress)) {
    const forwardedAddresses = forwardedFor
      .split(",")
      .map((address) => normalizeIpAddress(address))
      .filter(Boolean);

    return forwardedAddresses.at(-1) || "unknown";
  }

  return normalizeIpAddress(socketAddress) || "unknown";
}

function isLoopbackAddress(address) {
  const normalized = normalizeIpAddress(address);
  return normalized === "127.0.0.1" || normalized === "::1";
}

function isTrustedProxyAddress(address) {
  const normalized = normalizeIpAddress(address);
  return isLoopbackAddress(normalized) || TRUSTED_PROXY_IPS.has(normalized);
}

function normalizeIpAddress(address) {
  const normalized = String(address || "").trim();
  return normalized.startsWith("::ffff:") ? normalized.slice(7) : normalized;
}

function initializeStorage() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  if (!fs.existsSync(SUBMISSIONS_FILE) && fs.existsSync(LEGACY_SUBMISSIONS_FILE)) {
    fs.copyFileSync(LEGACY_SUBMISSIONS_FILE, SUBMISSIONS_FILE);
  }

  if (!fs.existsSync(SUBMISSIONS_FILE)) {
    fs.writeFileSync(
      SUBMISSIONS_FILE,
      "Kelley Computers contact submissions\nStored outside the public site root.\n",
      { flag: "wx" }
    );
  }
}

function buildHeaders(extraHeaders = {}) {
  return {
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    ...extraHeaders
  };
}

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  response.writeHead(
    statusCode,
    buildHeaders({
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders
    })
  );
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, text, extraHeaders = {}) {
  response.writeHead(
    statusCode,
    buildHeaders({ "Content-Type": "text/plain; charset=utf-8", ...extraHeaders })
  );
  response.end(text);
}

function sendEmpty(response, statusCode, extraHeaders = {}) {
  response.writeHead(statusCode, buildHeaders(extraHeaders));
  response.end();
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function getRequestPath(requestUrl) {
  const url = new URL(requestUrl || "/", "http://localhost");
  const pathname = url.pathname || "/";

  if (pathname !== "/" && pathname.endsWith("/")) {
    return pathname.replace(/\/+$/, "");
  }

  return pathname;
}

function resolvePagePath(urlPath) {
  if (PAGE_ALIASES[urlPath]) {
    return PAGE_ALIASES[urlPath];
  }

  if (!path.extname(urlPath)) {
    return `${urlPath}.html`;
  }

  return urlPath;
}

function normalizePublicPath(urlPath) {
  const normalized = path.posix.normalize(urlPath.replace(/\\/g, "/"));
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function isPublicPath(publicPath) {
  if (PUBLIC_PAGE_FILES.has(publicPath) || PUBLIC_ROOT_FILES.has(publicPath)) {
    return true;
  }

  return PUBLIC_PATH_PREFIXES.some((prefix) => publicPath.startsWith(prefix));
}

function normalizeOrigin(origin) {
  if (!origin) {
    return "";
  }

  try {
    return new URL(origin).origin;
  } catch (error) {
    return "";
  }
}
