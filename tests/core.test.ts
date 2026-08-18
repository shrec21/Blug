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
