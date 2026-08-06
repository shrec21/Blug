import chokidar from "chokidar";
import { pathToFileURL } from "url";
import { scanAndUpdate } from "./core.js";
import { alertDrift } from "./notify.js";
import { startPreviewServer, type PreviewServerHandle } from "./preview-server.js";
import { type DriftReport } from "./types.js";

// This is the piece that makes blug agent-agnostic: it does not hook into
// Claude Code, Codex, Cursor, or any specific tool. It watches the filesystem
// directly, so it catches changes regardless of which agent (or human) made them,
// and regardless of whether that agent has a hook system at all.

export interface WatcherOptions {
  preview: boolean;
}

export interface HandleChangeOptions {
  scanAndUpdate?: typeof scanAndUpdate;
  alertDrift?: typeof alertDrift;
  previewServer?: Pick<PreviewServerHandle, "broadcastRefresh">;
}

export function parseWatcherArgs(args: string[]): WatcherOptions {
  return {
    preview: args.includes("--preview")
  };
}

export async function handleChange(
  root: string,
  relPath: string,
  options: HandleChangeOptions = {}
): Promise<DriftReport[]> {
  const scan = options.scanAndUpdate ?? scanAndUpdate;
  const notify = options.alertDrift ?? alertDrift;
  try {
    const reports = await scan(root, [relPath]);
    for (const report of reports) {
      notify(report, report.sourceFile);
    }
    if (reports.length > 0) {
      options.previewServer?.broadcastRefresh();
    }
    return reports;
  } catch (error) {
    console.error(`[blug] failed to process ${relPath}:`, error);
    return [];
  }
}

export async function runWatcher(
  root: string = process.cwd(),
  options: WatcherOptions = parseWatcherArgs(process.argv.slice(2))
) {
  console.log(`[blug] watching ${root} for architecture-relevant changes...`);
  console.log(`[blug] diagram will be kept at ./ARCHITECTURE.md`);

  let previewServer: PreviewServerHandle | undefined;
  if (options.preview) {
    previewServer = await startPreviewServer(root, {
      logInfo: console.log,
      logWarning: console.warn
    });
  }

  const watcher = chokidar.watch(".", {
    cwd: root,
    ignored: [
      "**/node_modules/**",
      "**/.git/**",
      "**/dist/**",
      "**/build/**",
      "**/.blug/**",
    ],
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  });

  watcher.on("add", (relPath) => {
    void handleChange(root, relPath, { previewServer });
  });
  watcher.on("change", (relPath) => {
    void handleChange(root, relPath, { previewServer });
  });
  watcher.on("unlink", (relPath) => {
    void handleChange(root, relPath, { previewServer });
  });
  watcher.on("error", (error) => {
    console.error("[blug] watcher error:", error);
  });

  return { watcher, previewServer };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runWatcher().catch((error) => {
    console.error("[blug] watcher failed:", error);
    process.exitCode = 1;
  });
}
