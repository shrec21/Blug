import test from "node:test";
import assert from "node:assert/strict";
import { extractArchitecture, extractComponents } from "../src/analyzer.js";
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

test("extracts SQL tables with IF NOT EXISTS and foreign keys from TypeScript schema files", () => {
  const extraction = extractArchitecture(
    "src/data/schema.ts",
    "schema",
    [
      "db.exec(`",
      "  CREATE TABLE IF NOT EXISTS users (",
      "    id INTEGER PRIMARY KEY,",
      "    name TEXT",
      "  );",
      "  CREATE TABLE IF NOT EXISTS orders (",
      "    id INTEGER PRIMARY KEY,",
      "    user_id INTEGER REFERENCES users(id),",
      "    total DECIMAL",
      "  );",
      "`);",
    ].join("\n")
  );

  assert.deepEqual(
    stripVolatileComponentFields(extraction.components),
    [
      {
        id: "table:users",
        kind: "table",
        name: "users",
        sourceFile: "src/data/schema.ts",
        detail: "CREATE TABLE",
        lastChanged: "<timestamp>",
      },
      {
        id: "table:orders",
        kind: "table",
        name: "orders",
        sourceFile: "src/data/schema.ts",
        detail: "CREATE TABLE",
        lastChanged: "<timestamp>",
      },
    ]
  );

  assert.deepEqual(extraction.relationships, [
    {
      from: "table:orders",
      to: "table:users",
      label: "FK",
      sourceFile: "src/data/schema.ts",
    },
  ]);
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

test("extracts SQL table-level foreign key relationships", () => {
  const extraction = extractArchitecture(
    "migrations/001.sql",
    "schema",
    [
      "CREATE TABLE Users (id int);",
      "CREATE TABLE Orders (",
      "  id int,",
      "  user_id int,",
      "  FOREIGN KEY (user_id) REFERENCES Users(id)",
      ");",
    ].join("\n")
  );

  assert.deepEqual(extraction.relationships, [
    {
      from: "table:Orders",
      to: "table:Users",
      label: "FK",
      sourceFile: "migrations/001.sql",
    },
  ]);
});

test("extracts SQL inline reference relationships", () => {
  const extraction = extractArchitecture(
    "migrations/002.sql",
    "schema",
    "CREATE TABLE Orders (\n  user_id int REFERENCES Users(id)\n);"
  );

  assert.deepEqual(extraction.relationships, [
    {
      from: "table:Orders",
      to: "table:Users",
      label: "FK",
      sourceFile: "migrations/002.sql",
    },
  ]);
});

test("extracts SQL alter table foreign key relationships", () => {
  const extraction = extractArchitecture(
    "migrations/003.sql",
    "schema",
    [
      "ALTER TABLE Orders",
      "ADD CONSTRAINT fk_orders_users",
      "FOREIGN KEY (user_id) REFERENCES Users(id);",
    ].join("\n")
  );

  assert.deepEqual(extraction.relationships, [
    {
      from: "table:Orders",
      to: "table:Users",
      label: "FK",
      sourceFile: "migrations/003.sql",
    },
  ]);
});

test("extracts Prisma relation relationships", () => {
  const extraction = extractArchitecture(
    "prisma/schema.prisma",
    "schema",
    [
      "model User {",
      "  id String @id",
      "}",
      "",
      "model Order {",
      "  id String @id",
      "  user User @relation(fields: [userId], references: [id])",
      "}",
    ].join("\n")
  );

  assert.deepEqual(extraction.relationships, [
    {
      from: "table:Order",
      to: "table:User",
      label: "relation",
      sourceFile: "prisma/schema.prisma",
    },
  ]);
});

test("extracts docker-compose depends_on relationships (short syntax)", () => {
  const extraction = extractArchitecture(
    "docker-compose.yml",
    "infra",
    [
      "services:",
      "  api:",
      "    build: .",
      "    depends_on:",
      "      - db",
      "      - redis",
      "  db:",
      "    image: postgres",
      "  redis:",
      "    image: redis",
    ].join("\n")
  );

  assert.deepEqual(extraction.relationships, [
    {
      from: "service:api",
      to: "service:db",
      label: "depends_on",
      sourceFile: "docker-compose.yml",
    },
    {
      from: "service:api",
      to: "service:redis",
      label: "depends_on",
      sourceFile: "docker-compose.yml",
    },
  ]);
});

test("extracts docker-compose depends_on relationships (long syntax with condition)", () => {
  const extraction = extractArchitecture(
    "docker-compose.yaml",
    "infra",
    [
      "services:",
      "  api:",
      "    build: .",
      "    depends_on:",
      "      db:",
      "        condition: service_healthy",
      "  db:",
      "    image: postgres",
    ].join("\n")
  );

  assert.deepEqual(extraction.relationships, [
    {
      from: "service:api",
      to: "service:db",
      label: "depends_on",
      sourceFile: "docker-compose.yaml",
    },
  ]);
});

test("extracts no depends_on relationships from non-docker-compose infra files", () => {
  const extraction = extractArchitecture(
    "services/billing/Dockerfile",
    "infra",
    "FROM node:22"
  );

  assert.deepEqual(extraction.relationships, []);
});

test("extracts endpoint-to-table relationships from SQL keywords in API files", () => {
  const extraction = extractArchitecture(
    "src/routes/orders.ts",
    "api",
    [
      "router.get('/orders', async (req, res) => {",
      "  const rows = await db.query('SELECT * FROM Orders WHERE active = true');",
      "  const users = await db.query('SELECT id FROM Users JOIN Orders ON Users.id = Orders.user_id');",
      "  res.json(rows);",
      "});",
    ].join("\n")
  );

  assert.deepEqual(
    extraction.relationships.map((r) => `${r.from} -${r.label}-> ${r.to}`),
    [
      "endpoint:GET /orders -queries-> table:Orders",
      "endpoint:GET /orders -queries-> table:Users",
    ]
  );
});

test("extracts endpoint-to-table relationships from Prisma ORM calls", () => {
  const extraction = extractArchitecture(
    "src/routes/users.ts",
    "api",
    [
      "app.get('/users', async (req, res) => {",
      "  const users = await prisma.user.findMany();",
      "  res.json(users);",
      "});",
      "app.post('/users', async (req, res) => {",
      "  const user = await prisma.user.create({ data: req.body });",
      "  await prisma.auditLog.create({ data: { action: 'create' } });",
      "  res.json(user);",
      "});",
    ].join("\n")
  );

  const rels = extraction.relationships.map((r) => `${r.from} -${r.label}-> ${r.to}`).sort();
  assert.ok(rels.includes("endpoint:GET /users -queries-> table:User"));
  assert.ok(rels.includes("endpoint:POST /users -queries-> table:User"));
  assert.ok(rels.includes("endpoint:POST /users -queries-> table:AuditLog"));
});

test("extracts endpoint-to-table relationships from class-method ORM calls", () => {
  const extraction = extractArchitecture(
    "api/orders.py",
    "api",
    [
      "@app.get('/orders')",
      "def list_orders():",
      "    return Order.objects.all()",
    ].join("\n")
  );

  assert.deepEqual(
    extraction.relationships.map((r) => `${r.from} -${r.label}-> ${r.to}`),
    ["endpoint:GET /orders -queries-> table:Order"]
  );
});

test("extracts endpoint-to-queue relationships from publish/subscribe calls", () => {
  const extraction = extractArchitecture(
    "src/routes/orders.ts",
    "api",
    [
      "router.post('/orders', async (req, res) => {",
      "  const order = await db.query('INSERT INTO Orders VALUES (1)');",
      "  await queue.publish('order.created', order);",
      "  res.json(order);",
      "});",
    ].join("\n")
  );

  const rels = extraction.relationships.map((r) => `${r.from} -${r.label}-> ${r.to}`);
  assert.ok(rels.includes("endpoint:POST /orders -queries-> table:Orders"));
  assert.ok(rels.includes("endpoint:POST /orders -publishes-> queue:order.created"));
});

test("does not create false endpoint-to-table relationships from import statements", () => {
  const extraction = extractArchitecture(
    "src/routes/orders.ts",
    "api",
    [
      "import { Order } from '../models/order';",
      "import express from 'express';",
      "router.get('/orders', async (req, res) => {",
      "  res.json([]);",
      "});",
    ].join("\n")
  );

  assert.deepEqual(extraction.relationships, []);
});

test("stores build context in docker-compose service detail", () => {
  const compose = extractComponents(
    "docker-compose.yml",
    "infra",
    "services:\n  api:\n    build: ./backend\n  db:\n    image: postgres\nvolumes:\n  data:"
  );
  assert.equal(compose.find((c) => c.id === "service:api")?.detail, "build: ./backend");
  assert.equal(compose.find((c) => c.id === "service:db")?.detail, "image: postgres");
});

test("extracts EF Core simple navigation relationships only when both tables exist", () => {
  const extraction = extractArchitecture(
    "Data/Entities.cs",
    "schema",
    [
      "public class User {",
      "  public ICollection<Order> Orders { get; set; }",
      "}",
      "public class Order {",
      "  public User User { get; set; }",
      "  public Missing Missing { get; set; }",
      "}",
      "public DbSet<User> Users { get; set; }",
      "public DbSet<Order> Orders { get; set; }",
    ].join("\n")
  );

  assert.deepEqual(extraction.relationships, [
    {
      from: "table:Order",
      to: "table:User",
      label: "relation",
      sourceFile: "Data/Entities.cs",
    },
    {
      from: "table:User",
      to: "table:Order",
      label: "relation",
      sourceFile: "Data/Entities.cs",
    },
  ]);
});
