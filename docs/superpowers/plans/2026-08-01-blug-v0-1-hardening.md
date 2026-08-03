# blug v0.1 Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the README-described blug workflow reliable, test-covered, and ready for local dogfooding across CLI, daemon, and MCP modes.

**Architecture:** Keep the current simple pipeline: classify changed paths, extract components, merge them into `.blug/model.json`, render `ARCHITECTURE.md`, and notify callers. Add tests around each boundary before changing behavior, then make small fixes where the implementation currently falls short of the README promise.

**Tech Stack:** TypeScript `NodeNext`, Node.js built-in `node:test`, Node `assert/strict`, `chokidar`, `node-notifier`, `@modelcontextprotocol/sdk`.

## Global Constraints

- Preserve the project goal from `README.md`: agent-agnostic filesystem watching and on-demand MCP/CLI operation.
- Keep extraction regex-based, deterministic, offline, and conservative.
- Do not add an LLM dependency or network requirement.
- Prefer standard Node tooling over adding a test framework dependency.
- Maintain ESM imports with `.js` suffixes in TypeScript source and tests.
- Current workspace did not have `node_modules`; run `npm install` before any build or test commands.
- Current workspace was not a Git repository when this plan was written; commit steps assume execution happens in a Git checkout or after `git init`.

---

## File Structure

- Modify `package.json`: add `test`, `test:build`, and `typecheck` scripts.
- Create `tsconfig.test.json`: compile `src/**/*.ts` plus `tests/**/*.test.ts` into `.tmp/test-dist`.
- Create `tests/test-helpers.ts`: shared temporary workspace helpers and timestamp stripping.
- Create `tests/classify.test.ts`: executable coverage for README classification and ignores.
- Create `tests/analyzer.test.ts`: executable coverage for schema, API, infra, dependency, and messaging extraction.
- Create `tests/store.test.ts`: executable coverage for merge add/remove/modify semantics.
- Create `tests/core.test.ts`: executable coverage for full scan, single-file scan, deleted-file cleanup, and no-op handling.
- Create `tests/diagram.test.ts`: executable coverage for deterministic Mermaid and Markdown rendering.
- Create `tests/cli.test.ts`: executable coverage for CLI commands against a temporary repo.
- Modify `src/types.ts`: add `sourceFile` to `DriftReport`.
- Modify `src/store.ts`: include `sourceFile` in reports and preserve timestamps for unchanged components.
- Modify `src/core.ts`: normalize path handling, remove components when a relevant source file is deleted, and save an initial empty diagram on `init`.
- Modify `src/diagram.ts`: sort groups and escape labels consistently.
- Modify `src/cli.ts`: fix report-to-file attribution, print useful check output, and wire `init` through an explicit full scan.
- Modify `src/mcp-server.ts`: validate tool arguments and normalize paths before scanning.
- Modify `src/watcher.ts`: handle unlink events and log watcher errors.
- Modify `README.md`: align setup, test, and command examples with the hardened behavior.
- Modify `docs/codex-setup.md`: align MCP setup and usage notes with the final tool behavior.

---

### Task 1: Add a Zero-Dependency Test Harness

**Files:**
- Modify: `package.json`
- Create: `tsconfig.test.json`
- Create: `tests/test-helpers.ts`

**Interfaces:**
- Consumes: existing TypeScript source under `src/**/*.ts`.
- Produces: `npm test`, `npm run test:build`, `npm run typecheck`, `makeTempRepo(name: string): Promise<string>`, `writeFile(root: string, relPath: string, content: string): Promise<void>`, `readFile(root: string, relPath: string): Promise<string>`, `stripVolatileComponentFields<T>(value: T): T`.

- [ ] **Step 1: Install dependencies**

Run:

```bash
npm install
```

Expected: `node_modules/.bin/tsc` exists and `package-lock.json` remains consistent with `package.json`.

- [ ] **Step 2: Add failing test scripts**

Change the `scripts` block in `package.json` to:

