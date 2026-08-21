import { promises as fs } from "fs";
import path from "path";
import { classify } from "./classify.js";
import { extractArchitecture } from "./analyzer.js";
import { loadModel, saveModel, mergeArchitecture } from "./store.js";
import { renderMarkdown } from "./diagram.js";
import { type ArchitectureExtraction, type ArchitectureModel, type DriftReport, type Relationship } from "./types.js";

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

function addRelationships(model: ArchitectureModel, inferred: Relationship[]): boolean {
  const existingKeys = new Set(
    model.relationships.map((r) => `${r.from}\0${r.to}\0${r.label ?? ""}\0${r.sourceFile}`)
  );
  let added = false;
  for (const rel of inferred) {
    const key = `${rel.from}\0${rel.to}\0${rel.label ?? ""}\0${rel.sourceFile}`;
    if (!existingKeys.has(key)) {
      model.relationships.push(rel);
      existingKeys.add(key);
      added = true;
    }
  }
  return added;
}

// Infer service→endpoint relationships by matching docker-compose build
// contexts to endpoint source file paths.
function inferServiceEndpointRelationships(model: ArchitectureModel): boolean {
  const services = Object.values(model.components).filter(
    (c) => c.kind === "service" && c.detail?.startsWith("build: ")
  );
  if (services.length === 0) return false;

  const endpoints = Object.values(model.components).filter(
    (c) => c.kind === "endpoint"
  );
  if (endpoints.length === 0) return false;

  const inferred: Relationship[] = [];
  for (const svc of services) {
    const raw = svc.detail!.slice("build: ".length);
    const buildPath = raw.replace(/^\.\//, "");
    const matchAll = buildPath === "." || buildPath === "";

    for (const ep of endpoints) {
      if (matchAll || ep.sourceFile.startsWith(buildPath + "/") || ep.sourceFile.startsWith(buildPath + "\\")) {
        inferred.push({
          from: svc.id,
          to: ep.id,
          label: "exposes",
          sourceFile: svc.sourceFile,
        });
      }
    }
  }

  return addRelationships(model, inferred);
}

// ── Import-chain table inference helpers ──────────────────────────────────────

// Parse ES/CJS import statements, returning {importPath, names[]}.
interface ImportInfo {
  importPath: string;
  names: string[]; // named imports, or ["*"] for star imports
}

function parseImports(content: string): ImportInfo[] {
  const imports: ImportInfo[] = [];
  // ES named imports: import { a, b, c } from './path'
  const esNamed = /\bimport\s+\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g;
  // ES default/star: import X from './path'  or  import * as X from './path'
  const esDefault = /\bimport\s+(?:\*\s+as\s+(\w+)|(\w+))\s+from\s+['"]([^'"]+)['"]/g;
  // CommonJS: const { a, b } = require('./path')
  const cjs = /(?:const|let|var)\s+\{([^}]*)\}\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = esNamed.exec(content))) {
    const names = m[1].split(",").map((s) => s.trim().replace(/\s+as\s+\w+/, "")).filter(Boolean);
    imports.push({ importPath: m[2], names });
  }
  while ((m = esDefault.exec(content))) {
    imports.push({ importPath: m[3], names: ["*"] });
  }
  while ((m = cjs.exec(content))) {
    const names = m[1].split(",").map((s) => s.trim()).filter(Boolean);
    imports.push({ importPath: m[2], names });
  }
  return imports;
}

// Resolve a relative import path to candidate file paths.
function resolveImportRelPath(importingFileDir: string, importPath: string): string[] {
  const base = path.posix.normalize(path.posix.join(importingFileDir, importPath));
  const candidates: string[] = [];
  for (const ext of [".ts", ".js", ".tsx", ".jsx"]) candidates.push(base + ext);
  for (const ext of [".ts", ".js"]) candidates.push(path.posix.join(base, "index" + ext));
  return candidates;
}

// SQL DML noise words to exclude from table name matches.
const SQL_NOISE = new Set([
  "select", "set", "where", "and", "or", "not", "null", "values",
  "table", "index", "view", "exists", "conflict", "replace",
]);

// Extract table names from SQL DML in a string.
function extractSqlDmlTableRefs(content: string): Set<string> {
  const tables = new Set<string>();
  const patterns = [
    /\bFROM\s+([a-zA-Z_]\w*)/gi,
    /\bJOIN\s+([a-zA-Z_]\w*)/gi,
    /\bINTO\s+([a-zA-Z_]\w*)/gi,
    /\bUPDATE\s+([a-zA-Z_]\w*)/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) {
      if (!SQL_NOISE.has(m[1].toLowerCase())) tables.add(m[1]);
    }
  }
  return tables;
}

