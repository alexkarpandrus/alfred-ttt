import assert from "node:assert/strict";
import test from "node:test";

import { buildItems, decodeRequest, matchingTitles, parseCommand } from "../src/plan.mjs";
import { parseIntent } from "../src/rephrase.mjs";

const completionCases = [
  ["I sent the report to Alice", "Send report to Alice", true],
  ["We sent the report to Alice", "Send report to Alice", true],
  ["The report was sent to Alice", "Send report to Alice", true],
  ["I've sent the report to Alice", "Send report to Alice", true],
  ["Yesterday I sent the report to Alice", "Send report to Alice", true],
  ["I sent the report to Alice and will email the team", "Send report to Alice", true],
  ["send the report to Alice", "Send report to Alice", false],
  ["Please send the report to Alice", "Send report to Alice", false],
  ["I will send the report to Alice", "Send report to Alice", false],
  ["I might have sent the report to Alice", "Send report to Alice", false],
  ["Maybe I sent the report to Alice", "Send report to Alice", false],
  ["I did not send the report to Alice", "Send report to Alice", false],
  ["If I sent the report to Alice", "Send report to Alice", false],
  ["I heard Alice sent the report to Alice", "Send report to Alice", false],
  ["I sent the report to Bob", "Send report to Alice", false],
  ["I sent the invoice to Alice", "Send report to Alice", false],
  ["The report was sent to Bob", "Send report to Alice", false],
  ["I plan to send the report to Alice", "Send report to Alice", false],
  ["I sent the report to Alice?", "Send report to Alice", false],
  ["I fixed the billing retries", "Fix billing retries", true],
  ["I resolved the billing retries", "Fix billing retries", true],
  ["Answered Maryna", "Respond to Maryna", true],
  ["I replied to Maryna", "Respond to Maryna", true],
  ["I archived invoices in Anaconda", "Archive invoices in Mamba", false],
  ["I added Alex to CODEOWNERS", "Add Sam to CODEOWNERS", false],
];

test("past-work notes complete the task whose action the note reports", () => {
  for (const [note, title, shouldComplete] of completionCases) {
    const tasks = [
      { id: "selected", title, state: "open" },
      { id: "unrelated", title: "Review finances", state: "canceled" },
    ];
    const intent = parseIntent(
      JSON.stringify({
        inputMode: "lookup",
        lookupTaskIds: ["selected"],
        state: "completed",
        statePhrase: note,
        completedTaskIds: ["selected", "unrelated", "invented"],
      }),
      note,
      { tasks },
    );
    const results = buildItems(note, {
      items: tasks.map(({ id, title: taskTitle, state }) => ({ displayId: id, title: taskTitle, state })),
      intent,
    });
    const updates = results.filter((item) => item.arg)
      .map((item) => decodeRequest(item.arg))
      .filter((request) => request.action === "update_item");
    assert.equal(intent.taskRelativeCompletion === true, shouldComplete, note);
    assert.deepEqual(
      updates.filter((request) => request.state === "completed").map((request) => request.item),
      shouldComplete ? ["selected"] : [],
      note,
    );
    if (shouldComplete) assert.match(results[0].title, /^✅ Complete:/, note);
  }
});

test("completion requires a task that is still eligible", () => {
  const note = "I sent the report to Alice";
  for (const [state, shouldComplete] of [
    ["open", true], ["active", true], ["waiting", true],
    ["completed", false], ["canceled", false],
  ]) {
    const intent = parseIntent(
      JSON.stringify({ state: "completed", statePhrase: note, completedTaskIds: ["report"] }),
      note,
      { tasks: [{ id: "report", title: "Send report to Alice", state }] },
    );
    assert.equal(intent.taskRelativeCompletion === true, shouldComplete, state);
  }
});

