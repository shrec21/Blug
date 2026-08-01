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
