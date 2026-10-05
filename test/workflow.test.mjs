import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(
  new URL("../workflow/info.plist", import.meta.url),
  "utf8",
);

test("the Alfred workflow exposes ttt and ll keywords", () => {
  assert.match(workflow, /<key>keyword<\/key>\s*<string>ttt\|\|ll<\/string>/);
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

test("the Alfred workflow offers an optional Jev key without embedding a credential", () => {
  assert.match(workflow, /<key>variable<\/key><string>TYPESAFE_API_KEY<\/string>/);
  assert.match(workflow, /<key>default<\/key><string><\/string><key>placeholder<\/key><string>TypeSafe AI API key<\/string>/);
  assert.match(workflow, /Alfred saves this value in prefs\.plist, not Keychain/);
});
