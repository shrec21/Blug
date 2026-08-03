import { promises as fs } from "fs";
import path from "path";
import { classify } from "./classify.js";
import { extractComponents } from "./analyzer.js";
import { loadModel, saveModel, mergeComponents } from "./store.js";
import { renderMarkdown } from "./diagram.js";
import { type Component, type DriftReport } from "./types.js";

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
    let components: Component[] = [];
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
