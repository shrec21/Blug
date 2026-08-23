import test from "node:test";
import assert from "node:assert/strict";
import http from "http";
import { once } from "events";
import { type AddressInfo } from "net";
import { startPreviewServer, createBrowserOpenCommand } from "../src/preview-server.js";
import { makeTempRepo, writeFile } from "./test-helpers.js";

async function readText(url: string): Promise<string> {
  const response = await fetch(url);
  assert.equal(response.ok, true);
  return await response.text();
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  assert.equal(response.ok, true);
  return (await response.json()) as T;
}

test("preview server returns HTML from root", async () => {
  const root = await makeTempRepo("preview-html");
  const server = await startPreviewServer(root, { openBrowser: false, preferredPort: 0 });
  try {
    const html = await readText(`${server.url}/`);

    assert.match(html, /<!doctype html>/i);
    assert.match(html, /mermaid/i);
  } finally {
    await server.close();
  }
});

test("preview server returns Mermaid JSON from the saved model", async () => {
  const root = await makeTempRepo("preview-diagram");
  await writeFile(
    root,
    ".blug/model.json",
    JSON.stringify({
      version: 1,
      updatedAt: "2026-08-04T00:00:00.000Z",
      components: {
        "table:Users": {
          id: "table:Users",
          kind: "table",
          name: "Users",
          sourceFile: "migrations/001.sql",
          lastChanged: "2026-08-04T00:00:00.000Z"
        }
      },
      relationships: []
    })
  );
  const server = await startPreviewServer(root, { openBrowser: false, preferredPort: 0 });
  try {
    const payload = await readJson<{ mermaid: string; updatedAt: string }>(`${server.url}/diagram`);

    assert.equal(payload.updatedAt, "2026-08-04T00:00:00.000Z");
    assert.match(payload.mermaid, /flowchart TB/);
    assert.match(payload.mermaid, /Users/);
  } finally {
    await server.close();
  }
});

test("preview server returns an empty diagram with an error when model JSON is invalid", async () => {
  const root = await makeTempRepo("preview-invalid-model");
  await writeFile(root, ".blug/model.json", "{ invalid json");
  const server = await startPreviewServer(root, { openBrowser: false, preferredPort: 0 });
  try {
    const payload = await readJson<{ mermaid: string; error?: string }>(`${server.url}/diagram`);

    assert.match(payload.mermaid, /flowchart TB/);
    assert.match(payload.error ?? "", /Expected property name|JSON/);
  } finally {
    await server.close();
  }
});

test("preview server emits a refresh event when broadcastRefresh is called", async () => {
  const root = await makeTempRepo("preview-events");
  const server = await startPreviewServer(root, { openBrowser: false, preferredPort: 0 });
  try {
    let markConnected!: () => void;
    const connected = new Promise<void>((resolve) => {
      markConnected = resolve;
    });
    const received = new Promise<string>((resolve, reject) => {
      const request = http.get(`${server.url}/events`, (response) => {
        response.setEncoding("utf-8");
        response.on("data", (chunk: string) => {
          if (chunk.includes(": connected")) {
            markConnected();
          }
          if (chunk.includes("event: refresh")) {
            request.destroy();
            resolve(chunk);
          }
        });
      });
      request.on("error", reject);
    });

    await connected;
    server.broadcastRefresh();

    assert.match(await received, /event: refresh/);
  } finally {
    await server.close();
  }
});

test("preview server retries the next port when the preferred port is busy", async () => {
  const blocker = http.createServer((_request, response) => {
    response.end("busy");
  });
  blocker.listen(0, "127.0.0.1");
  await once(blocker, "listening");
  const address = blocker.address() as AddressInfo;

  const root = await makeTempRepo("preview-port");
  const server = await startPreviewServer(root, {
    openBrowser: false,
    preferredPort: address.port,
    portAttempts: 2
  });
  try {
    assert.equal(server.port, address.port + 1);
  } finally {
    await server.close();
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
  }
});

test("browser opener selects platform commands", () => {
  assert.deepEqual(createBrowserOpenCommand("http://127.0.0.1:4327", "darwin"), {
    command: "open",
    args: ["http://127.0.0.1:4327"]
  });
  assert.deepEqual(createBrowserOpenCommand("http://127.0.0.1:4327", "win32"), {
    command: "cmd",
    args: ["/c", "start", "", "http://127.0.0.1:4327"]
  });
  assert.deepEqual(createBrowserOpenCommand("http://127.0.0.1:4327", "linux"), {
    command: "xdg-open",
    args: ["http://127.0.0.1:4327"]
  });
});

test("browser open failure logs the preview URL and leaves server running", async () => {
  const root = await makeTempRepo("preview-open-failure");
  const warnings: string[] = [];
  const server = await startPreviewServer(root, {
    preferredPort: 0,
    openBrowser: true,
    openUrl: async () => {
      throw new Error("cannot open");
    },
    logWarning: (message: string) => warnings.push(message)
  });
  try {
    assert.match(warnings.join("\n"), /Preview available at http:\/\/127\.0\.0\.1:/);
    assert.match(await readText(`${server.url}/`), /mermaid/i);
  } finally {
    await server.close();
  }
});