// Build a map of exported function name → set of table names referenced
// within that function body. Uses brace counting to isolate function scope.
function buildFunctionTableMap(content: string): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const funcStart = /export\s+(?:async\s+)?function\s+(\w+)\s*\([^)]*\)/g;
  let m: RegExpExecArray | null;
  const starts: Array<{ name: string; pos: number }> = [];

  while ((m = funcStart.exec(content))) {
    starts.push({ name: m[1], pos: m.index + m[0].length });
  }

  for (const { name, pos } of starts) {
    // Find opening brace
    let i = pos;
    while (i < content.length && content[i] !== "{") i++;
    if (i >= content.length) continue;

    // Count braces to find end
    let depth = 0;
    const bodyStart = i;
    for (; i < content.length; i++) {
      if (content[i] === "{") depth++;
      else if (content[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    const body = content.slice(bodyStart, i + 1);
    const tables = extractSqlDmlTableRefs(body);
    if (tables.size > 0) map.set(name, tables);
  }

  return map;
}

// Find route handler positions and the endpoint ID for each.
interface HandlerSegment {
  endpointId: string;
  startPos: number;
  endPos: number;
}

function segmentRouteHandlers(content: string, endpointIds: string[]): HandlerSegment[] {
  // Match common route patterns and capture their position
  const routePatterns = [
    /\.(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/gi,
    /\[Http(Get|Post|Put|Patch|Delete)(?:\("([^"]*)"\))?\]/gi,
    /@\w+\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/gi,
  ];

  const matches: Array<{ id: string; pos: number }> = [];
  for (const re of routePatterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) {
      const method = m[1].toUpperCase();
      const routePath = m[2] || "";
      const id = `endpoint:${method} ${routePath}`;
      if (endpointIds.includes(id)) {
        matches.push({ id, pos: m.index });
      }
    }
  }
  matches.sort((a, b) => a.pos - b.pos);

  const segments: HandlerSegment[] = [];
  for (let i = 0; i < matches.length; i++) {
    segments.push({
      endpointId: matches[i].id,
      startPos: matches[i].pos,
      endPos: i + 1 < matches.length ? matches[i + 1].pos : content.length,
    });
  }
  return segments;
}

// Infer endpoint→table relationships by following import chains with
// per-function and per-handler granularity.
function inferImportTableRelationships(
  model: ArchitectureModel,
  fileContents: Map<string, string>
): boolean {
  // Collect endpoints grouped by source file
  const endpointsByFile = new Map<string, string[]>();
  for (const comp of Object.values(model.components)) {
    if (comp.kind === "endpoint") {
      const list = endpointsByFile.get(comp.sourceFile) ?? [];
      list.push(comp.id);
      endpointsByFile.set(comp.sourceFile, list);
    }
  }
  if (endpointsByFile.size === 0) return false;

  // Build lookup: lowercase table name → component id
  const tableIds = new Map<string, string>();
  for (const comp of Object.values(model.components)) {
    if (comp.kind === "table") tableIds.set(comp.name.toLowerCase(), comp.id);
  }
  if (tableIds.size === 0) return false;

  const inferred: Relationship[] = [];

  for (const [epFile, epIds] of endpointsByFile) {
    const content = fileContents.get(epFile);
    if (!content) continue;

    const dir = path.posix.dirname(epFile);
    const imports = parseImports(content);

    // Build function→tables map from all imported modules
    const fnToTables = new Map<string, Set<string>>();
    for (const imp of imports) {
      if (!imp.importPath.startsWith(".")) continue;
      const candidates = resolveImportRelPath(dir, imp.importPath);
      for (const candidate of candidates) {
        const importedContent = fileContents.get(candidate);
        if (!importedContent) continue;
        const funcMap = buildFunctionTableMap(importedContent);
        for (const [fn, tables] of funcMap) {
          // Only include functions that are actually imported
          if (imp.names.includes("*") || imp.names.includes(fn)) {
            const existing = fnToTables.get(fn) ?? new Set();
            for (const t of tables) existing.add(t);
            fnToTables.set(fn, existing);
          }
        }
        break;
      }
    }

    if (fnToTables.size === 0) {
      // Fallback: also check for direct SQL in the endpoint file itself
      const directTables = extractSqlDmlTableRefs(content);
      for (const table of directTables) {
        const tableId = tableIds.get(table.toLowerCase());
        if (!tableId) continue;
        for (const epId of epIds) {
          inferred.push({ from: epId, to: tableId, label: "queries", sourceFile: epFile });
        }
      }
      continue;
    }

    // Segment the route file by handler blocks
    const segments = segmentRouteHandlers(content, epIds);

    for (const seg of segments) {
      const handlerCode = content.slice(seg.startPos, seg.endPos);
      const tablesForHandler = new Set<string>();

      // Find which imported functions are called in this handler segment
      for (const [fn, tables] of fnToTables) {
        // Check if the function name appears as a call in this segment
        const callPattern = new RegExp(`\\b${fn}\\s*\\(`, "g");
        if (callPattern.test(handlerCode)) {
          for (const t of tables) tablesForHandler.add(t);
        }
      }

      // Also check for direct SQL in the handler
      for (const t of extractSqlDmlTableRefs(handlerCode)) {
        tablesForHandler.add(t);
      }

      // Create relationships only for tables that exist in the model
      for (const table of tablesForHandler) {
        const tableId = tableIds.get(table.toLowerCase());
        if (!tableId) continue;
        inferred.push({
          from: seg.endpointId,
          to: tableId,
          label: "queries",
          sourceFile: epFile,
        });
      }
    }
  }

  return addRelationships(model, inferred);
}

// Infer endpoint→module relationships by matching imported function calls
// in route handler segments to known module components.
function inferEndpointModuleRelationships(
  model: ArchitectureModel,
  fileContents: Map<string, string>
): boolean {
  const modulesByFile = new Map<string, string>();
  for (const comp of Object.values(model.components)) {
    if (comp.kind === "module") modulesByFile.set(comp.sourceFile, comp.id);
  }
  if (modulesByFile.size === 0) return false;

  const endpointsByFile = new Map<string, string[]>();
  for (const comp of Object.values(model.components)) {
    if (comp.kind === "endpoint") {
      const list = endpointsByFile.get(comp.sourceFile) ?? [];
      list.push(comp.id);
      endpointsByFile.set(comp.sourceFile, list);
    }
  }
  if (endpointsByFile.size === 0) return false;

  const inferred: Relationship[] = [];

  for (const [epFile, epIds] of endpointsByFile) {
    const content = fileContents.get(epFile);
    if (!content) continue;

    const dir = path.posix.dirname(epFile);
    const imports = parseImports(content);

    // Map function names to their module IDs
    const fnToModule = new Map<string, string>();
    for (const imp of imports) {
      if (!imp.importPath.startsWith(".")) continue;
      const candidates = resolveImportRelPath(dir, imp.importPath);
      for (const candidate of candidates) {
        const moduleId = modulesByFile.get(candidate);
        if (!moduleId) continue;
        for (const name of imp.names) {
          if (name !== "*") fnToModule.set(name, moduleId);
        }
        break;
      }
    }

    if (fnToModule.size === 0) continue;

    const segments = segmentRouteHandlers(content, epIds);
    for (const seg of segments) {
      const handlerCode = content.slice(seg.startPos, seg.endPos);
      const modulesUsed = new Set<string>();

      for (const [fn, moduleId] of fnToModule) {
        if (new RegExp(`\\b${fn}\\s*\\(`).test(handlerCode)) {
          modulesUsed.add(moduleId);
        }
      }

      for (const moduleId of modulesUsed) {
        inferred.push({
          from: seg.endpointId,
          to: moduleId,
          label: "uses",
          sourceFile: epFile,
        });
      }
    }
  }

  return addRelationships(model, inferred);
}

export async function scanAndUpdate(
  root: string,
  paths: string[],
  options: ScanOptions = {}
): Promise<DriftReport[]> {
  const model = await loadModel(root);
  const reports: DriftReport[] = [];
  const fileContents = new Map<string, string>();

  for (const inputPath of paths) {
    const relPath = normalizeRelPath(root, inputPath);
    const { isArchRelevant, category } = classify(relPath);
    if (!isArchRelevant || !category) continue;
    let extraction: ArchitectureExtraction = { components: [], relationships: [] };
    try {
      const content = await fs.readFile(path.join(root, relPath), "utf-8");
      fileContents.set(relPath, content);
      extraction = extractArchitecture(relPath, category, content);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
    }

    const report = mergeArchitecture(model, relPath, extraction);
    if (report.hasDrift) reports.push(report);
  }

  // Post-processing: infer cross-file relationships
  let inferredNew = inferServiceEndpointRelationships(model);
  if (inferImportTableRelationships(model, fileContents)) inferredNew = true;
  if (inferEndpointModuleRelationships(model, fileContents)) inferredNew = true;

  if (reports.length > 0 || inferredNew || options.writeWhenNoDrift) {
    await saveModel(root, model);
    await fs.writeFile(path.join(root, "ARCHITECTURE.md"), renderMarkdown(model), "utf-8");
  }

  return reports;
}