```json
{
  "build": "tsc -p .",
  "typecheck": "tsc -p . --noEmit",
  "test:build": "tsc -p tsconfig.test.json",
  "test": "npm run build && npm run test:build && node --test .tmp/test-dist/tests/*.test.js",
  "watch:daemon": "tsc -p . && node dist/watcher.js",
  "mcp": "tsc -p . && node dist/mcp-server.js"
}
```

- [ ] **Step 3: Add test TypeScript config**

Create `tsconfig.test.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": ".tmp/test-dist",
    "rootDir": ".",
    "declaration": false,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "tests/**/*.test.ts", "tests/test-helpers.ts"]
}
```

- [ ] **Step 4: Add shared test helpers**

Create `tests/test-helpers.ts`:

```ts
import { promises as fs } from "fs";
import os from "os";
import path from "path";

export async function makeTempRepo(name: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `blug-${name}-`));
}

export async function writeFile(root: string, relPath: string, content: string): Promise<void> {
  const fullPath = path.join(root, relPath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, "utf-8");
}

export async function readFile(root: string, relPath: string): Promise<string> {
  return await fs.readFile(path.join(root, relPath), "utf-8");
}

export function stripVolatileComponentFields<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (key, current) => (key === "lastChanged" ? "<timestamp>" : current))
  ) as T;
}
```

- [ ] **Step 5: Run test build and verify it fails because no tests exist yet**

Run:

```bash
npm run test:build
```

Expected: PASS. The harness compiles even before test files are added.

- [ ] **Step 6: Run the full test command and verify the runner is wired**

Run:

```bash
npm test
```

Expected: PASS with zero or no discovered tests, after `npm run build` and `npm run test:build` complete.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.test.json tests/test-helpers.ts
git commit -m "test: add node test harness"
```

---

### Task 2: Lock the README Classification Contract

**Files:**
- Create: `tests/classify.test.ts`
- Modify: `src/classify.ts`

**Interfaces:**
- Consumes: `classify(relPath: string): Classification`.
- Produces: stable classification for schema, API, infra, deps, messaging, and ignored paths documented in `README.md`.

- [ ] **Step 1: Write the failing classifier tests**

Create `tests/classify.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the classifier tests**

Run:

```bash
npm test
```

Expected before implementation: FAIL if any README-listed pattern is missing or any ignore rule leaks.

- [ ] **Step 3: Tighten ignore rules and add missing patterns**

Update `src/classify.ts` so the relevant sections include these rules:

```ts
const RULES: Array<{ category: ArchCategory; test: RegExp }> = [
  { category: "schema", test: /(^|\/)migrations?\//i },
  { category: "schema", test: /\.sql$/i },
  { category: "schema", test: /schema\.(prisma|graphql)$/i },
  { category: "schema", test: /(^|\/)models?\/.*\.(py|ts|js|cs|java|rb)$/i },
  { category: "schema", test: /\.edmx$/i },
  { category: "schema", test: /dbcontext.*\.cs$/i },

  { category: "api", test: /(^|\/)(routes?|controllers?|api|endpoints?)\/.*\.(ts|js|py|cs|java|rb|go)$/i },
  { category: "api", test: /openapi\.(ya?ml|json)$/i },
  { category: "api", test: /\.proto$/i },
  { category: "api", test: /schema\.graphql$/i },

  { category: "infra", test: /docker-compose\.ya?ml$/i },
  { category: "infra", test: /(^|\/)Dockerfile(?:\..*)?$/i },
  { category: "infra", test: /\.tf$/i },
  { category: "infra", test: /(^|\/)k8s\/.*\.ya?ml$/i },
  { category: "infra", test: /(^|\/)\.github\/workflows\/.*\.ya?ml$/i },

  { category: "deps", test: /(^|\/)package\.json$/i },
  { category: "deps", test: /(^|\/)requirements\.txt$/i },
  { category: "deps", test: /(^|\/)go\.mod$/i },
  { category: "deps", test: /\.csproj$/i },
  { category: "deps", test: /(^|\/)pom\.xml$/i },

  { category: "messaging", test: /(^|\/)(events?|topics?|queues?)\/.*\.(ts|js|py|cs|java)$/i },
];
```

