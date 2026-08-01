import { ArchCategory } from "./classify.js";
import { Component } from "./types.js";

// Heuristic, regex-based extraction. Intentionally conservative: better to
// miss a component than to hallucinate one. This is the layer you'd swap
// for an LLM call later (see README) without touching watcher/store/diagram.

function nowIso(): string {
  return new Date().toISOString();
}

export function extractComponents(
  relPath: string,
  category: ArchCategory,
  content: string
): Component[] {
  switch (category) {
    case "schema":
      return extractSchema(relPath, content);
    case "api":
      return extractApi(relPath, content);
    case "infra":
      return extractInfra(relPath, content);
    case "deps":
      return extractDeps(relPath, content);
    case "messaging":
      return extractMessaging(relPath, content);
    default:
      return [];
  }
}

function extractSchema(relPath: string, content: string): Component[] {
  const out: Component[] = [];

  // SQL: CREATE TABLE / ALTER TABLE
  const sqlTable = /\b(CREATE|ALTER)\s+TABLE\s+(?:\[?dbo\]?\.)?\[?([A-Za-z_][\w]*)\]?/gi;
  let m: RegExpExecArray | null;
  while ((m = sqlTable.exec(content))) {
    out.push({
      id: `table:${m[2]}`,
      kind: "table",
      name: m[2],
      sourceFile: relPath,
      detail: `${m[1].toUpperCase()} TABLE`,
      lastChanged: nowIso(),
    });
  }

  // Prisma: model Foo { ... }
  const prismaModel = /model\s+(\w+)\s*\{/g;
  while ((m = prismaModel.exec(content))) {
    out.push({
      id: `table:${m[1]}`,
      kind: "table",
      name: m[1],
      sourceFile: relPath,
      lastChanged: nowIso(),
    });
  }

  // EF Core: public DbSet<Foo> Foos
  const dbSet = /DbSet<(\w+)>/g;
  while ((m = dbSet.exec(content))) {
    out.push({
      id: `table:${m[1]}`,
      kind: "table",
      name: m[1],
      sourceFile: relPath,
      detail: "EF Core DbSet",
      lastChanged: nowIso(),
    });
  }

  return out;
}

function extractApi(relPath: string, content: string): Component[] {
  const out: Component[] = [];

  // Express/Fastify style: app.get('/path', ...) / router.post("/path", ...)
  const jsRoute = /\.(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/gi;
  let m: RegExpExecArray | null;
  while ((m = jsRoute.exec(content))) {
    const method = m[1].toUpperCase();
    const path = m[2];
    out.push({
      id: `endpoint:${method} ${path}`,
      kind: "endpoint",
      name: `${method} ${path}`,
      sourceFile: relPath,
      lastChanged: nowIso(),
    });
  }

  // ASP.NET attribute routing: [HttpGet("path")]
  const dotnetRoute = /\[Http(Get|Post|Put|Patch|Delete)(?:\("([^"]*)"\))?\]/g;
  while ((m = dotnetRoute.exec(content))) {
    const method = m[1].toUpperCase();
    const path = m[2] || "";
    out.push({
      id: `endpoint:${method} ${path}`,
      kind: "endpoint",
      name: `${method} ${path || "(base route)"}`,
      sourceFile: relPath,
      lastChanged: nowIso(),
    });
  }

  // Python Flask/FastAPI: @app.get("/path") or @router.post("/path")
  const pyRoute = /@\w+\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/gi;
  while ((m = pyRoute.exec(content))) {
    const method = m[1].toUpperCase();
    const path = m[2];
    out.push({
      id: `endpoint:${method} ${path}`,
      kind: "endpoint",
      name: `${method} ${path}`,
      sourceFile: relPath,
      lastChanged: nowIso(),
    });
  }

  return out;
}

function extractInfra(relPath: string, content: string): Component[] {
  const out: Component[] = [];

  if (/docker-compose/i.test(relPath)) {
    // naive YAML service block detection under "services:"
    const serviceBlock = content.match(/services:\n([\s\S]*)/);
    if (serviceBlock) {
      const lines = serviceBlock[1].split("\n");
      for (const line of lines) {
        const svc = line.match(/^  (\w[\w-]*):\s*$/);
        if (svc) {
          out.push({
            id: `service:${svc[1]}`,
            kind: "service",
            name: svc[1],
            sourceFile: relPath,
            lastChanged: nowIso(),
          });
        } else if (/^\S/.test(line)) {
          break; // left the services: block
        }
      }
    }
  }

  if (/^Dockerfile/i.test(relPath.split("/").pop() || "")) {
    const dir = relPath.split("/").slice(0, -1).join("/") || ".";
    out.push({
      id: `service:${dir}`,
      kind: "service",
      name: dir,
      sourceFile: relPath,
      detail: "Dockerfile-defined service",
      lastChanged: nowIso(),
    });
  }

  return out;
}

function extractDeps(relPath: string, content: string): Component[] {
  const out: Component[] = [];
  if (/package\.json$/.test(relPath)) {
    try {
      const json = JSON.parse(content);
      const deps = { ...(json.dependencies || {}), ...(json.devDependencies || {}) };
      for (const name of Object.keys(deps).sort((a, b) => a.localeCompare(b))) {
        out.push({
          id: `dependency:${name}`,
          kind: "dependency",
          name,
          sourceFile: relPath,
          detail: deps[name],
          lastChanged: nowIso(),
        });
      }
    } catch {
      // malformed JSON mid-edit, skip silently
    }
  }
  return out;
}

function extractMessaging(relPath: string, content: string): Component[] {
  const out: Component[] = [];
  const topic = /(publish|subscribe|topic|queue)\s*[:=]\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = topic.exec(content))) {
    out.push({
      id: `queue:${m[2]}`,
      kind: "queue",
      name: m[2],
      sourceFile: relPath,
      lastChanged: nowIso(),
    });
  }
  return out;
}
