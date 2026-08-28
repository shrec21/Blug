#!/usr/bin/env node
import { walkRepo } from "./walk.js";
import { scanAndUpdate } from "./core.js";
import { loadModel } from "./store.js";
import { renderMermaid } from "./diagram.js";
import { alertDrift } from "./notify.js";
import { parseWatcherArgs, runWatcher } from "./watcher.js";
import { type ComponentKind } from "./types.js";
import path from "path";

const root = process.cwd();
const [, , cmd, ...rest] = process.argv;
const COMPONENT_KINDS: ComponentKind[] = ["table", "endpoint", "service", "module", "dependency", "queue", "job"];

function parseFocus(args: string[]): string | undefined {
  const index = args.indexOf("--focus");
  if (index === -1) return undefined;
  return args[index + 1];
}

function parseDepth(args: string[]): number | undefined {
  const index = args.indexOf("--depth");
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!/^\d+$/.test(value ?? "")) return undefined;
  return Number(value);
}

function parseHide(args: string[]): ComponentKind[] {
  const index = args.indexOf("--hide");
  if (index === -1) return [];
  const value = args[index + 1] ?? "";
  return value
    .split(",")
    .map((kind) => kind.trim())
    .filter((kind): kind is ComponentKind => COMPONENT_KINDS.includes(kind as ComponentKind));
}

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
    console.log(renderMermaid(model, { focus: parseFocus(rest), depth: parseDepth(rest), hide: parseHide(rest) }));
    return;
  }

  if (cmd === "watch") {
    await runWatcher(root, parseWatcherArgs(rest));
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
  blug diagram --focus <name-or-id>
                       print a component and its direct relationships
  blug diagram --focus <name-or-id> --depth <n>
                       expand focused diagram by graph distance
  blug diagram --hide <kind[,kind...]>
                       omit selected component kinds and their relationships
  blug watch           watch continuously for architecture drift
  blug watch --preview watch and open a live architecture preview

For continuous watching, run: npm run watch:daemon
For live preview during development, run: npm run watch:daemon -- --preview
For MCP integration (Codex, etc), run: npm run mcp`);
}

main();
