#!/usr/bin/env node
import { walkRepo } from "./walk.js";
import { scanAndUpdate } from "./core.js";
import { loadModel } from "./store.js";
import { renderMermaid } from "./diagram.js";
import { alertDrift } from "./notify.js";
import path from "path";

const root = process.cwd();
const [, , cmd, ...rest] = process.argv;

async function main() {
  if (cmd === "check") {
    const paths = rest.length > 0 ? rest.map((p) => path.relative(root, path.resolve(p))) : await walkRepo(root);
    const reports = await scanAndUpdate(root, paths);
    for (const report of reports) {
      alertDrift(report, report.sourceFile);
    }
    if (reports.length === 0) {
      console.log("[blug] no architecture drift detected");
    }
    return;
  }

  if (cmd === "diagram") {
    const model = await loadModel(root);
    console.log(renderMermaid(model));
    return;
  }

  if (cmd === "init") {
    const paths = await walkRepo(root);
    const reports = await scanAndUpdate(root, paths, { writeWhenNoDrift: true });
    console.log(`[blug] baseline seeded: ${reports.length} file(s) contributed components. See ARCHITECTURE.md`);
    return;
  }

  console.log(`blug - usage:
  blug init            seed baseline model from full repo scan
  blug check [files]   check given files (or whole repo) for architecture drift
  blug diagram         print current Mermaid diagram to stdout

For continuous watching, run: npm run watch:daemon
For MCP integration (Codex, etc), run: npm run mcp`);
}

main();
