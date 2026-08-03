import test from "node:test";
import assert from "node:assert/strict";
import { type ArchitectureModel } from "../src/types.js";
import { renderMarkdown, renderMermaid } from "../src/diagram.js";

const model: ArchitectureModel = {
  version: 1,
  updatedAt: "2026-08-01T00:00:00.000Z",
  components: {
    "endpoint:GET /orders": {
      id: "endpoint:GET /orders",
      kind: "endpoint",
      name: "GET /orders",
      sourceFile: "routes/orders.ts",
      lastChanged: "2026-08-01T00:00:00.000Z",
    },
    "table:Orders": {
      id: "table:Orders",
      kind: "table",
      name: "Orders",
      sourceFile: "schema.sql",
      lastChanged: "2026-08-01T00:00:00.000Z",
    },
    "dependency:@scope/pkg": {
      id: "dependency:@scope/pkg",
      kind: "dependency",
      name: "@scope/pkg \"quoted\"",
      sourceFile: "package.json",
      detail: "^1.0.0",
      lastChanged: "2026-08-01T00:00:00.000Z",
    },
  },
  relationships: [
    { from: "table:Orders", to: "dependency:@scope/pkg", label: "owned by" },
    { from: "endpoint:GET /orders", to: "table:Orders", label: "reads \"latest\"" },
  ],
};

test("renderMermaid emits deterministic groups, relationships, and escaped labels", () => {
  assert.equal(
    renderMermaid(model),
    [
      "flowchart LR",
      "  subgraph table[\"Database\"]",
      "    table_Orders[\"Orders\"]",
      "  end",
      "  subgraph endpoint[\"API\"]",
      "    endpoint_GET__orders[\"GET /orders\"]",
      "  end",
      "  subgraph dependency[\"Dependencies\"]",
      "    dependency__scope_pkg[\"@scope/pkg \\\"quoted\\\"\"]",
      "  end",
      "  endpoint_GET__orders -->|reads \\\"latest\\\"| table_Orders",
      "  table_Orders -->|owned by| dependency__scope_pkg",
    ].join("\n")
  );
});

test("renderMarkdown includes deterministic summary and empty-state text", () => {
  assert.match(
    renderMarkdown(model),
    /- Database: 1\n- API: 1\n- Dependencies: 1/
  );

  const empty: ArchitectureModel = {
    version: 1,
    updatedAt: "2026-08-01T00:00:00.000Z",
    components: {},
    relationships: [],
  };
  assert.match(renderMarkdown(empty), /_No components detected yet\._/);
  assert.match(renderMarkdown(empty), /```mermaid\nflowchart LR\n```/);
});
