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

  const dotnet = extractComponents(
    "Controllers/OrdersController.cs",
    "api",
    "[HttpGet(\"orders/{id}\")]\npublic IActionResult Get() => Ok();"
  );
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
    JSON.stringify({
      dependencies: { zod: "^3.0.0", express: "^4.0.0" },
      devDependencies: { typescript: "^5.5.4" },
    })
  );
  assert.deepEqual(deps.map((c) => `${c.id}:${c.detail}`), [
    "dependency:express:^4.0.0",
    "dependency:typescript:^5.5.4",
    "dependency:zod:^3.0.0",
  ]);

  const queues = extractComponents("events/orders.ts", "messaging", "const topic = 'orders.created';\nqueue: 'billing'");
  assert.deepEqual(queues.map((c) => c.id), ["queue:orders.created", "queue:billing"]);
});

test("skips malformed package json without throwing", () => {
  assert.deepEqual(extractComponents("package.json", "deps", "{"), []);
});
