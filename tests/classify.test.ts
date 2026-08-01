import test from "node:test";
import assert from "node:assert/strict";
import { classify } from "../src/classify.js";

test("classifies README architecture-relevant file families", () => {
  assert.deepEqual(classify("migrations/001_create_users.sql"), {
    isArchRelevant: true,
    category: "schema",
  });
  assert.deepEqual(classify("prisma/schema.prisma"), {
    isArchRelevant: true,
    category: "schema",
  });
  assert.deepEqual(classify("src/routes/orders.ts"), {
    isArchRelevant: true,
    category: "api",
  });
  assert.deepEqual(classify("openapi.yaml"), {
    isArchRelevant: true,
    category: "api",
  });
  assert.deepEqual(classify("docker-compose.yml"), {
    isArchRelevant: true,
    category: "infra",
  });
  assert.deepEqual(classify("services/billing/Dockerfile"), {
    isArchRelevant: true,
    category: "infra",
  });
  assert.deepEqual(classify(".github/workflows/ci.yml"), {
    isArchRelevant: true,
    category: "infra",
  });
  assert.deepEqual(classify("package.json"), {
    isArchRelevant: true,
    category: "deps",
  });
  assert.deepEqual(classify("events/order-events.ts"), {
    isArchRelevant: true,
    category: "messaging",
  });
});

test("ignores generated files, dependencies, tests, docs, and unrelated code", () => {
  for (const relPath of [
    "node_modules/pkg/package.json",
    "dist/routes/orders.js",
    "build/schema.sql",
    ".git/config",
    ".blug/model.json",
    "src/routes/orders.test.ts",
    "src/routes/orders.spec.ts",
    "README.md",
    "src/components/Button.tsx",
  ]) {
    assert.deepEqual(classify(relPath), { isArchRelevant: false }, relPath);
  }
});
