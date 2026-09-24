import assert from "node:assert/strict";
import test from "node:test";

import {
  buildItems,
  buildListItems,
  buildSummaryItem,
  decodeRequest,
  labelChanges,
  listState,
  matchingTitles,
  parseCommand,
  searchQuery,
} from "../src/plan.mjs";
import { parseIntent } from "../src/rephrase.mjs";

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

test("lookup browses matching work across names, phrases, and paraphrases", () => {
  const items = [
    { displayId: "receipts", title: "Archive quarterly receipts", state: "open" },
    { displayId: "retry", title: "Fix billing retry failures", state: "active" },
    { displayId: "interviews", title: "Review customer interviews", state: "waiting" },
    { displayId: "release", title: "Prepare release notes", state: "canceled" },
  ];
  for (const [query, id] of [
    ["receipts", "receipts"],
    ["QUARTERLY RECEIPTS", "receipts"],
    ["billing retry", "retry"],
    ["release notes", "release"],
    ["where are the user conversations?", "interviews"],
  ]) {
    const results = buildItems(query, {
      items,
      intent: { inputMode: "lookup", lookupTaskIds: [id] },
    });
    assert.equal(results.length, 1, query);
    const [result] = results;
    assert.equal(result.title, items.find((item) => item.displayId === id).title, query);
    assert.equal(result.autocomplete, `${id}: `, query);
    assert.equal(result.valid, false, query);
    assert.equal(result.arg, undefined, query);
  }
  const results = buildItems("release notes", {
    items,
    intent: { inputMode: "lookup", lookupTaskIds: ["receipts"] },
  });
  assert.deepEqual(results.map((result) => result.title), ["Prepare release notes"]);
  const multiple = buildItems("customer interviews", {
    items: [items[2], { displayId: "schedule", title: "Schedule customer interviews", state: "canceled" }],
    intent: { inputMode: "lookup", lookupTaskIds: ["receipts"] },
  });
  assert.deepEqual(multiple.map((result) => result.title), [
    "Review customer interviews", "Schedule customer interviews",
  ]);
  assert.ok(multiple.every((result) => result.arg === undefined));
});

test("fast title lookup uses full phrases and ignores unrelated descriptions", () => {
  const items = [
    { title: "Archive quarterly receipts" },
    { title: "Review invoices", description: "Quarterly receipts" },
  ];
  for (const query of ["receipts", "QUARTERLY RECEIPTS"]) {
    assert.deepEqual(matchingTitles(items, query), [items[0]]);
  }
  assert.deepEqual(matchingTitles(items, "invoice"), [items[1]]);
  assert.deepEqual(matchingTitles(items, "unknown"), []);
});

test("action notes keep creation first, but title phrases browse despite model errors", () => {
  const items = [{ displayId: "release", title: "Prepare release notes", state: "open" }];
  for (const query of ["please prepare release notes", "create another release notes task", "I prepared release notes"]) {
    const [result] = buildItems(query, { items, intent: { inputMode: "capture" } });
    assert.match(result.title, /^🆕 Create/, query);
  }
  const [phrase] = buildItems("release notes", {
    items, intent: { inputMode: "capture" },
  });
  assert.equal(phrase.autocomplete, "release: ");
  assert.equal(phrase.arg, undefined);
  const [exact] = buildItems("PREPARE RELEASE NOTES", {
    items, intent: { inputMode: "capture" },
  });
  assert.equal(exact.autocomplete, "release: ");
  assert.equal(exact.arg, undefined);
});

test("a task-action request remains capture when the model mistakes it for lookup", () => {
  for (const [query, title] of [
    ["archive q receipts", "Archive quarterly receipts"],
    ["fix billing failures", "Fix billing retry failures"],
    ["review user interviews", "Review customer interviews"],
    ["add w to codeowners", "Add Wanda to CODEOWNERS"],
  ]) {
    const [result] = buildItems(query, {
      items: [{ displayId: "existing", title, state: "open" }],
      intent: { inputMode: "lookup", lookupTaskIds: ["existing"] },
    });
    assert.match(result.title, /^🆕 Create/, query);
  }
});