Keep the existing `IGNORE` list, but make generated directory matching handle nested paths and root paths:

```ts
const IGNORE = [
  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)\.git\//,
  /(^|\/)\.blug\//,
  /\.test\.|\.spec\./,
  /\.md$/i,
];
```

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
npm test
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/classify.ts tests/classify.test.ts
git commit -m "test: lock architecture classification rules"
```

---

### Task 3: Cover and Harden Component Extraction

**Files:**
- Create: `tests/analyzer.test.ts`
- Modify: `src/analyzer.ts`

**Interfaces:**
- Consumes: `extractComponents(relPath: string, category: ArchCategory, content: string): Component[]`.
- Produces: deterministic component IDs and details for schema, API, infra, dependency, and messaging extraction.

- [ ] **Step 1: Write failing analyzer tests**

Create `tests/analyzer.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { extractComponents } from "../src/analyzer.js";
import { stripVolatileComponentFields } from "./test-helpers.js";

test("extracts SQL, Prisma, and EF schema components", () => {
  const sql = extractComponents(
    "migrations/001.sql",
    "schema",
    "CREATE TABLE dbo.Users (id int);\nALTER TABLE [Orders] ADD status text;"
  );
  assert.deepEqual(stripVolatileComponentFields(sql), [
    {
      id: "table:Users",
      kind: "table",
      name: "Users",
      sourceFile: "migrations/001.sql",
      detail: "CREATE TABLE",
      lastChanged: "<timestamp>",
    },
    {
      id: "table:Orders",
      kind: "table",
      name: "Orders",
      sourceFile: "migrations/001.sql",
      detail: "ALTER TABLE",
      lastChanged: "<timestamp>",
    },
  ]);

  const prisma = extractComponents("prisma/schema.prisma", "schema", "model Invoice {\n  id String @id\n}");
  assert.equal(prisma[0]?.id, "table:Invoice");

  const ef = extractComponents("Data/AppDbContext.cs", "schema", "public DbSet<Customer> Customers { get; set; }");
  assert.equal(ef[0]?.detail, "EF Core DbSet");
});

test("extracts common API route declarations", () => {
  const js = extractComponents(
    "src/routes/orders.ts",
    "api",
    "router.get('/orders', list);\napp.post(\"/orders\", create);"
  );
  assert.deepEqual(js.map((c) => c.id), ["endpoint:GET /orders", "endpoint:POST /orders"]);

  const dotnet = extractComponents("Controllers/OrdersController.cs", "api", "[HttpGet(\"orders/{id}\")]\npublic IActionResult Get() => Ok();");
  assert.equal(dotnet[0]?.id, "endpoint:GET orders/{id}");

  const py = extractComponents("api/orders.py", "api", "@router.delete('/orders/{id}')\ndef delete_order(): pass");
  assert.equal(py[0]?.id, "endpoint:DELETE /orders/{id}");
});

test("extracts docker compose services, Dockerfile service, dependencies, and queues", () => {
  const compose = extractComponents(
    "docker-compose.yml",
    "infra",
    "services:\n  api:\n    build: .\n  worker-service:\n    image: worker\nvolumes:\n  data:"
  );
  assert.deepEqual(compose.map((c) => c.id), ["service:api", "service:worker-service"]);

  const dockerfile = extractComponents("services/billing/Dockerfile", "infra", "FROM node:22");
  assert.equal(dockerfile[0]?.id, "service:services/billing");

  const deps = extractComponents(
    "package.json",
    "deps",
    JSON.stringify({ dependencies: { express: "^4.0.0" }, devDependencies: { typescript: "^5.5.4" } })
  );
  assert.deepEqual(deps.map((c) => `${c.id}:${c.detail}`), [
    "dependency:express:^4.0.0",
    "dependency:typescript:^5.5.4",
  ]);

  const queues = extractComponents("events/orders.ts", "messaging", "const topic = 'orders.created';\nqueue: 'billing'");
  assert.deepEqual(queues.map((c) => c.id), ["queue:orders.created", "queue:billing"]);
});

