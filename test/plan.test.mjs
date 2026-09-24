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


test("labelChanges accepts inferred taxonomy but rejects lifecycle labels", () => {
  assert.deepEqual(
    labelChanges("security work is blocked", ["security", "blocked", "waiting"]),
    {
      addLabels: ["security"],
      removeLabels: [],
    },
  );
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


test("buildItems applies inferred priority and due date", () => {
  const [result] = buildItems("Ask M about B low prio tomorrow", {
    intent: {
      title: "Ask M about B",
      priority: "low",
      dueAt: "2026-09-24T07:00:00.000Z",
    },
  });

  assert.deepEqual(decodeRequest(result.arg), {
    action: "create_item",
    title: "Ask M about B",
    description: "Ask M about B low prio tomorrow",
    priority: "low",
    dueAt: "2026-09-24T07:00:00.000Z",
  });
  assert.match(result.subtitle, /priority → low · due → 2026-09-24/);
});

test("buildItems puts standalone creation before matching updates", () => {
  const results = buildItems("I promised Jade a status update", {
    items: [{ displayId: "abc123", title: "Ask Jade for a status update" }],
    projects: [{ displayId: "Project X", title: "Project X" }],
    intent: { state: "waiting" },
  });

  assert.equal(results.length, 3);
  assert.deepEqual(decodeRequest(results[0].arg), {
    action: "create_item",
    title: "I promised Jade a status update",
    labels: ["promised", "follow-up"],
    state: "waiting",
  });
  assert.deepEqual(decodeRequest(results[1].arg), {
    action: "create_item",
    title: "I promised Jade a status update",
    project: "Project X",
    labels: ["promised", "follow-up"],
    state: "waiting",
  });
  assert.deepEqual(decodeRequest(results[2].arg), {
    action: "update_item",
    item: "abc123",
    comment: "I promised Jade a status update",
    state: "waiting",
    addLabels: ["promised", "follow-up"],
  });
});

test("buildItems prioritizes one task-relative completion", () => {
  const results = buildItems("added w to codeowners", {
    items: [
      { displayId: "de34c681", title: "Add Wojtech to CODEOWNERS" },
      { displayId: "other123", title: "Review CODEOWNERS policy" },
    ],
    intent: {
      title: "Add Wojtech to CODEOWNERS",
      state: "completed",
      taskRelativeCompletion: true,
      completedTaskId: "de34c681",
    },
  });

  assert.deepEqual(decodeRequest(results[0].arg), {
    action: "update_item",
    item: "de34c681",
    comment: "added w to codeowners",
    state: "completed",
  });
  assert.equal(decodeRequest(results[1].arg).action, "create_item");
  assert.equal(decodeRequest(results[1].arg).state, undefined);
  assert.deepEqual(decodeRequest(results.at(-1).arg), {
    action: "update_item",
    item: "other123",
    comment: "added w to codeowners",
  });
});

test("buildItems asks the user to choose an ambiguous completion target", () => {
  const results = buildItems("updated CODEOWNERS", {
    items: [
      { displayId: "first", title: "Update CODEOWNERS in Anaconda" },
      { displayId: "second", title: "Update CODEOWNERS in Mamba" },
    ],
    intent: {
      state: "completed",
      taskRelativeCompletion: true,
    },
  });

  assert.deepEqual(
    results.slice(0, 2).map((result) => decodeRequest(result.arg)),
    [
      {
        action: "update_item",
        item: "first",
        comment: "updated CODEOWNERS",
        state: "completed",
      },
      {
        action: "update_item",
        item: "second",
        comment: "updated CODEOWNERS",
        state: "completed",
      },
    ],
  );
  assert.equal(decodeRequest(results[2].arg).action, "create_item");
  assert.equal(decodeRequest(results[2].arg).state, undefined);
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


test("buildItems prefers the inferred existing project and labels", () => {
  const results = buildItems("prepare release notes", {
    projects: [{ displayId: "Anaconda" }],
    intent: {
      title: "Prepare release notes",
      project: "Anaconda",
      labels: ["release"],
    },
  });

  assert.deepEqual(decodeRequest(results[0].arg), {
    action: "create_item",
    title: "Prepare release notes",
    description: "prepare release notes",
    project: "Anaconda",
    labels: ["release"],
  });
});