test("without a model, title phrases browse existing work regardless of word count or state aliases", () => {
  const items = [
    { displayId: "receipts", title: "Archive quarterly receipts", state: "open" },
    { displayId: "release", title: "Open release notes", state: "waiting" },
  ];
  for (const [query, id] of [
    ["receipt", "receipts"],
    ["QUARTERLY RECEIPTS", "receipts"],
    ["release notes", "release"],
    ["open", "release"],
  ]) {
    const [result] = buildItems(query, { items });
    assert.equal(result.autocomplete, `${id}: `, query);
    assert.equal(result.arg, undefined, query);
  }
  assert.equal(buildItems("unknown", { items })[0].title, "🆕 Create: unknown");
  assert.equal(buildItems("archive new receipts", { items })[0].title, "🆕 Create: archive new receipts");
});

test("lookup with no matching candidates stays read-only; a targeted note remains actionable", () => {
  const items = [{ displayId: "invoice", title: "Review invoice export", state: "open" }];
  const [missing] = buildItems("where is the contract?", {
    items,
    intent: { inputMode: "lookup", lookupTaskIds: [] },
  });
  assert.match(missing.title, /^No tasks match/);
  assert.equal(missing.arg, undefined);
  const [targeted] = buildItems("done", {
    items,
    target: "invoice",
    allowCreate: false,
    intent: { inputMode: "lookup", lookupTaskIds: ["invoice"], state: "completed" },
  });
  assert.equal(decodeRequest(targeted.arg).state, "completed");
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

test("suggestion titles show a compact action before the task name", () => {
  const task = { displayId: "de34c681", title: "Add Wojtech to CODEOWNERS" };
  for (const [intent, action] of [
    [{}, "💬 Comment"],
    [{ state: "completed" }, "✅ Complete"],
    [{ state: "canceled" }, "🚫 Cancel"],
    [{ state: "waiting" }, "⏳ Waiting"],
    [{ state: "active" }, "▶️ Active"],
    [{ state: "open" }, "🔓 Open"],
    [{ priority: "high" }, "✏️ Update"],
  ]) {
    const [result] = buildItems("a note", { items: [task], intent, allowCreate: false });
    assert.equal(result.title, `${action}: ${task.title}`);
    assert.equal(decodeRequest(result.arg).item, task.displayId);
  }
  assert.equal(buildItems("a note")[0].title, "🆕 Create: a note");
  assert.equal(
    buildItems("finished work", { intent: { state: "completed" } })[0].title,
    "🆕 Create (completed): finished work",
  );
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
    comment: "Ask M about B low prio tomorrow",
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
    comment: "I promised Jade a status update",
    labels: ["promised", "follow-up"],
    state: "waiting",
  });
  assert.deepEqual(decodeRequest(results[1].arg), {
    action: "create_item",
    title: "I promised Jade a status update",
    comment: "I promised Jade a status update",
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
      completedTaskIds: ["de34c681"],
    },
  });

  assert.deepEqual(decodeRequest(results[0].arg), {
    action: "update_item",
    item: "de34c681",
    comment: "added w to codeowners",
    state: "completed",
  });
  assert.equal(results[0].title, "✅ Complete: Add Wojtech to CODEOWNERS");
  assert.equal(results[1].title, "🆕 Create: Add Wojtech to CODEOWNERS");
  assert.equal(results.at(-1).title, "💬 Comment: Review CODEOWNERS policy");
  assert.equal(decodeRequest(results[1].arg).action, "create_item");
  assert.equal(decodeRequest(results[1].arg).state, undefined);
  assert.deepEqual(decodeRequest(results.at(-1).arg), {
    action: "update_item",
    item: "other123",
    comment: "added w to codeowners",
  });
});

test("task-relative completion keeps unrelated updates comment-only", () => {
  const input = "I sent the report, high priority +ops";
  const results = buildItems(input, {
    items: [
      { displayId: "report", title: "Send report", state: "open" },
      { displayId: "other", title: "Review finances", state: "canceled" },
    ],
    intent: {
      state: "completed",
      taskRelativeCompletion: true,
      completedTaskIds: ["report"],
      priority: "high",
      labels: ["ops"],
    },
  });

  assert.deepEqual(decodeRequest(results[0].arg), {
    action: "update_item", item: "report", comment: input,
    state: "completed", priority: "high", addLabels: ["ops"],
  });
  assert.equal(decodeRequest(results[1].arg).priority, "high");
  assert.equal(results.at(-1).title, "💬 Comment: Review finances");
  assert.deepEqual(decodeRequest(results.at(-1).arg), {
    action: "update_item", item: "other", comment: input,
  });
});

