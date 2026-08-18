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
    { from: "table:Orders", to: "dependency:@scope/pkg", label: "owned by", sourceFile: "schema.sql" },
    { from: "endpoint:GET /orders", to: "table:Orders", label: "reads \"latest\"", sourceFile: "routes/orders.ts" },
  ],
};

test("renderMermaid emits layered TB layout with styled subgraphs", () => {
  const mermaid = renderMermaid(model);

  // TB direction
  assert.match(mermaid, /^flowchart TB$/m);

  // Layered order: endpoint before table before dependency
  const endpointIdx = mermaid.indexOf("subgraph endpoint");
  const tableIdx = mermaid.indexOf("subgraph table");
  const depIdx = mermaid.indexOf("subgraph dependency");
  assert.ok(endpointIdx < tableIdx, "endpoint subgraph should come before table");
  assert.ok(tableIdx < depIdx, "table subgraph should come before dependency");

  // Style directives present
  assert.match(mermaid, /style endpoint fill:/);
  assert.match(mermaid, /style table fill:/);
  assert.match(mermaid, /style dependency fill:/);
});

test("renderMermaid renders relationships and escaped labels", () => {
  const mermaid = renderMermaid(model);

  assert.match(mermaid, /endpoint_GET__orders -->\|reads \\"latest\\"\| table_Orders/);
  assert.match(mermaid, /table_Orders -->\|owned by\| dependency__scope_pkg/);
});

test("renderMermaid filters out relationships with dangling component references", () => {
  const modelWithDangling: ArchitectureModel = {
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
    },
    relationships: [
      // Valid: from exists (but to doesn't — should be filtered)
      { from: "endpoint:GET /orders", to: "table:Missing", label: "queries", sourceFile: "routes/orders.ts" },
      // Invalid: neither side exists
      { from: "service:ghost", to: "endpoint:POST /x", label: "exposes", sourceFile: "docker-compose.yml" },
    ],
  };

  const mermaid = renderMermaid(modelWithDangling);
  assert.ok(!mermaid.includes("table_Missing"), "dangling 'to' should be filtered");
  assert.ok(!mermaid.includes("service_ghost"), "dangling 'from' should be filtered");
  assert.ok(!mermaid.includes("-->"), "no relationship arrows should appear");
});

test("renderMarkdown includes deterministic summary and empty-state text", () => {
  assert.match(
    renderMarkdown(model),
    /- API: 1\n- Database: 1\n- Dependencies: 1/
  );

  const empty: ArchitectureModel = {
    version: 1,
    updatedAt: "2026-08-01T00:00:00.000Z",
    components: {},
    relationships: [],
  };
  assert.match(renderMarkdown(empty), /_No components detected yet\._/);
  assert.match(renderMarkdown(empty), /```mermaid\nflowchart TB\n```/);
});
