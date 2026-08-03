export function parsePathsArg(args: unknown): string[] | undefined {
  if (!args || typeof args !== "object") return undefined;
  const paths = (args as { paths?: unknown }).paths;
  if (paths === undefined) return undefined;
  if (!Array.isArray(paths) || !paths.every((pathValue) => typeof pathValue === "string")) {
    throw new Error("check_architecture_drift.paths must be an array of strings");
  }
  return paths;
}
