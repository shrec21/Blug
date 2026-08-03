import { promises as fs } from "fs";
import path from "path";

const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", ".blug"]);

export async function walkRepo(root: string, dir = root, out: string[] = []): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkRepo(root, full, out);
    } else {
      out.push(path.relative(root, full));
    }
  }
  return out;
}
