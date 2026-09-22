import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { encodeRequest } from "../src/plan.mjs";

test("the summary action emits the Alfred routing marker", () => {
  const result = spawnSync(
    process.execPath,
    [
      new URL("../src/apply.mjs", import.meta.url).pathname,
      encodeRequest({ action: "show_summary" }),
    ],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0);
  assert.equal(result.stdout, "__TTT_SUMMARY__");
});
