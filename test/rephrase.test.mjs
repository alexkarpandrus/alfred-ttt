import assert from "node:assert/strict";
import test from "node:test";

import { cleanTitle, parseIntent } from "../src/rephrase.mjs";

test("cleanTitle removes model formatting from task titles", () => {
  assert.equal(
    cleanTitle("  “Ask Jade for the Project X status.”\n"),
    "Ask Jade for the Project X status",
  );
});

test("parseIntent accepts a guided title and lifecycle state", () => {
  assert.deepEqual(
    parseIntent(
      '{"title":"Added Wojtech to CODEOWNERS","state":"completed"}',
      "finished the CODEOWNERS update",
    ),
    {
      title: "Added Wojtech to CODEOWNERS",
      state: "completed",
    },
  );
});

test("parseIntent rejects a state without an explicit lifecycle cue", () => {
  assert.deepEqual(
    parseIntent(
      '{"title":"Record Jade response","state":"open"}',
      "Jade replied with the latest status",
    ),
    { title: "Record Jade response" },
  );
});

test("parseIntent ignores unchanged and malformed model output", () => {
  assert.deepEqual(
    parseIntent('{"title":"Same note","state":"unchanged"}', "Same note"),
    {},
  );
  assert.deepEqual(parseIntent("not json", "Same note"), {});
});