test("a mistaken lookup cannot swallow personal progress notes", () => {
  const cases = [
    ["I might have sent the report to Alice", "capture"],
    ["I did not send the report to Alice", "capture"],
    ["I sent the report to Bob", "capture"],
    ["We may have sent the report to Alice", "capture"],
    ["I will send the report to Alice", "capture"],
    ["I have sent the report to Alice", "capture"],
    ["I wonder where the report is", "lookup"],
    ["Did I send the report?", "lookup"],
    ["I might have sent the report?", "lookup"],
  ];
  const tasks = [{ id: "report", title: "Send report to Alice", state: "open" }];
  for (const [note, expected] of cases) {
    const intent = parseIntent(
      JSON.stringify({ inputMode: "lookup", lookupTaskIds: ["report"] }),
      note,
      { tasks },
    );
    assert.equal(intent.inputMode, expected, note);
    const [first] = buildItems(note, {
      items: [{ displayId: "report", title: tasks[0].title, state: "open" }],
      intent,
    });
    assert.equal(expected === "lookup" ? first.autocomplete : decodeRequest(first.arg).action,
      expected === "lookup" ? "report: " : "create_item", note);
  }
});

test("future, uncertain, and negated completion words cannot complete new or existing work", () => {
  const notes = [
    "I did not complete the report to Alice",
    "I didn't complete the report to Alice",
    "I haven't completed the report to Alice",
    "I might have completed the report to Alice",
    "I may have completed the report to Alice",
    "I will complete the report to Alice",
    "Please complete the report to Alice",
    "Can you complete the report to Alice?",
    "Complete the report tomorrow",
    "Complete the report next week",
  ];
  const task = { id: "report", title: "Complete report to Alice", state: "open" };
  for (const note of notes) {
    const intent = parseIntent(JSON.stringify({
      inputMode: "capture", state: "completed", statePhrase: note,
      completedTaskIds: ["report"],
    }), note, { tasks: [task] });
    const results = buildItems(note, {
      items: [{ displayId: task.id, title: task.title, state: task.state }],
      intent,
    });
    assert.equal(intent.state, undefined, note);
    assert.ok(results.filter((item) => item.arg)
      .every((item) => decodeRequest(item.arg).state !== "completed"), note);
  }
  assert.equal(parseIntent(JSON.stringify({ state: "completed" }),
    "I completed the report in May").state, "completed");
});

test("started-work notes propose Active only for related live tasks", () => {
  const items = [
    { displayId: "dana", title: "Build indexing project for Dana", state: "open" },
    { displayId: "feature", title: "Implement Mamba search feature", state: "waiting" },
    { displayId: "otherMamba", title: "Add user to Mamba CODEOWNERS", state: "open" },
    { displayId: "closed", title: "Archive Mamba migration", state: "completed" },
    { displayId: "other", title: "Review roadmap", state: "open" },
  ];
  const cases = [
    ["started working on a project for Dana", ["dana"]],
    ["started Mamab search feature", ["feature"]],
    ["started mamab feature", ["feature", "otherMamba"]],
    ["started Mamba CODEOWNERS", ["otherMamba"]],
    ["I have started the Mamba search feature", ["feature"]],
    ["I'm working on the Mamba search feature", ["feature"]],
    ["started working on an untracked project", []],
    ["started a task", []],
    ["started working on a project for Bob", []],
    ["started CODEOWNERS for Dana", []],
  ];
  for (const [note, expectedIds] of cases) {
    const intent = parseIntent(JSON.stringify({
      inputMode: "lookup", lookupTaskIds: ["other"], state: "completed",
      statePhrase: note, completedTaskIds: items.map((item) => item.displayId),
    }), note, { tasks: items.map(({ displayId, title, state }) => ({ id: displayId, title, state })) });
    const choices = buildItems(note, { items, intent });
    const updates = choices.filter((choice) => choice.arg)
      .map((choice) => decodeRequest(choice.arg))
      .filter((request) => request.action === "update_item");
    assert.equal(intent.inputMode, "capture", note);
    assert.equal(intent.state, "active", note);
    assert.deepEqual(intent.updateTaskIds, expectedIds, note);
    assert.deepEqual(updates.filter((request) => request.state === "active").map((request) => request.item), expectedIds, note);
    assert.ok(updates.every((request) => request.comment === note), note);
    assert.ok(updates.filter((request) => !expectedIds.includes(request.item))
      .every((request) => request.state === undefined), note);
    assert.equal(expectedIds.length ? decodeRequest(choices[0].arg).item : decodeRequest(choices[0].arg).action,
      expectedIds[0] || "create_item", note);
  }
});

