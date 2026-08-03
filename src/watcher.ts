import chokidar from "chokidar";
import { scanAndUpdate } from "./core.js";
import { alertDrift } from "./notify.js";

// This is the piece that makes blug agent-agnostic: it does not hook into
// Claude Code, Codex, Cursor, or any specific tool. It watches the filesystem
// directly, so it catches changes regardless of which agent (or human) made them,
// and regardless of whether that agent has a hook system at all.

const root = process.cwd();

async function handleChange(relPath: string) {
  try {
    const reports = await scanAndUpdate(root, [relPath]);
    for (const report of reports) {
      alertDrift(report, report.sourceFile);
    }
  } catch (error) {
    console.error(`[blug] failed to process ${relPath}:`, error);
  }
}

function main() {
  console.log(`[blug] watching ${root} for architecture-relevant changes...`);
  console.log(`[blug] diagram will be kept at ./ARCHITECTURE.md`);

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

  watcher.on("add", handleChange);
  watcher.on("change", handleChange);
  watcher.on("unlink", handleChange);
  watcher.on("error", (error) => {
    console.error("[blug] watcher error:", error);
  });
}

main();
