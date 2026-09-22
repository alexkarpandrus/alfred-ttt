import assert from "node:assert/strict";
import test from "node:test";

import {
  buildItems,
  buildListItems,
  buildSummaryItem,
  decodeRequest,
  labelChanges,
  listState,
  parseCommand,
  searchQuery,
} from "../src/plan.mjs";

test("labelChanges keeps classification labels separate from lifecycle state", () => {
  assert.deepEqual(
    labelChanges("I promised a status update and am waiting on Jade"),
    {
      addLabels: ["promised", "follow-up"],
      removeLabels: [],
    },
  );
});

test("labelChanges removes a fulfilled promise", () => {
  assert.deepEqual(labelChanges("I fulfilled the promise"), {
    addLabels: [],
    removeLabels: ["promised"],
  });
});

test("parseCommand recognizes task listing and targeted free-form updates", () => {
  assert.deepEqual(parseCommand("list waiting"), {
    mode: "list",
    query: "waiting",
  });
  assert.deepEqual(parseCommand("l w"), {
    mode: "list",
    query: "w",
  });
  assert.deepEqual(parseCommand("de34c681: finished the CODEOWNERS update"), {
    mode: "capture",
    target: "de34c681",
    text: "finished the CODEOWNERS update",
  });
  assert.equal(listState("done"), "completed");
  assert.equal(listState("w"), "waiting");
});

test("summary opens the dashboard without creating a tracker mutation", () => {
  assert.deepEqual(parseCommand("summary"), { mode: "summary" });
  assert.deepEqual(parseCommand("s"), { mode: "summary" });
  const [item] = buildSummaryItem();
  assert.deepEqual(decodeRequest(item.arg), { action: "show_summary" });
});

test("searchQuery keeps identifying words", () => {
  assert.equal(
    searchQuery("I have an update about waiting for Jade on Project X"),
    "waiting for Jade Project X",
  );
});

test("buildListItems displays task state and prepares a targeted update", () => {
  const results = buildListItems(
    [
      {
        displayId: "de34c681",
        title: "Add Wojtech to CODEOWNERS",
        state: "open",
        priority: "high",
        project: { displayId: "Anaconda" },
        labels: [{ displayId: "promised" }],
        dueAt: "2026-09-24T17:00:00Z",
      },
    ],
    "Wojtech",
  );

  assert.equal(results[0].autocomplete, "de34c681: ");
  assert.match(results[0].subtitle, /open · high priority · Anaconda/);
  assert.equal(results[0].valid, false);
});

test("buildItems preserves the comment and applies an inferred state", () => {
  const results = buildItems("finished the CODEOWNERS update", {
    items: [{ displayId: "de34c681", title: "Add Wojtech to CODEOWNERS" }],
    intent: { state: "completed" },
    allowCreate: false,
    target: "de34c681",
  });

  assert.equal(results.length, 1);
  assert.deepEqual(decodeRequest(results[0].arg), {
    action: "update_item",
    item: "de34c681",
    comment: "finished the CODEOWNERS update",
    state: "completed",
  });
});

test("buildItems offers matching updates and standalone creation", () => {
  const results = buildItems("I promised Jade a status update", {
    items: [{ displayId: "abc123", title: "Ask Jade for a status update" }],
    projects: [{ displayId: "Project X", title: "Project X" }],
    intent: { state: "waiting" },
  });

  assert.equal(results.length, 3);
  assert.deepEqual(decodeRequest(results[0].arg), {
    action: "update_item",
    item: "abc123",
    comment: "I promised Jade a status update",
    state: "waiting",
    addLabels: ["promised", "follow-up"],
  });
  assert.deepEqual(decodeRequest(results[1].arg), {
    action: "create_item",
    title: "I promised Jade a status update",
    labels: ["promised", "follow-up"],
    state: "waiting",
  });
  assert.deepEqual(decodeRequest(results[2].arg), {
    action: "create_item",
    title: "I promised Jade a status update",
    project: "Project X",
    labels: ["promised", "follow-up"],
    state: "waiting",
  });
});

test("buildItems preserves a raw note when it offers an inferred title", () => {
  const results = buildItems("need ask Jade for a status update", {
    intent: { title: "Ask Jade for a status update" },
  });

  assert.equal(results.length, 2);
  assert.deepEqual(decodeRequest(results[0].arg), {
    action: "create_item",
    title: "Ask Jade for a status update",
    description: "need ask Jade for a status update",
    labels: ["follow-up"],
  });
  assert.deepEqual(decodeRequest(results[1].arg), {
    action: "create_item",
    title: "need ask Jade for a status update",
    labels: ["follow-up"],
  });
});