test("literal title matches do not mask progress notes", () => {
  const note = "started Mamba feature";
  const items = [{ displayId: "feature", title: "Started Mamba feature", state: "open" }];
  const intent = parseIntent(JSON.stringify({ inputMode: "lookup", state: "unchanged" }), note,
    { tasks: [{ id: "feature", title: items[0].title, state: "open" }] });
  assert.deepEqual(matchingTitles(items, note), []);
  assert.equal(decodeRequest(buildItems(note, { items, intent })[0].arg).state, "active");
  assert.deepEqual(matchingTitles(items, "I sent the report"), []);
  assert.deepEqual(matchingTitles(items, "Mamba feature"), items);
});

test("started-work metadata stays on the matching update", () => {
  const note = "started Mamba search high priority +ops";
  const items = [
    { displayId: "feature", title: "Implement Mamba search", state: "open" },
    { displayId: "other", title: "Add teammate to Mamba CODEOWNERS", state: "open" },
  ];
  const intent = parseIntent(JSON.stringify({
    state: "unchanged", priority: "high", priorityPhrase: "high priority", labels: ["ops"],
  }), note, { tasks: items.map(({ displayId, title, state }) => ({ id: displayId, title, state })), labels: ["ops"] });
  const choices = buildItems(note, { items, intent });
  const selected = decodeRequest(choices[0].arg);
  const unrelated = choices.filter((choice) => choice.arg).map((choice) => decodeRequest(choice.arg))
    .find((request) => request.item === "other");
  assert.deepEqual(intent.updateTaskIds, ["feature"]);
  assert.deepEqual(selected, { action: "update_item", item: "feature", comment: note,
    state: "active", priority: "high", addLabels: ["ops"] });
  assert.deepEqual(unrelated, { action: "update_item", item: "other", comment: note });
});

test("starting a completion action is not a completed-task report", () => {
  const note = "started completing the report for Dana";
  const task = { id: "report", title: "Complete report for Dana", state: "open" };
  const intent = parseIntent(JSON.stringify({ state: "completed", statePhrase: note,
    completedTaskIds: ["report"] }), note, { tasks: [task] });
  const choices = buildItems(note, { items: [{ ...task, displayId: task.id }], intent });
  assert.equal(intent.state, "active");
  assert.equal(intent.taskRelativeCompletion, undefined);
  assert.ok(choices.filter((choice) => choice.arg)
    .every((choice) => decodeRequest(choice.arg).state !== "completed"));
});

test("requests, negation, and questions do not mark work Active", () => {
  const notes = [
    "I will start the Mamba feature",
    "I might start the Mamba feature",
    "I did not start the Mamba feature",
    "Please start the Mamba feature",
    "Start the Mamba feature next week",
    "Did I start the Mamba feature?",
  ];
  for (const note of notes) {
    const intent = parseIntent(JSON.stringify({
      inputMode: "capture", state: "active",
    }), note, { tasks: [{ id: "feature", title: "Implement Mamba feature", state: "open" }] });
    assert.equal(intent.startedWork, undefined, note);
    assert.equal(intent.state, undefined, note);
  }
  assert.equal(parseIntent(JSON.stringify({ state: "active" }), "start").state, "active");
});

