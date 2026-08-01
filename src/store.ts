import { promises as fs } from "fs";
import path from "path";
import { ArchitectureModel, Component, DriftReport, emptyModel } from "./types.js";

const STATE_DIR = ".blug";
const MODEL_FILE = "model.json";

export function stateDir(root: string): string {
  return path.join(root, STATE_DIR);
}

export async function loadModel(root: string): Promise<ArchitectureModel> {
  const file = path.join(stateDir(root), MODEL_FILE);
  try {
    const raw = await fs.readFile(file, "utf-8");
    return JSON.parse(raw) as ArchitectureModel;
  } catch {
    return emptyModel();
  }
}

export async function saveModel(root: string, model: ArchitectureModel): Promise<void> {
  const dir = stateDir(root);
  await fs.mkdir(dir, { recursive: true });
  model.updatedAt = new Date().toISOString();
  await fs.writeFile(path.join(dir, MODEL_FILE), JSON.stringify(model, null, 2), "utf-8");
}

// Merge newly-extracted components (from one changed file) into the model,
// and report exactly what changed so the caller can decide whether to alert.
export function mergeComponents(
  model: ArchitectureModel,
  sourceFile: string,
  newComponents: Component[]
): DriftReport {
  const added: Component[] = [];
  const removed: Component[] = [];
  const modified: Component[] = [];

  // Components previously attributed to this file, that are no longer found
  // in it, are candidates for removal (e.g. a table was dropped from a migration).
  const previouslyFromThisFile = Object.values(model.components).filter(
    (c) => c.sourceFile === sourceFile
  );
  const newIds = new Set(newComponents.map((c) => c.id));

  for (const old of previouslyFromThisFile) {
    if (!newIds.has(old.id)) {
      removed.push(old);
      delete model.components[old.id];
    }
  }

  for (const comp of newComponents) {
    const existing = model.components[comp.id];
    if (!existing) {
      added.push(comp);
      model.components[comp.id] = comp;
    } else if (existing.detail !== comp.detail) {
      modified.push(comp);
      model.components[comp.id] = comp;
    } else {
      // Keep lastChanged stable, but allow attribution to follow moved definitions.
      model.components[comp.id] = {
        ...existing,
        kind: comp.kind,
        name: comp.name,
        sourceFile: comp.sourceFile,
      };
    }
  }

  const hasDrift = added.length > 0 || removed.length > 0 || modified.length > 0;
  const parts: string[] = [];
  if (added.length) parts.push(`+${added.length} added (${added.map((c) => c.name).join(", ")})`);
  if (removed.length) parts.push(`-${removed.length} removed (${removed.map((c) => c.name).join(", ")})`);
  if (modified.length) parts.push(`~${modified.length} modified (${modified.map((c) => c.name).join(", ")})`);

  return {
    sourceFile,
    hasDrift,
    added,
    removed,
    modified,
    summary: hasDrift ? parts.join("; ") : "no architectural drift",
  };
}
