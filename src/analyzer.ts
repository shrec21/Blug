import { ArchCategory } from "./classify.js";
import { ArchitectureExtraction, Component, Relationship } from "./types.js";

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
  return extractArchitecture(relPath, category, content).components;
}

export function extractArchitecture(
  relPath: string,
  category: ArchCategory,
  content: string
): ArchitectureExtraction {
  const components = extractComponentsOnly(relPath, category, content);
  const relationships = category === "schema" ? extractSchemaRelationships(relPath, content) : [];
  return {
    components,
    relationships,
  };
}

function extractComponentsOnly(
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

function tableId(name: string): string {
  return `table:${name}`;
}

function normalizeSqlIdentifier(identifier: string): string {
  const parts = identifier
    .split(".")
    .map((part) => part.trim().replace(/^\[|\]$/g, "").replace(/^"|"$/g, ""));
  return parts[parts.length - 1] ?? identifier;
}

function relationshipKey(relationship: Relationship): string {
  return [
    relationship.from,
    relationship.to,
    relationship.label ?? "",
    relationship.sourceFile,
  ].join("\0");
}

function dedupeRelationships(relationships: Relationship[]): Relationship[] {
  const out: Relationship[] = [];
  const seen = new Set<string>();
  for (const relationship of relationships) {
    const key = relationshipKey(relationship);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(relationship);
  }
  return out.sort((a, b) => relationshipKey(a).localeCompare(relationshipKey(b)));
}

function extractSchemaRelationships(relPath: string, content: string): Relationship[] {
  return dedupeRelationships([
    ...extractSqlRelationships(relPath, content),
    ...extractPrismaRelationships(relPath, content),
    ...extractEfRelationships(relPath, content),
  ]);
}

function extractSqlRelationships(relPath: string, content: string): Relationship[] {
  const relationships: Relationship[] = [];
  const sqlIdentifier = String.raw`(?:(?:\[?[A-Za-z_][\w]*\]?|"[A-Za-z_][\w]*")\.)?(?:\[?[A-Za-z_][\w]*\]?|"[A-Za-z_][\w]*")`;
  const createTable = new RegExp(
    String.raw`\bCREATE\s+TABLE\s+(${sqlIdentifier})\s*\(([\s\S]*?)\)\s*;`,
    "gi"
  );
  const alterTable = new RegExp(
    String.raw`\bALTER\s+TABLE\s+(${sqlIdentifier})([\s\S]*?)(?=;\s*|\bALTER\s+TABLE\b|\bCREATE\s+TABLE\b|$)`,
    "gi"
  );
  const references = new RegExp(String.raw`\bREFERENCES\s+(${sqlIdentifier})\s*\(`, "gi");

  function collect(sourceTable: string, statement: string) {
    let match: RegExpExecArray | null;
    while ((match = references.exec(statement))) {
      relationships.push({
        from: tableId(sourceTable),
        to: tableId(normalizeSqlIdentifier(match[1])),
        label: "FK",
        sourceFile: relPath,
      });
    }
  }

  let match: RegExpExecArray | null;
  while ((match = createTable.exec(content))) {
    collect(normalizeSqlIdentifier(match[1]), match[2]);
  }
  while ((match = alterTable.exec(content))) {
    collect(normalizeSqlIdentifier(match[1]), match[2]);
  }

  return relationships;
}

function extractPrismaRelationships(relPath: string, content: string): Relationship[] {
  const relationships: Relationship[] = [];
  const scalarTypes = new Set([
    "String",
    "Boolean",
    "Int",
    "BigInt",
    "Float",
    "Decimal",
    "DateTime",
    "Json",
    "Bytes",
  ]);
  const modelBlock = /model\s+(\w+)\s*\{([\s\S]*?)\}/g;
  let modelMatch: RegExpExecArray | null;
  while ((modelMatch = modelBlock.exec(content))) {
    const source = modelMatch[1];
    const body = modelMatch[2];
    for (const line of body.split(/\r?\n/)) {
      const field = line.trim().match(/^(\w+)\s+([A-Z]\w*)(?:\[\])?(?:\?)?\s+.*@relation\b/);
      if (!field) continue;
      const target = field[2];
      if (scalarTypes.has(target)) continue;
      relationships.push({
        from: tableId(source),
        to: tableId(target),
        label: "relation",
        sourceFile: relPath,
      });
    }
  }
  return relationships;
}

function extractEfRelationships(relPath: string, content: string): Relationship[] {
  const tableNames = new Set<string>();
  const dbSet = /DbSet<(\w+)>/g;
  let match: RegExpExecArray | null;
  while ((match = dbSet.exec(content))) {
    tableNames.add(match[1]);
  }

  const relationships: Relationship[] = [];
  const classBlock = /class\s+(\w+)[^{]*\{([\s\S]*?)(?=\n\s*(?:public\s+)?class\s+\w+|\n\s*public\s+DbSet<|$)/g;
  let classMatch: RegExpExecArray | null;
  while ((classMatch = classBlock.exec(content))) {
    const source = classMatch[1];
    if (!tableNames.has(source)) continue;
    const body = classMatch[2];
    const navigation = /public\s+(?:virtual\s+)?(?:(?:ICollection|List|HashSet)<(\w+)>|(\w+))\s+\w+\s*\{\s*get;\s*set;\s*\}/g;
    while ((match = navigation.exec(body))) {
      const target = match[1] ?? match[2];
      if (!target || target === source || !tableNames.has(target)) continue;
      relationships.push({
        from: tableId(source),
        to: tableId(target),
        label: "relation",
        sourceFile: relPath,
      });
    }
  }
  return relationships;
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