test("lookup phrases browse; action notes still offer creation", () => {
  const items = [
    { displayId: "receipts", title: "Archive quarterly receipts", state: "open" },
    { displayId: "billing", title: "Fix billing retry failures", state: "active" },
    { displayId: "release", title: "Prepare release notes", state: "waiting" },
    { displayId: "interviews", title: "Review customer interviews", state: "open" },
    { displayId: "open", title: "Open planning notes", state: "waiting" },
  ];
  const cases = [
    ["receipts", {}, "browse", "receipts"],
    ["QUARTERLY RECEIPTS", {}, "browse", "receipts"],
    ["billing retry", {}, "browse", "billing"],
    ["release notes", {}, "browse", "release"],
    ["open", {}, "browse", "open"],
    ["PREPARE RELEASE NOTES", { inputMode: "capture" }, "browse", "release"],
    ["billing retry", { inputMode: "capture" }, "browse", "billing"],
    ["where are the interviews?", { inputMode: "lookup", lookupTaskIds: ["interviews"] }, "browse", "interviews"],
    ["where is the billing fix?", { inputMode: "lookup", lookupTaskIds: ["billing"] }, "browse", "billing"],
    ["something unknown", { inputMode: "lookup", lookupTaskIds: [] }, "missing"],
    ["please prepare release notes", { inputMode: "capture" }, "create"],
    ["archive new receipts", { inputMode: "capture" }, "create"],
    ["fix billing failures", { inputMode: "lookup", lookupTaskIds: ["billing"] }, "create"],
    ["repair billing failures", { inputMode: "capture" }, "create"],
    ["I sent a report", { inputMode: "capture" }, "create"],
    ["unknown", {}, "create"],
  ];
  for (const [note, intent, expected, id] of cases) {
    const results = buildItems(note, { items, intent });
    if (expected === "browse") {
      assert.equal(results[0].autocomplete, `${id}: `, note);
      assert.ok(results.every((result) => !result.arg), note);
    } else if (expected === "missing") {
      assert.match(results[0].title, /^No tasks match/, note);
      assert.equal(results[0].arg, undefined, note);
    } else {
      assert.equal(decodeRequest(results[0].arg).action, "create_item", note);
    }
  }
});

test("explicit capture requests keep Create when the model guesses lookup", () => {
  const unrelated = { displayId: "unrelated", title: "Raise deprecate request for patrol", state: "open" };
  const notes = ["respond to Maryna", "reply to Maryna", "please respond to Maryna",
    "create a task to respond to Maryna", "add a new task to respond to Maryna"];
  for (const note of notes) {
    const existing = { displayId: "matching", title: note, state: "open" };
    const tasks = [unrelated, existing].map(({ displayId, title, state }) => ({ id: displayId, title, state }));
    const intent = parseIntent(JSON.stringify({ inputMode: "lookup", lookupTaskIds: ["unrelated"],
      title: "Respond to Maryna" }), note, { tasks });
    assert.equal(intent.inputMode, "capture", note);
    assert.deepEqual(matchingTitles([existing], note), [], note);
    for (const items of [[unrelated], [existing]]) {
      const request = decodeRequest(buildItems(note, { items, intent })[0].arg);
      assert.equal(request.action, "create_item", note);
      assert.equal(request.comment, note);
    }
  }
  assert.equal(parseIntent(JSON.stringify({ inputMode: "lookup" }), "respond to Maryna?").inputMode, "lookup");
  const existing = { title: "Respond to Maryna" };
  assert.deepEqual(matchingTitles([existing], "Maryna"), [existing]);
});

test("a progress report stays actionable on the task the model resolved", () => {
  const items = [
    { displayId: "maryna", title: "Respond to Maryna", state: "open" },
    { displayId: "patrol", title: "Raise deprecate request for patrol", state: "open" },
  ];
  for (const note of ["answered maryna", "replied to maryna"]) {
    const results = buildItems(note, {
      items,
      intent: { inputMode: "lookup", lookupTaskIds: ["maryna"], title: "Respond to Maryna" },
    });
    assert.ok(results.every((result) => result.arg), note);
    assert.deepEqual(decodeRequest(results[0].arg), {
      action: "update_item", item: "maryna", comment: note,
    }, note);
  }
  for (const question of ["did i answer maryna?", "answered maryna?"]) {
    const [only] = buildItems(question, {
      items,
      intent: { inputMode: "lookup", lookupTaskIds: ["maryna"] },
    });
    assert.equal(only.arg, undefined, question);
    assert.equal(only.autocomplete, "maryna: ", question);
  }
});

