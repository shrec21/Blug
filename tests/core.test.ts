import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import path from "path";
import { scanAndUpdate } from "../src/core.js";
import { loadModel } from "../src/store.js";
import { makeTempRepo, readFile, writeFile } from "./test-helpers.js";

test("scanAndUpdate writes model and architecture markdown for new components", async () => {
  const root = await makeTempRepo("core-add");
  await writeFile(root, "migrations/001.sql", "CREATE TABLE Users (id int);");

  const reports = await scanAndUpdate(root, ["migrations/001.sql"]);

  assert.equal(reports.length, 1);
  assert.equal(reports[0]?.sourceFile, "migrations/001.sql");
  assert.equal((await loadModel(root)).components["table:Users"]?.name, "Users");
  assert.match(await readFile(root, "ARCHITECTURE.md"), /Users/);
});

test("scanAndUpdate removes components when an architecture-relevant file is deleted", async () => {
  const root = await makeTempRepo("core-delete");
  await writeFile(root, "migrations/001.sql", "CREATE TABLE Users (id int);");
  await scanAndUpdate(root, ["migrations/001.sql"]);
  await fs.unlink(path.join(root, "migrations/001.sql"));

  const reports = await scanAndUpdate(root, ["migrations/001.sql"]);

  assert.equal(reports.length, 1);
  assert.deepEqual(reports[0]?.removed.map((c) => c.id), ["table:Users"]);
  assert.equal((await loadModel(root)).components["table:Users"], undefined);
});

test("scanAndUpdate can write an empty initial diagram", async () => {
  const root = await makeTempRepo("core-empty-init");

  const reports = await scanAndUpdate(root, ["README.md"], { writeWhenNoDrift: true });

  assert.deepEqual(reports, []);
  assert.match(await readFile(root, "ARCHITECTURE.md"), /_No components detected yet\._/);
});

test("scanAndUpdate rejects paths outside the scanned root", async () => {
  const root = await makeTempRepo("core-paths");
  await assert.rejects(
    () => scanAndUpdate(root, ["../outside/package.json"]),
    /outside repository root/
  );
});

test("scanAndUpdate writes architecture markdown for relationship-only drift", async () => {
  const root = await makeTempRepo("core-relationships");
  await writeFile(
    root,
    "migrations/001.sql",
    "CREATE TABLE Users (id int);\nCREATE TABLE Orders (id int, user_id int);"
  );
  await scanAndUpdate(root, ["migrations/001.sql"]);

  await writeFile(
    root,
    "migrations/001.sql",
    [
      "CREATE TABLE Users (id int);",
      "CREATE TABLE Orders (",
      "  id int,",
      "  user_id int REFERENCES Users(id)",
      ");",
    ].join("\n")
  );
  const reports = await scanAndUpdate(root, ["migrations/001.sql"]);

  assert.equal(reports.length, 1);
  assert.deepEqual((await loadModel(root)).relationships, [
    {
      from: "table:Orders",
      to: "table:Users",
      label: "FK",
      sourceFile: "migrations/001.sql",
    },
  ]);
  assert.match(await readFile(root, "ARCHITECTURE.md"), /table_Orders -->\|FK\| table_Users/);
});

test("scanAndUpdate extracts docker-compose depends_on relationships", async () => {
  const root = await makeTempRepo("core-docker-depends");
  await writeFile(
    root,
    "docker-compose.yml",
    [
      "services:",
      "  api:",
      "    build: .",
      "    depends_on:",
      "      - db",
      "  db:",
      "    image: postgres",
    ].join("\n")
  );

  const reports = await scanAndUpdate(root, ["docker-compose.yml"]);

  assert.equal(reports.length, 1);
  const model = await loadModel(root);
  assert.deepEqual(model.relationships, [
    {
      from: "service:api",
      to: "service:db",
      label: "depends_on",
      sourceFile: "docker-compose.yml",
    },
  ]);
  assert.match(
    await readFile(root, "ARCHITECTURE.md"),
    /service_api -->\|depends_on\| service_db/
  );
});

