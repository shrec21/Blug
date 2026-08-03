import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { walkRepo } from "./walk.js";
import { loadModel } from "./store.js";
import { renderMermaid } from "./diagram.js";
import { scanAndUpdate } from "./core.js";
import { parsePathsArg } from "./mcp-args.js";

// This lets any MCP-compatible agent (Codex, Claude Code, etc.) call
// blug directly — no background daemon required. Useful in CI,
// sandboxes, or any environment where a persistent watcher isn't running.

const root = process.cwd();

const server = new Server(
  { name: "blug", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "check_architecture_drift",
      description:
        "Scan given file paths (or the whole repo if omitted) for architecture-relevant changes (DB schema, API routes, infra, dependencies, messaging) since the last known model. Returns a drift report and updates ARCHITECTURE.md if anything changed. Call this after making edits that might touch schema/API/infra, or before ending a session.",
      inputSchema: {
        type: "object",
        properties: {
          paths: {
            type: "array",
            items: { type: "string" },
            description: "Relative file paths to check. Omit to scan the whole repo.",
          },
        },
      },
    },
    {
      name: "get_architecture_diagram",
      description:
        "Return the current architecture diagram (Mermaid) and a plain-text component summary, without triggering a rescan.",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "check_architecture_drift") {
    const paths = parsePathsArg(args) ?? (await walkRepo(root));

    const reports = await scanAndUpdate(root, paths);
    const hasDrift = reports.length > 0;
    const text = hasDrift
      ? `Architecture drift detected:\n` +
        reports.map((r) => `- ${r.sourceFile}: ${r.summary}`).join("\n")
      : "No architecture drift detected.";
    return { content: [{ type: "text", text }] };
  }

  if (name === "get_architecture_diagram") {
    const model = await loadModel(root);
    return {
      content: [
        {
          type: "text",
          text: `\`\`\`mermaid\n${renderMermaid(model)}\n\`\`\`\n\nLast updated: ${model.updatedAt}\nComponents: ${Object.keys(model.components).length}`,
        },
      ],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main();