test("verified completion wins even when the model calls the note a lookup", () => {
  const input = "I sent the report to Alice";
  const items = [
    { displayId: "report", title: "Send report to Alice", state: "open" },
    { displayId: "other", title: "Review finances", state: "waiting" },
  ];
  const intent = parseIntent(
    JSON.stringify({
      inputMode: "lookup", lookupTaskIds: ["report"],
      state: "completed", statePhrase: input, completedTaskIds: ["report"],
    }),
    input,
    { tasks: items.map(({ displayId, title, state }) => ({ id: displayId, title, state })) },
  );
  assert.equal(intent.taskRelativeCompletion, true);
  const results = buildItems(input, { items, intent });
  assert.equal(results[0].title, "✅ Complete: Send report to Alice");
  assert.equal(decodeRequest(results[0].arg).state, "completed");
  assert.equal(decodeRequest(results[0].arg).comment, input);
  assert.equal(results.at(-1).title, "💬 Comment: Review finances");
});

test("unverified untargeted completion never proposes completing another task", () => {
  const input = "I finished sending the report";
  const items = [
    { displayId: "report", title: "Send report", state: "open" },
    { displayId: "unrelated", title: "Review finances", state: "canceled" },
  ];
  const intent = parseIntent(
    JSON.stringify({ state: "completed", statePhrase: input, completedTaskIds: ["report"] }),
    input,
    { tasks: items.map(({ displayId, title, state }) => ({ id: displayId, title, state })) },
  );
  assert.deepEqual(intent, { state: "completed" });
  const updates = buildItems(input, { items, intent })
    .filter((item) => decodeRequest(item.arg).action === "update_item");
  assert.deepEqual(updates.map((item) => item.title), [
    "💬 Comment: Send report", "💬 Comment: Review finances",
  ]);
  assert.ok(updates.every((item) => decodeRequest(item.arg).state === undefined));
  assert.ok(updates.every((item) => decodeRequest(item.arg).comment === input));
});

test("buildItems asks the user to choose an ambiguous completion target", () => {
  const results = buildItems("updated CODEOWNERS", {
    items: [
      { displayId: "first", title: "Update CODEOWNERS in Anaconda" },
      { displayId: "second", title: "Update CODEOWNERS in Mamba" },
      { displayId: "third", title: "Await approval of another task", state: "waiting" },
      { displayId: "fourth", title: "Old canceled task", state: "canceled" },
    ],
    intent: {
      state: "completed",
      taskRelativeCompletion: true,
      completedTaskIds: ["first", "second"],
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
  assert.deepEqual(
    results.slice(-2).map((result) => decodeRequest(result.arg)),
    [
      { action: "update_item", item: "third", comment: "updated CODEOWNERS" },
      { action: "update_item", item: "fourth", comment: "updated CODEOWNERS" },
    ],
  );
});

test("buildItems preserves a raw note when it offers an inferred title", () => {
  const results = buildItems("need ask Jade for a status update", {
    intent: { title: "Ask Jade for a status update" },
  });

  assert.equal(results.length, 2);
  assert.deepEqual(decodeRequest(results[0].arg), {
    action: "create_item",
    title: "Ask Jade for a status update",
    comment: "need ask Jade for a status update",
    labels: ["follow-up"],
  });
  assert.equal(results[0].title, "🆕 Create: Ask Jade for a status update");
  assert.match(results[0].subtitle, /rephrased · original note saved/);
  assert.doesNotMatch(results[0].subtitle, /comment only/);
  assert.deepEqual(decodeRequest(results[1].arg), {
    action: "create_item",
    title: "need ask Jade for a status update",
    comment: "need ask Jade for a status update",
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
    comment: "prepare release notes",
    project: "Anaconda",
    labels: ["release"],
  });
});