test("scanAndUpdate infers endpoint-to-table relationships via import chain", async () => {
  const root = await makeTempRepo("core-import-chain");
  await writeFile(
    root,
    "src/data/schema.ts",
    [
      "db.exec(`",
      "  CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT);",
      "  CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id));",
      "`);",
    ].join("\n")
  );
  await writeFile(
    root,
    "src/data/queries.ts",
    [
      "import { db } from './schema';",
      "export function getAllUsers() { return db.prepare('SELECT * FROM users').all(); }",
      "export function insertOrder(uid: number) { const u = db.prepare('SELECT id FROM users WHERE id = ?').get(uid); db.prepare('INSERT INTO orders VALUES (?, ?)').run(1, uid); }",
    ].join("\n")
  );
  await writeFile(
    root,
    "src/api/routes.ts",
    [
      "import { getAllUsers, insertOrder } from '../data/queries';",
      "app.get('/users', async (req, res) => { res.json(getAllUsers()); });",
      "app.post('/orders', async (req, res) => { insertOrder(1); res.json({ ok: true }); });",
    ].join("\n")
  );

  await scanAndUpdate(root, [
    "src/data/schema.ts",
    "src/data/queries.ts",
    "src/api/routes.ts",
  ]);

  const model = await loadModel(root);
  const queries = model.relationships.filter((r) => r.label === "queries");
  const queryDescs = queries.map((r) => `${r.from} -> ${r.to}`).sort();

  assert.ok(queryDescs.includes("endpoint:GET /users -> table:users"), "GET /users should query users table");
  assert.ok(queryDescs.includes("endpoint:POST /orders -> table:orders"), "POST /orders should query orders table");
  assert.ok(queryDescs.includes("endpoint:POST /orders -> table:users"), "POST /orders should query users table (via insertOrder)");
});

test("scanAndUpdate infers service-to-endpoint relationships from build context", async () => {
  const root = await makeTempRepo("core-service-endpoint");
  await writeFile(
    root,
    "docker-compose.yml",
    [
      "services:",
      "  api:",
      "    build: ./backend",
      "  db:",
      "    image: postgres",
    ].join("\n")
  );
  await writeFile(
    root,
    "backend/routes/orders.ts",
    "router.get('/orders', list);"
  );

  await scanAndUpdate(root, [
    "docker-compose.yml",
    "backend/routes/orders.ts",
  ]);

  const model = await loadModel(root);
  const exposes = model.relationships.filter((r) => r.label === "exposes");
  assert.deepEqual(exposes, [
    {
      from: "service:api",
      to: "endpoint:GET /orders",
      label: "exposes",
      sourceFile: "docker-compose.yml",
    },
  ]);
});

test("scanAndUpdate infers endpoint-to-module relationships via import chain", async () => {
  const root = await makeTempRepo("core-endpoint-module");
  await writeFile(
    root,
    "src/engine/deadline-engine.ts",
    "export function computeDeadlines() { return []; }"
  );
  await writeFile(
    root,
    "src/engine/alert-engine.ts",
    "export function getAlerts() { return []; }"
  );
  await writeFile(
    root,
    "src/api/routes.ts",
    [
      "import { computeDeadlines } from '../engine/deadline-engine';",
      "import { getAlerts } from '../engine/alert-engine';",
      "app.get('/deadlines', async (req, res) => { res.json(computeDeadlines()); });",
      "app.get('/alerts', async (req, res) => { res.json(getAlerts()); });",
    ].join("\n")
  );

  await scanAndUpdate(root, [
    "src/engine/deadline-engine.ts",
    "src/engine/alert-engine.ts",
    "src/api/routes.ts",
  ]);

  const model = await loadModel(root);
  assert.equal(model.components["module:deadline-engine"]?.kind, "module");
  assert.equal(model.components["module:alert-engine"]?.kind, "module");

  const uses = model.relationships.filter((r) => r.label === "uses").map((r) => `${r.from} -> ${r.to}`).sort();
  assert.ok(uses.includes("endpoint:GET /deadlines -> module:deadline-engine"), "GET /deadlines should use deadline-engine");
  assert.ok(uses.includes("endpoint:GET /alerts -> module:alert-engine"), "GET /alerts should use alert-engine");
  assert.ok(!uses.includes("endpoint:GET /deadlines -> module:alert-engine"), "GET /deadlines should NOT use alert-engine");
});
