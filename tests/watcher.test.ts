import test from "node:test";
import assert from "node:assert/strict";
import { handleChange, parseWatcherArgs } from "../src/watcher.js";
import { type DriftReport } from "../src/types.js";
import { makeTempRepo } from "./test-helpers.js";

function driftReport(sourceFile: string): DriftReport {
  return {
    sourceFile,
    hasDrift: true,
    added: [],
    removed: [],
    modified: [],
    addedRelationships: [],
    removedRelationships: [],
    summary: "changed"
  };
}

test("parseWatcherArgs enables preview only when --preview is present", () => {
  assert.deepEqual(parseWatcherArgs([]), { preview: false });
  assert.deepEqual(parseWatcherArgs(["--preview"]), { preview: true });
});

test("handleChange broadcasts refresh when drift reports exist", async () => {
  const root = await makeTempRepo("watcher-drift");
  let refreshes = 0;
  const reports = await handleChange(root, "src/api.ts", {
    scanAndUpdate: async () => [driftReport("src/api.ts")],
    alertDrift: () => {},
    previewServer: {
      broadcastRefresh: () => {
        refreshes += 1;
      }
    }
  });

  assert.equal(reports.length, 1);
  assert.equal(refreshes, 1);
});

test("handleChange does not broadcast refresh for no-op checks", async () => {
  const root = await makeTempRepo("watcher-noop");
  let refreshes = 0;
  const reports = await handleChange(root, "README.md", {
    scanAndUpdate: async () => [],
    alertDrift: () => {},
    previewServer: {
      broadcastRefresh: () => {
        refreshes += 1;
      }
    }
  });

  assert.deepEqual(reports, []);
  assert.equal(refreshes, 0);
});
