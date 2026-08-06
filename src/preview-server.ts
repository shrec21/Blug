import http, { type ServerResponse } from "http";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { stateDir } from "./store.js";
import { renderMermaid } from "./diagram.js";
import { emptyModel, type ArchitectureModel } from "./types.js";

const DEFAULT_PORT = 4327;
const DEFAULT_PORT_ATTEMPTS = 10;

export interface BrowserOpenCommand {
  command: string;
  args: string[];
}

export interface DiagramPayload {
  mermaid: string;
  updatedAt: string;
  error?: string;
}

export interface PreviewServerHandle {
  port: number;
  url: string;
  broadcastRefresh(): void;
  close(): Promise<void>;
}

export interface PreviewServerOptions {
  preferredPort?: number;
  portAttempts?: number;
  openBrowser?: boolean;
  openUrl?: (url: string) => Promise<void>;
  logInfo?: (message: string) => void;
  logWarning?: (message: string) => void;
}

export function createBrowserOpenCommand(
  url: string,
  platform: NodeJS.Platform = process.platform
): BrowserOpenCommand {
  if (platform === "darwin") return { command: "open", args: [url] };
  if (platform === "win32") return { command: "cmd", args: ["/c", "start", "", url] };
  return { command: "xdg-open", args: [url] };
}

export async function openBrowser(url: string): Promise<void> {
  const { command, args } = createBrowserOpenCommand(url);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

async function readDiagram(root: string): Promise<DiagramPayload> {
  try {
    const raw = await fs.readFile(path.join(stateDir(root), "model.json"), "utf-8");
    const model = JSON.parse(raw) as ArchitectureModel;
    return {
      mermaid: renderMermaid(model),
      updatedAt: model.updatedAt
    };
  } catch (error) {
    const model = emptyModel();
    const code = (error as NodeJS.ErrnoException).code;
    return {
      mermaid: renderMermaid(model),
      updatedAt: model.updatedAt,
      error: code === "ENOENT" ? undefined : error instanceof Error ? error.message : String(error)
    };
  }
}

function previewHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Blug Architecture Preview</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f7f7f5; color: #181818; }
    header { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; padding: 16px 20px; border-bottom: 1px solid #ddd; background: #ffffff; }
    h1 { margin: 0; font-size: 18px; font-weight: 650; }
    #status { font-size: 13px; color: #5f6368; }
    main { padding: 20px; overflow: auto; }
    #diagram { min-height: 240px; }
    #error { display: none; margin: 16px 20px 0; padding: 12px 14px; border: 1px solid #b3261e; color: #b3261e; background: #fff3f1; border-radius: 6px; white-space: pre-wrap; }
    @media (prefers-color-scheme: dark) {
      body { background: #181818; color: #f3f3f1; }
      header { background: #202124; border-bottom-color: #333; }
      #status { color: #b6b8bd; }
      #error { background: #2b1b1a; }
    }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
</head>
<body>
  <header>
    <h1>Blug Architecture Preview</h1>
    <div id="status">Connecting...</div>
  </header>
  <div id="error"></div>
  <main>
    <pre id="diagram" class="mermaid"></pre>
  </main>
  <script>
    const statusEl = document.getElementById("status");
    const errorEl = document.getElementById("error");
    const diagramEl = document.getElementById("diagram");

    function showError(message) {
      errorEl.style.display = "block";
      errorEl.textContent = message;
    }

    function clearError() {
      errorEl.style.display = "none";
      errorEl.textContent = "";
    }

    async function renderDiagram() {
      try {
        if (!window.mermaid) {
          showError("Mermaid failed to load. Check your network connection and refresh this page.");
          return;
        }
        const response = await fetch("/diagram");
        const payload = await response.json();
        if (payload.error) showError(payload.error);
        else clearError();
        diagramEl.removeAttribute("data-processed");
        diagramEl.textContent = payload.mermaid || "flowchart LR";
        await window.mermaid.run({ nodes: [diagramEl] });
        statusEl.textContent = payload.updatedAt ? "Updated " + new Date(payload.updatedAt).toLocaleString() : "Updated";
      } catch (error) {
        showError(error && error.message ? error.message : String(error));
      }
    }

    if (window.mermaid) {
      window.mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "default" });
    }
    renderDiagram();

    const events = new EventSource("/events");
    events.addEventListener("open", () => {
      statusEl.textContent = "Connected";
    });
    events.addEventListener("refresh", renderDiagram);
    events.addEventListener("error", () => {
      statusEl.textContent = "Reconnecting...";
    });
  </script>
</body>
</html>`;
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function listen(server: http.Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      const address = server.address();
      if (typeof address === "object" && address) resolve(address.port);
      else resolve(port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

async function listenWithRetry(
  server: http.Server,
  preferredPort: number,
  attempts: number
): Promise<number> {
  const dynamicPort = preferredPort === 0;
  for (let offset = 0; offset < attempts; offset += 1) {
    const port = dynamicPort ? 0 : preferredPort + offset;
    try {
      return await listen(server, port);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EADDRINUSE" || dynamicPort || offset === attempts - 1) throw error;
    }
  }
  throw new Error("Unable to start preview server");
}

export async function startPreviewServer(
  root: string,
  options: PreviewServerOptions = {}
): Promise<PreviewServerHandle> {
  const clients = new Set<ServerResponse>();
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    if (request.method === "GET" && url.pathname === "/") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store"
      });
      response.end(previewHtml());
      return;
    }

    if (request.method === "GET" && url.pathname === "/diagram") {
      sendJson(response, 200, await readDiagram(root));
      return;
    }

    if (request.method === "GET" && url.pathname === "/events") {
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive"
      });
      response.write(": connected\n\n");
      clients.add(response);
      request.on("close", () => {
        clients.delete(response);
      });
      return;
    }

    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  });

  const port = await listenWithRetry(
    server,
    options.preferredPort ?? DEFAULT_PORT,
    options.portAttempts ?? DEFAULT_PORT_ATTEMPTS
  );
  const url = `http://127.0.0.1:${port}`;

  options.logInfo?.(`[blug] preview available at ${url}`);
  if (options.openBrowser !== false) {
    try {
      await (options.openUrl ?? openBrowser)(url);
    } catch {
      options.logWarning?.(`[blug] could not open browser. Preview available at ${url}`);
    }
  }

  return {
    port,
    url,
    broadcastRefresh() {
      const payload = `event: refresh\ndata: ${JSON.stringify({ updatedAt: new Date().toISOString() })}\n\n`;
      for (const client of clients) {
        client.write(payload);
      }
    },
    close() {
      for (const client of clients) {
        client.end();
      }
      clients.clear();
      return new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  };
}
