import test from "node:test";
import assert from "node:assert/strict";
import { emptyModel, type Component } from "../src/types.js";
import { mergeComponents } from "../src/store.js";

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
