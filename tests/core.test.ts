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
