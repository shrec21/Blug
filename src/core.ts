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
    // Normalize: strip leading ./ so "./backend" becomes "backend"
    const buildPath = raw.replace(/^\.\//, "");
    // Special case: "." means the repo root — all endpoints match
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

  if (inferred.length === 0) return false;

  // Dedupe against existing relationships
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
    let extraction: ArchitectureExtraction = { components: [], relationships: [] };
    try {
      const content = await fs.readFile(path.join(root, relPath), "utf-8");
      extraction = extractArchitecture(relPath, category, content);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
    }

    const report = mergeArchitecture(model, relPath, extraction);
    if (report.hasDrift) reports.push(report);
  }

  // Post-processing: infer cross-file relationships
  const inferredNew = inferServiceEndpointRelationships(model);

  if (reports.length > 0 || inferredNew || options.writeWhenNoDrift) {
    await saveModel(root, model);
    await fs.writeFile(path.join(root, "ARCHITECTURE.md"), renderMarkdown(model), "utf-8");
  }

  return reports;
}
