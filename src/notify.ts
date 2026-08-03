import notifier from "node-notifier";
import { DriftReport } from "./types.js";

export function alertDrift(report: DriftReport, filePath: string) {
  if (!report.hasDrift) return;

  const line = `[blug] architecture change in ${filePath}: ${report.summary}`;

  // Terminal: loud, hard to scroll past
  console.log("\n\x1b[41m\x1b[97m ARCHITECTURE CHANGED \x1b[0m " + line + "\n");

  if (process.env.BLUG_NOTIFY === "0") return;

  // Desktop notification (macOS/Linux/Windows via node-notifier)
  notifier.notify({
    title: "Architecture changed",
    message: `${filePath}\n${report.summary}`,
    sound: true,
  });
}
