const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { SMTPServer } = require("smtp-server");

const PROJECT_ROOT = path.resolve(__dirname, "..");

test("contact requests are stored and sent through authenticated SMTP", async (context) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kcit-smtp-test-"));
  const receivedMessages = [];
  const smtpServer = new SMTPServer({
    allowInsecureAuth: true,
    disabledCommands: ["STARTTLS"],
    onAuth(auth, session, callback) {
      if (auth.username !== "test-user" || auth.password !== "test-password") {
        callback(new Error("Invalid test credentials"));
        return;
      }

      callback(null, { user: auth.username });
    },
    onData(stream, session, callback) {
      let message = "";
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        message += chunk;
      });
      stream.on("end", () => {
        receivedMessages.push({ envelope: session.envelope, message });
        callback();
      });
    }
  });

  await listenSmtp(smtpServer);
  const smtpPort = smtpServer.server.address().port;
  const appPort = await getAvailablePort();
  const app = spawn(process.execPath, ["server.js"], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      ALLOWED_ORIGINS: `http://127.0.0.1:${appPort}`,
      DATA_DIR: dataDir,
      HOST: "127.0.0.1",
      PORT: String(appPort),
      RATE_LIMIT_MAX_SUBMISSIONS: "50",
      SMTP_FROM: "Kelley Computers Website <website@example.test>",
      SMTP_HOST: "127.0.0.1",
      SMTP_PASS: "test-password",
      SMTP_PORT: String(smtpPort),
      SMTP_REQUIRE_TLS: "false",
      SMTP_SECURE: "false",
      SMTP_TO: "owner@example.test",
      SMTP_USER: "test-user"
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
    await closeSmtp(smtpServer);
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
  assert.equal(receivedMessages.length, 1);

  const delivered = receivedMessages[0];
  assert.equal(delivered.envelope.mailFrom.address, "website@example.test");
  assert.equal(delivered.envelope.rcptTo[0].address, "owner@example.test");
  assert.match(delivered.message, /Managed Networks from Test Customer/);
  assert.match(delivered.message, /Phone: \(555\) 555-0123/);
  assert.match(delivered.message, /Please call about office Wi-Fi\./);

  const storedSubmission = fs.readFileSync(
    path.join(dataDir, "contact-submissions.txt"),
    "utf8"
  );
  assert.match(storedSubmission, /Name: Test Customer/);
});

function listenSmtp(server) {
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

function closeSmtp(server) {
  return new Promise((resolve) => server.close(resolve));
}

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
