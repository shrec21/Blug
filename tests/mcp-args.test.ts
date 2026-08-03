import test from "node:test";
import assert from "node:assert/strict";
import { parsePathsArg } from "../src/mcp-args.js";

test("parsePathsArg returns undefined when paths are omitted", () => {
  assert.equal(parsePathsArg(undefined), undefined);
  assert.equal(parsePathsArg({}), undefined);
});

test("parsePathsArg accepts string path arrays", () => {
  assert.deepEqual(parsePathsArg({ paths: ["package.json", "src/routes/orders.ts"] }), [
    "package.json",
    "src/routes/orders.ts",
  ]);
});

test("parsePathsArg rejects non-string path arrays", () => {
  assert.throws(
    () => parsePathsArg({ paths: ["package.json", 12] }),
    /paths must be an array of strings/
  );
});