test("targeted state commands preserve the note and never create a task", () => {
  const cases = [
    ["done", "completed", "completed"],
    ["complete", "completed", "completed"],
    ["close", "completed", undefined],
    ["cancel", "canceled", "canceled"],
    ["waiting", "waiting", "waiting"],
    ["blocked", "waiting", "waiting"],
    ["pause", "waiting", "waiting"],
    ["reopen", "open", "open"],
    ["start", "active", "active"],
    ["started", "unchanged", "active"],
    ["hold", "waiting", undefined],
  ];
  for (const [note, modelState, expectedState] of cases) {
    const command = parseCommand(`a1b2c3d4: ${note}`);
    const intent = parseIntent(JSON.stringify({ state: modelState, statePhrase: note }), note);
    const [item] = buildItems(command.text, {
      items: [{ displayId: command.target, title: "Review the invoice", state: "open" }],
      intent,
      target: command.target,
      allowCreate: false,
    });
    const request = decodeRequest(item.arg);
    assert.equal(request.action, "update_item", note);
    assert.equal(request.item, "a1b2c3d4", note);
    assert.equal(request.comment, note, note);
    assert.equal(request.state, expectedState, note);
  }
});

test("priority and due dates require sourced, explicit words", () => {
  const priorities = [
    ["urgent", "urgent", "urgent", "urgent"],
    ["high priority", "high", "high priority", "high"],
    ["low prio", "low", "low prio", "low"],
    ["no priority", "none", "no priority", "none"],
    ["critical", "urgent", "critical", "urgent"],
    ["routine review", "urgent", "routine", undefined],
  ];
  for (const [note, modelPriority, phrase, expected] of priorities) {
    const intent = parseIntent(JSON.stringify({ priority: modelPriority, priorityPhrase: phrase }), note);
    assert.equal(intent.priority, expected, note);
  }
  const explicit = parseIntent(JSON.stringify({
    dueAt: "2026-10-23T09:00:00-07:00", duePhrase: "by Friday",
  }), "Submit invoice by Friday");
  assert.ok(explicit.dueAt, "explicit due date");
  const invented = parseIntent(JSON.stringify({
    dueAt: "2026-10-23T09:00:00-07:00", duePhrase: "by Friday",
  }), "Submit invoice soon");
  assert.equal(invented.dueAt, undefined, "unsourced due date");
});

test("a bare trailing day ends at local 23:59:59 even if the model misses or guesses midnight", () => {
  const note = "respond to Maryna tomorrow";
  const before = new Date();
  const intent = parseIntent(JSON.stringify({ inputMode: "lookup", title: "Respond to Maryna tomorrow",
    dueAt: "", duePhrase: "" }), note);
  const after = new Date();
  const tomorrow = (now) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 23, 59, 59).toISOString();
  assert.ok([tomorrow(before), tomorrow(after)].includes(intent.dueAt));
  assert.equal(parseIntent(JSON.stringify({ dueAt: "2026-09-25T00:00:00+02:00",
    duePhrase: "tomorrow" }), note).dueAt, intent.dueAt);
  const today = (now) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();
  assert.ok([today(before), today(after)].includes(parseIntent("{}", "respond to Maryna today").dueAt));
  assert.equal(intent.title, "Respond to Maryna");
  const create = decodeRequest(buildItems(note, { intent })[0].arg);
  assert.equal(create.action, "create_item");
  assert.equal(create.dueAt, intent.dueAt);
  assert.equal(create.comment, note);
  for (const uncertain of ["maybe respond to Maryna tomorrow", "respond to Maryna not tomorrow",
    "respond to Maryna tomorrow?", "respond to Maryna tomorrow at 5pm"]) {
    assert.equal(parseIntent("{}", uncertain).dueAt, undefined, uncertain);
  }
});
