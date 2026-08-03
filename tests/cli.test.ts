import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "child_process";
import path from "path";
import { promisify } from "util";
import { makeTempRepo, readFile, writeFile } from "./test-helpers.js";

const execFileAsync = promisify(execFile);
const cliPath = path.resolve(process.cwd(), "dist/cli.js");
const cliEnv = { ...process.env, BLUG_NOTIFY: "0" };

test("cli init writes an architecture markdown baseline", async () => {
  const root = await makeTempRepo("cli-init");
  await writeFile(root, "README.md", "# test repo\n");

  const { stdout } = await execFileAsync("node", [cliPath, "init"], { cwd: root, env: cliEnv });

  assert.match(stdout, /baseline seeded/);
  assert.match(await readFile(root, "ARCHITECTURE.md"), /_No components detected yet\._/);
});

test("cli check reports the actual changed architecture file", async () => {
  const root = await makeTempRepo("cli-check");
  await writeFile(root, "README.md", "# ignored\n");
  await writeFile(root, "migrations/001.sql", "CREATE TABLE Users (id int);");

  const { stdout } = await execFileAsync("node", [cliPath, "check", "README.md", "migrations/001.sql"], {
    cwd: root,
    env: cliEnv,
  });

  assert.match(stdout, /architecture change in migrations\/001\.sql/);
  assert.doesNotMatch(stdout, /architecture change in README\.md/);
});
