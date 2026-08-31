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

test("renderMermaid can focus on a component and its direct relationships", () => {
  const modelWithUnrelatedComponent: ArchitectureModel = {
    ...model,
    components: {
      ...model.components,
      "queue:invoices": {
        id: "queue:invoices",
        kind: "queue",
        name: "invoices",
        sourceFile: "queues.ts",
        lastChanged: "2026-08-01T00:00:00.000Z",
      },
    },
    relationships: [
      ...model.relationships,
      {
        from: "queue:invoices",
        to: "dependency:@scope/pkg",
        label: "uses",
        sourceFile: "queues.ts",
      },
    ],
  };

  const mermaid = renderMermaid(modelWithUnrelatedComponent, { focus: "orders" });

  assert.match(mermaid, /endpoint_GET__orders\["GET \/orders"\]/);
  assert.match(mermaid, /table_Orders\["Orders"\]/);
  assert.match(mermaid, /dependency__scope_pkg\["@scope\/pkg \\"quoted\\""\]/);
  assert.match(mermaid, /endpoint_GET__orders -->\|reads \\"latest\\"\| table_Orders/);
  assert.match(mermaid, /table_Orders -->\|owned by\| dependency__scope_pkg/);
  assert.doesNotMatch(mermaid, /queue_invoices/);
  assert.doesNotMatch(mermaid, /uses/);
});

test("renderMermaid expands focused diagrams by graph depth", () => {
  const chainModel: ArchitectureModel = {
    version: 1,
    updatedAt: "2026-08-01T00:00:00.000Z",
    components: {
      "endpoint:GET /users": {
        id: "endpoint:GET /users",
        kind: "endpoint",
        name: "GET /users",
        sourceFile: "routes/users.ts",
        lastChanged: "2026-08-01T00:00:00.000Z",
      },
      "table:Users": {
        id: "table:Users",
        kind: "table",
        name: "Users",
        sourceFile: "schema.sql",
        lastChanged: "2026-08-01T00:00:00.000Z",
      },
      "queue:user-events": {
        id: "queue:user-events",
        kind: "queue",
        name: "user-events",
        sourceFile: "queues.ts",
        lastChanged: "2026-08-01T00:00:00.000Z",
      },
      "dependency:analytics": {
        id: "dependency:analytics",
        kind: "dependency",
        name: "analytics",
        sourceFile: "package.json",
        lastChanged: "2026-08-01T00:00:00.000Z",
      },
    },
    relationships: [
      { from: "endpoint:GET /users", to: "table:Users", label: "queries", sourceFile: "routes/users.ts" },
      { from: "table:Users", to: "queue:user-events", label: "publishes", sourceFile: "schema.sql" },
      { from: "queue:user-events", to: "dependency:analytics", label: "handled by", sourceFile: "queues.ts" },
    ],
  };

  const depthZero = renderMermaid(chainModel, { focus: "GET /users", depth: 0 });
  assert.match(depthZero, /endpoint_GET__users\["GET \/users"\]/);
  assert.doesNotMatch(depthZero, /table_Users/);
  assert.doesNotMatch(depthZero, /-->/);

  const depthTwo = renderMermaid(chainModel, { focus: "GET /users", depth: 2 });
  assert.match(depthTwo, /endpoint_GET__users\["GET \/users"\]/);
  assert.match(depthTwo, /table_Users\["Users"\]/);
  assert.match(depthTwo, /queue_user_events\["user-events"\]/);
  assert.match(depthTwo, /endpoint_GET__users -->\|queries\| table_Users/);
  assert.match(depthTwo, /table_Users -->\|publishes\| queue_user_events/);
  assert.doesNotMatch(depthTwo, /dependency_analytics/);
  assert.doesNotMatch(depthTwo, /handled by/);
});

test("renderMermaid hides selected component kinds and their relationships", () => {
  const mermaid = renderMermaid(model, { hide: ["dependency"] });

  assert.match(mermaid, /endpoint_GET__orders\["GET \/orders"\]/);
  assert.match(mermaid, /table_Orders\["Orders"\]/);
  assert.match(mermaid, /endpoint_GET__orders -->\|reads \\"latest\\"\| table_Orders/);
  assert.doesNotMatch(mermaid, /dependency__scope_pkg/);
  assert.doesNotMatch(mermaid, /owned by/);
  assert.doesNotMatch(mermaid, /subgraph dependency/);
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
