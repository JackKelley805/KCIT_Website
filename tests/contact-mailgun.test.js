const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const PROJECT_ROOT = path.resolve(__dirname, "..");

test("contact requests are stored and sent through Mailgun", async (context) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kcit-mailgun-test-"));
  const receivedRequests = [];
  const mailgunServer = http.createServer((request, response) => {
    let body = "";

    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      receivedRequests.push({
        authorization: request.headers.authorization,
        body: new URLSearchParams(body),
        method: request.method,
        url: request.url
      });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ id: "test-message", message: "Queued" }));
    });
  });

  await listen(mailgunServer);
  const mailgunPort = mailgunServer.address().port;
  const appPort = await getAvailablePort();
  const app = spawn(process.execPath, ["server.js"], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      ALLOWED_ORIGINS: `http://127.0.0.1:${appPort}`,
      DATA_DIR: dataDir,
      HOST: "127.0.0.1",
      MAILGUN_API_BASE: `http://127.0.0.1:${mailgunPort}`,
      MAILGUN_API_KEY: "test-key",
      MAILGUN_DOMAIN: "mg.example.test",
      MAILGUN_FROM: "Kelley Computers Website <website@mg.example.test>",
      MAILGUN_TO: "owner@example.test",
      PORT: String(appPort),
      RATE_LIMIT_MAX_SUBMISSIONS: "50"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let appOutput = "";

  app.stdout.on("data", (chunk) => {
    appOutput += chunk;
  });
  app.stderr.on("data", (chunk) => {
    appOutput += chunk;
  });

  context.after(async () => {
    app.kill();
    await new Promise((resolve) => mailgunServer.close(resolve));
    fs.rmSync(dataDir, { force: true, recursive: true });
  });

  await waitForServer(`http://127.0.0.1:${appPort}/`, app, () => appOutput);

  const payload = {
    page: "contact",
    name: "Test Customer",
    occupation: "Owner",
    phone: "(555) 555-0123",
    company: "Example Company",
    service: "Managed Networks",
    notes: "Please call about office Wi-Fi."
  };
  const response = await fetch(`http://127.0.0.1:${appPort}/api/contact`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: `http://127.0.0.1:${appPort}`
    },
    body: JSON.stringify(payload)
  });
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.ok, true);
  assert.equal(receivedRequests.length, 1);

  const mailgunRequest = receivedRequests[0];
  assert.equal(mailgunRequest.method, "POST");
  assert.equal(mailgunRequest.url, "/v3/mg.example.test/messages");
  assert.equal(
    mailgunRequest.authorization,
    `Basic ${Buffer.from("api:test-key").toString("base64")}`
  );
  assert.equal(mailgunRequest.body.get("to"), "owner@example.test");
  assert.match(mailgunRequest.body.get("subject"), /Managed Networks from Test Customer/);
  assert.match(mailgunRequest.body.get("text"), /Phone: \(555\) 555-0123/);
  assert.match(mailgunRequest.body.get("text"), /Please call about office Wi-Fi\./);

  const storedSubmission = fs.readFileSync(
    path.join(dataDir, "contact-submissions.txt"),
    "utf8"
  );
  assert.match(storedSubmission, /Name: Test Customer/);
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

async function getAvailablePort() {
  const server = http.createServer();
  await listen(server);
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForServer(url, processHandle, getOutput) {
  const deadline = Date.now() + 5000;

  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) {
      throw new Error(`Application exited before startup:\n${getOutput()}`);
    }

    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch (error) {
      // The application may still be starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Application did not start in time:\n${getOutput()}`);
}
