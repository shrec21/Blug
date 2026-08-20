import test from "node:test";
import assert from "node:assert/strict";
import { emptyModel, type Component, type Relationship } from "../src/types.js";
import { mergeArchitecture, mergeComponents } from "../src/store.js";

function component(id: string, detail = "v1", sourceFile = "schema.sql"): Component {
  return {
    id,
    kind: "table",
    name: id.split(":")[1] ?? id,
    sourceFile,
    detail,
    lastChanged: "2026-08-01T00:00:00.000Z",
  };
}

function relationship(
  from = "table:Orders",
  to = "table:Users",
  sourceFile = "schema.sql"
): Relationship {
  return {
    from,
    to,
    label: "FK",
    sourceFile,
  };
}

test("mergeComponents reports added components and source file", () => {
  const model = emptyModel();
  const report = mergeComponents(model, "schema.sql", [component("table:Users")]);
  assert.equal(report.sourceFile, "schema.sql");
  assert.equal(report.hasDrift, true);
  assert.deepEqual(report.added.map((c) => c.id), ["table:Users"]);
  assert.equal(model.components["table:Users"]?.detail, "v1");
});

test("mergeComponents removes components no longer found in the same source file", () => {
  const model = emptyModel();
  mergeComponents(model, "schema.sql", [component("table:Users"), component("table:Orders")]);
  const report = mergeComponents(model, "schema.sql", [component("table:Users")]);
  assert.deepEqual(report.removed.map((c) => c.id), ["table:Orders"]);
  assert.equal(model.components["table:Orders"], undefined);
});

test("mergeComponents reports modified details and preserves unchanged timestamps", () => {
  const model = emptyModel();
  mergeComponents(model, "schema.sql", [component("table:Users", "v1")]);
  const unchanged = component("table:Users", "v1");
  unchanged.lastChanged = "2026-08-02T00:00:00.000Z";
  const noDrift = mergeComponents(model, "schema.sql", [unchanged]);
  assert.equal(noDrift.hasDrift, false);
  assert.equal(model.components["table:Users"]?.lastChanged, "2026-08-01T00:00:00.000Z");

  const changed = component("table:Users", "v2");
  changed.lastChanged = "2026-08-03T00:00:00.000Z";
  const drift = mergeComponents(model, "schema.sql", [changed]);
  assert.equal(drift.hasDrift, true);
  assert.deepEqual(drift.modified.map((c) => c.id), ["table:Users"]);
  assert.equal(model.components["table:Users"]?.lastChanged, "2026-08-03T00:00:00.000Z");
});

test("mergeComponents updates source attribution without timestamp churn", () => {
  const model = emptyModel();
  mergeComponents(model, "old/schema.sql", [component("table:Users", "v1", "old/schema.sql")]);

  const moved = component("table:Users", "v1", "new/schema.sql");
  moved.lastChanged = "2026-08-02T00:00:00.000Z";
  const report = mergeComponents(model, "new/schema.sql", [moved]);

  assert.equal(report.hasDrift, false);
  assert.equal(model.components["table:Users"]?.sourceFile, "new/schema.sql");
  assert.equal(model.components["table:Users"]?.lastChanged, "2026-08-01T00:00:00.000Z");
});

test("mergeArchitecture adds relationships and reports relationship drift", () => {
  const model = emptyModel();

  const report = mergeArchitecture(model, "schema.sql", {
    components: [component("table:Users"), component("table:Orders")],
    relationships: [relationship()],
  });

  assert.equal(report.hasDrift, true);
  assert.deepEqual(report.addedRelationships, [relationship()]);
  assert.deepEqual(model.relationships, [relationship()]);
  assert.match(report.summary, /\+1 relationship/);
});

test("mergeArchitecture removes relationships owned by the changed source file", () => {
  const model = emptyModel();
  mergeArchitecture(model, "schema.sql", {
    components: [component("table:Users"), component("table:Orders")],
    relationships: [relationship()],
  });

  const report = mergeArchitecture(model, "schema.sql", {
    components: [component("table:Users"), component("table:Orders")],
    relationships: [],
  });

  assert.equal(report.hasDrift, true);
  assert.deepEqual(report.removedRelationships, [relationship()]);
  assert.deepEqual(model.relationships, []);
  assert.match(report.summary, /-1 relationship/);
});

test("mergeArchitecture preserves relationships from other source files", () => {
  const model = emptyModel();
  const otherRelationship = relationship("table:Invoices", "table:Users", "other.sql");
  mergeArchitecture(model, "schema.sql", {
    components: [component("table:Users"), component("table:Orders")],
    relationships: [relationship()],
  });
  mergeArchitecture(model, "other.sql", {
    components: [component("table:Invoices", "v1", "other.sql")],
    relationships: [otherRelationship],
  });

  mergeArchitecture(model, "schema.sql", {
    components: [component("table:Users"), component("table:Orders")],
    relationships: [],
  });

  assert.deepEqual(model.relationships, [otherRelationship]);
});

test("mergeArchitecture treats relationship-only changes as drift", () => {
  const model = emptyModel();
  mergeArchitecture(model, "schema.sql", {
    components: [component("table:Users"), component("table:Orders")],
    relationships: [],
  });

  const report = mergeArchitecture(model, "schema.sql", {
    components: [component("table:Users"), component("table:Orders")],
    relationships: [relationship()],
  });

  assert.equal(report.added.length, 0);
  assert.equal(report.modified.length, 0);
  assert.equal(report.removed.length, 0);
  assert.equal(report.hasDrift, true);
  assert.deepEqual(report.addedRelationships, [relationship()]);
});
