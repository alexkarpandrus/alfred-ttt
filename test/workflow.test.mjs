import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(
  new URL("../workflow/info.plist", import.meta.url),
  "utf8",
);

test("the Alfred workflow uses the ttt keyword", () => {
  assert.match(workflow, /<key>keyword<\/key>\s*<string>ttt<\/string>/);
});

test("the Alfred workflow routes the summary action to Text View", () => {
  assert.match(workflow, /alfred\.workflow\.userinterface\.text/);
  assert.match(workflow, /alfred\.workflow\.utility\.conditional/);
  assert.match(workflow, /__TTT_SUMMARY__/);
  assert.match(
    workflow,
    /<key>inputfile<\/key>\s*<string>bin\/summary<\/string>/,
  );
});
