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

test("cli help mentions watcher preview mode", async () => {
  const root = await makeTempRepo("cli-help");

  const { stdout } = await execFileAsync("node", [cliPath], { cwd: root, env: cliEnv });

  assert.match(stdout, /blug watch --preview/);
});

test("cli diagram can focus on one component neighborhood", async () => {
  const root = await makeTempRepo("cli-diagram-focus");
  await writeFile(
    root,
    ".blug/model.json",
    JSON.stringify({
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
        "table:Orders": {
          id: "table:Orders",
          kind: "table",
          name: "Orders",
          sourceFile: "schema.sql",
          lastChanged: "2026-08-01T00:00:00.000Z",
        },
      },
      relationships: [
        {
          from: "endpoint:GET /users",
          to: "table:Users",
          label: "queries",
          sourceFile: "routes/users.ts",
        },
        {
          from: "table:Users",
          to: "queue:user-events",
          label: "publishes",
          sourceFile: "schema.sql",
        },
      ],
    })
  );

  const { stdout } = await execFileAsync("node", [cliPath, "diagram", "--focus", "GET /users", "--depth", "2"], {
    cwd: root,
    env: cliEnv,
  });

  assert.match(stdout, /GET \/users/);
  assert.match(stdout, /Users/);
  assert.match(stdout, /user-events/);
  assert.match(stdout, /queries/);
  assert.match(stdout, /publishes/);
  assert.doesNotMatch(stdout, /Orders/);
});