test("skips malformed package json without throwing", () => {
  assert.deepEqual(extractComponents("package.json", "deps", "{"), []);
});
```

- [ ] **Step 2: Run analyzer tests**

Run:

```bash
npm test
```

Expected before implementation: FAIL if SQL bracket handling, docker compose parsing, or messaging extraction does not match the expected contract.

- [ ] **Step 3: Update SQL table extraction to support bracketed names without losing names**

Replace the SQL regex in `extractSchema()` with:

```ts
const sqlTable = /\b(CREATE|ALTER)\s+TABLE\s+(?:\[?dbo\]?\.)?\[?([A-Za-z_][\w]*)\]?/gi;
```

Keep the existing loop body.

- [ ] **Step 4: Make dependency output stable**

In `extractDeps()`, replace `for (const name of Object.keys(deps))` with:

```ts
for (const name of Object.keys(deps).sort((a, b) => a.localeCompare(b))) {
```

- [ ] **Step 5: Run tests and typecheck**

Run:

```bash
npm test
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/analyzer.ts tests/analyzer.test.ts
git commit -m "test: cover architecture extraction"
```

---

### Task 4: Fix Store Drift Semantics

**Files:**
- Create: `tests/store.test.ts`
- Modify: `src/types.ts`
- Modify: `src/store.ts`

**Interfaces:**
- Consumes: `mergeComponents(model: ArchitectureModel, sourceFile: string, newComponents: Component[]): DriftReport`.
- Produces: `DriftReport.sourceFile: string`, accurate added/removed/modified arrays, and unchanged components that do not rewrite `lastChanged`.

- [ ] **Step 1: Write failing store tests**

Create `tests/store.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { emptyModel, Component } from "../src/types.js";
import { mergeComponents } from "../src/store.js";

function component(id: string, detail = "v1"): Component {
  return {
    id,
    kind: "table",
    name: id.split(":")[1] ?? id,
    sourceFile: "schema.sql",
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
```

- [ ] **Step 2: Run store tests**

Run:

```bash
npm test
```

Expected before implementation: FAIL because `DriftReport` has no `sourceFile` and unchanged merges refresh `lastChanged`.

- [ ] **Step 3: Add sourceFile to DriftReport**

Update `src/types.ts`:

```ts
export interface DriftReport {
  sourceFile: string;
  hasDrift: boolean;
  added: Component[];
  removed: Component[];
  modified: Component[];
  summary: string;
}
```

- [ ] **Step 4: Preserve unchanged timestamps and return sourceFile**

In `src/store.ts`, replace the unchanged branch in `mergeComponents()` with:

```ts
} else {
  model.components[comp.id] = existing;
}
```

Return `sourceFile` in the `DriftReport` object:

```ts
return {
  sourceFile,
  hasDrift,
  added,
  removed,
  modified,
  summary: hasDrift ? parts.join("; ") : "no architectural drift",
};
```

- [ ] **Step 5: Run tests and typecheck**

Run:

```bash
npm test
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/store.ts tests/store.test.ts
git commit -m "fix: stabilize drift reports"
```

---

### Task 5: Make Core Scans Handle Deleted Files and Initial Diagrams

**Files:**
- Create: `tests/core.test.ts`
- Modify: `src/core.ts`

**Interfaces:**
- Consumes: `scanAndUpdate(root: string, paths: string[]): Promise<DriftReport[]>`.
- Produces: `scanAndUpdate(root, paths, options?)` with optional `{ writeWhenNoDrift?: boolean }`, deleted-file cleanup for relevant paths, and safe relative path normalization.

- [ ] **Step 1: Write failing core tests**

Create `tests/core.test.ts`:

```ts
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
  assert.match(await readFile(root, "ARCHITECTURE.md"), /table_Users\["Users"\]/);
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
```

- [ ] **Step 2: Run core tests**

Run:

```bash
npm test
```

Expected before implementation: FAIL on deleted-file cleanup, empty initial diagram writing, and outside-root path rejection.

- [ ] **Step 3: Add scan options and path normalization**

Update `src/core.ts` imports and signatures:

```ts
import { promises as fs } from "fs";
import path from "path";
import { classify } from "./classify.js";
import { extractComponents } from "./analyzer.js";
import { loadModel, saveModel, mergeComponents } from "./store.js";
import { renderMarkdown } from "./diagram.js";
import { DriftReport } from "./types.js";

export interface ScanOptions {
  writeWhenNoDrift?: boolean;
}

function normalizeRelPath(root: string, inputPath: string): string {
  const resolved = path.resolve(root, inputPath);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to scan path outside repository root: ${inputPath}`);
  }
  return relative;
}
```

- [ ] **Step 4: Update scanAndUpdate implementation**

Replace `scanAndUpdate()` in `src/core.ts` with:

```ts
export async function scanAndUpdate(
  root: string,
  paths: string[],
  options: ScanOptions = {}
): Promise<DriftReport[]> {
  const model = await loadModel(root);
  const reports: DriftReport[] = [];

  for (const inputPath of paths) {
    const relPath = normalizeRelPath(root, inputPath);
    const { isArchRelevant, category } = classify(relPath);
    if (!isArchRelevant || !category) continue;

    let components = [];
    try {
      const content = await fs.readFile(path.join(root, relPath), "utf-8");
      components = extractComponents(relPath, category, content);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
    }

    const report = mergeComponents(model, relPath, components);
    if (report.hasDrift) reports.push(report);
  }

  if (reports.length > 0 || options.writeWhenNoDrift) {
    await saveModel(root, model);
    await fs.writeFile(path.join(root, "ARCHITECTURE.md"), renderMarkdown(model), "utf-8");
  }

  return reports;
}
```

- [ ] **Step 5: Run tests and typecheck**

Run:

```bash
npm test
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core.ts tests/core.test.ts
git commit -m "fix: handle scan lifecycle edge cases"
```

---

### Task 6: Make Diagram Rendering Deterministic and Escaped

**Files:**
- Create: `tests/diagram.test.ts`
- Modify: `src/diagram.ts`

**Interfaces:**
- Consumes: `renderMermaid(model: ArchitectureModel): string`, `renderMarkdown(model: ArchitectureModel): string`.
- Produces: stable group ordering, stable component ordering, safe Mermaid labels, and Markdown output that remains readable with no components.

- [ ] **Step 1: Write failing diagram tests**

Create `tests/diagram.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { ArchitectureModel } from "../src/types.js";
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
    { from: "endpoint:GET /orders", to: "table:Orders", label: "reads \"latest\"" },
  ],
};

test("renderMermaid emits deterministic groups and escaped labels", () => {
  assert.equal(
    renderMermaid(model),
    [
      "flowchart LR",
      "  subgraph table[\"Database\"]",
      "    table_Orders[\"Orders\"]",
      "  end",
      "  subgraph endpoint[\"API\"]",
      "    endpoint_GET__orders[\"GET /orders\"]",
      "  end",
      "  subgraph dependency[\"Dependencies\"]",
      "    dependency__scope_pkg[\"@scope/pkg \\\"quoted\\\"\"]",
      "  end",
      "  endpoint_GET__orders -->|reads \\\"latest\\\"| table_Orders",
    ].join("\n")
  );
});

test("renderMarkdown includes empty-state text when no components exist", () => {
  const empty: ArchitectureModel = {
    version: 1,
    updatedAt: "2026-08-01T00:00:00.000Z",
    components: {},
    relationships: [],
  };
  assert.match(renderMarkdown(empty), /_No components detected yet\._/);
  assert.match(renderMarkdown(empty), /```mermaid\nflowchart LR\n```/);
});
```

- [ ] **Step 2: Run diagram tests**

Run:

```bash
npm test
```

Expected before implementation: FAIL because group order currently depends on component insertion order and labels are not escaped.

- [ ] **Step 3: Add deterministic kind order and label escaping**

In `src/diagram.ts`, add:

```ts
const KIND_ORDER: ComponentKind[] = ["table", "endpoint", "service", "dependency", "queue", "job"];

function escapeLabel(label: string): string {
  return label.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
```

Replace the group loop with:

```ts
for (const kind of KIND_ORDER) {
  const comps = byKind.get(kind) ?? [];
  if (comps.length === 0) continue;
  lines.push(`  subgraph ${sanitizeId(kind)}["${GROUP_LABEL[kind]}"]`);
  for (const c of comps.sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(`    ${sanitizeId(c.id)}["${escapeLabel(c.name)}"]`);
  }
  lines.push("  end");
}
```

Replace relationship label rendering with:

```ts
const label = rel.label ? `|${escapeLabel(rel.label)}|` : "";
```

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
npm test
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/diagram.ts tests/diagram.test.ts
git commit -m "fix: render deterministic architecture diagrams"
```

---

### Task 7: Fix CLI Behavior and Baseline Initialization

**Files:**
- Create: `tests/cli.test.ts`
- Modify: `src/cli.ts`

**Interfaces:**
- Consumes: CLI commands `init`, `check [files]`, `diagram`.
- Produces: accurate file names in alerts/output, `init` that always writes `ARCHITECTURE.md`, and helpful stdout for check results.

- [ ] **Step 1: Write failing CLI tests**

Create `tests/cli.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "child_process";
import { promisify } from "util";
import { makeTempRepo, readFile, writeFile } from "./test-helpers.js";

const execFileAsync = promisify(execFile);
const cliPath = new URL("../src/cli.js", import.meta.url).pathname.replace("/.tmp/test-dist/", "/dist/");

test("cli init writes an architecture markdown baseline", async () => {
  const root = await makeTempRepo("cli-init");
  await writeFile(root, "README.md", "# test repo\n");

  const { stdout } = await execFileAsync("node", [cliPath, "init"], { cwd: root });

  assert.match(stdout, /baseline seeded/);
  assert.match(await readFile(root, "ARCHITECTURE.md"), /_No components detected yet\._/);
});

test("cli check reports the actual changed architecture file", async () => {
  const root = await makeTempRepo("cli-check");
  await writeFile(root, "README.md", "# ignored\n");
  await writeFile(root, "migrations/001.sql", "CREATE TABLE Users (id int);");

  const { stdout } = await execFileAsync("node", [cliPath, "check", "README.md", "migrations/001.sql"], {
    cwd: root,
  });

  assert.match(stdout, /architecture change in migrations\/001\.sql/);
  assert.doesNotMatch(stdout, /architecture change in README\.md/);
});
```

- [ ] **Step 2: Run CLI tests**

Run:

```bash
npm test
```

Expected before implementation: FAIL because `init` does not write an empty diagram and `check` can attribute a report to the wrong path when ignored files precede relevant files.

- [ ] **Step 3: Use report.sourceFile in CLI output**

In `src/cli.ts`, replace the check branch loop with:

```ts
for (const report of reports) {
  alertDrift(report, report.sourceFile);
}
if (reports.length === 0) {
  console.log("[blug] no architecture drift detected");
}
return;
```

- [ ] **Step 4: Make init force baseline files**

In `src/cli.ts`, replace the `init` branch scan call with:

```ts
const reports = await scanAndUpdate(root, paths, { writeWhenNoDrift: true });
```

- [ ] **Step 5: Run tests and typecheck**

Run:

```bash
npm test
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts tests/cli.test.ts
git commit -m "fix: make cli reports accurate"
```

---

### Task 8: Harden MCP and Watcher Entrypoints

**Files:**
- Modify: `src/mcp-server.ts`
- Modify: `src/watcher.ts`

**Interfaces:**
- Consumes: `scanAndUpdate(root, paths, options?)`.
- Produces: MCP argument validation, clearer MCP errors, watcher handling for add/change/unlink, and watcher error logging.

- [ ] **Step 1: Add manual MCP argument validation**

In `src/mcp-server.ts`, add:

```ts
function parsePathsArg(args: unknown): string[] | undefined {
  if (!args || typeof args !== "object") return undefined;
  const paths = (args as { paths?: unknown }).paths;
  if (paths === undefined) return undefined;
  if (!Array.isArray(paths) || !paths.every((pathValue) => typeof pathValue === "string")) {
    throw new Error("check_architecture_drift.paths must be an array of strings");
  }
  return paths;
}
```

Replace the paths extraction in the `check_architecture_drift` branch with:

```ts
const paths = parsePathsArg(args) ?? (await walkRepo(root));
```

- [ ] **Step 2: Improve MCP drift output**

Replace the MCP drift text construction with:

```ts
const text = hasDrift
  ? `Architecture drift detected:\n` +
    reports.map((r) => `- ${r.sourceFile}: ${r.summary}`).join("\n")
  : "No architecture drift detected.";
```

- [ ] **Step 3: Handle deletes and watcher errors**

In `src/watcher.ts`, replace `handleChange` with:

```ts
async function handleChange(relPath: string) {
  try {
    const reports = await scanAndUpdate(root, [relPath]);
    for (const report of reports) {
      alertDrift(report, report.sourceFile);
    }
  } catch (error) {
    console.error(`[blug] failed to process ${relPath}:`, error);
  }
}
```

Register unlink and error handlers:

```ts
watcher.on("add", handleChange);
watcher.on("change", handleChange);
watcher.on("unlink", handleChange);
watcher.on("error", (error) => {
  console.error("[blug] watcher error:", error);
});
```

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
npm test
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp-server.ts src/watcher.ts
git commit -m "fix: harden runtime entrypoints"
```

---

### Task 9: Update Documentation for the Hardened Workflow

**Files:**
- Modify: `README.md`
- Modify: `docs/codex-setup.md`

**Interfaces:**
- Consumes: final command behavior from Tasks 1-8.
- Produces: docs that tell users how to install, test, initialize, run, and integrate blug.

- [ ] **Step 1: Update README setup commands**

In `README.md`, change the setup block to:

```bash
npm install
npm test
npm run build
```

- [ ] **Step 2: Document baseline behavior**

In `README.md` under standalone daemon setup, replace the baseline paragraph with:

````markdown
Seed the baseline once per repo:

```bash
node /path/to/blug/dist/cli.js init
```

This creates `.blug/model.json` and `ARCHITECTURE.md`. If no components are
detected yet, `ARCHITECTURE.md` is still written with an empty-state diagram.
````

- [ ] **Step 3: Document deletion handling**

In `README.md` under "How it works", add this sentence after the store description:

```markdown
If an architecture-relevant file is deleted, blug removes components that were previously attributed to that file and regenerates the diagram.
```

- [ ] **Step 4: Update Codex MCP usage note**

In `docs/codex-setup.md`, replace the first tool bullet list with:

```markdown
- `check_architecture_drift` - scan specific relative paths, or omit `paths` to scan the whole repo. It updates `.blug/model.json` and `ARCHITECTURE.md` when drift is found.
- `get_architecture_diagram` - return the current Mermaid diagram without rescanning.
```

- [ ] **Step 5: Run docs-adjacent verification**

Run:

```bash
npm test
npm run build
node dist/cli.js init
node dist/cli.js diagram
```

Expected: tests and build pass; `init` prints `baseline seeded`; `diagram` prints Mermaid beginning with `flowchart LR`.

- [ ] **Step 6: Commit**

```bash
git add README.md docs/codex-setup.md
git commit -m "docs: document hardened blug workflow"
```

---

## Self-Review

- Spec coverage: The plan covers README setup, standalone daemon, MCP server, CLI check/init/diagram, classifier categories, analyzer extraction categories, model merge/diff, diagram output, and notifications.
- Known limitations preserved: extraction remains regex-based and relationship inference remains out of scope.
- Placeholder scan: No forbidden placeholder markers or unspecified test steps remain.
- Type consistency: `DriftReport.sourceFile` is added in `src/types.ts`, produced in `src/store.ts`, and consumed by `src/cli.ts`, `src/mcp-server.ts`, and `src/watcher.ts`.
- Residual risk: CLI tests execute `dist/cli.js`, so they require `npm run build` to run first; this is enforced by the `npm test` script.
