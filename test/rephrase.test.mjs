import assert from "node:assert/strict";
import test from "node:test";

import { buildInferenceContext, cleanTitle, parseIntent } from "../src/rephrase.mjs";

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

test("parseIntent accepts task-relative past-tense completion", () => {
  const context = {
    tasks: [
      {
        id: "de34c681",
        title: "Add Wojtech to CODEOWNERS",
        state: "open",
      },
    ],
  };

  assert.deepEqual(
    parseIntent(
      JSON.stringify({
        title: "Add Wojtech to CODEOWNERS",
        state: "open",
        statePhrase: "added w to codeowners",
        completedTaskIds: ["de34c681"],
      }),
      "added w to codeowners",
      context,
    ),
    {
      title: "Add Wojtech to CODEOWNERS",
      state: "completed",
      taskRelativeCompletion: true,
      completedTaskIds: ["de34c681"],
    },
  );
});

test("parseIntent accepts an ambiguous task-relative completion", () => {
  assert.deepEqual(
    parseIntent(
      JSON.stringify({
        title: "Update CODEOWNERS",
        state: "completed",
        statePhrase: "updated CODEOWNERS",
        completedTaskIds: ["first", "second", "canceled", "missing"],
      }),
      "updated CODEOWNERS",
      {
        tasks: [
          { id: "first", title: "Update CODEOWNERS", state: "open" },
          { id: "second", title: "Update CODEOWNERS", state: "active" },
          { id: "unrelated", state: "waiting" },
          { id: "canceled", state: "canceled" },
        ],
      },
    ),
    {
      title: "Update CODEOWNERS",
      state: "completed",
      taskRelativeCompletion: true,
      completedTaskIds: ["first", "second"],
    },
  );
});

test("parseIntent rejects task-relative completion without a completable task", () => {
  assert.deepEqual(
    parseIntent(
      JSON.stringify({
        title: "Record the CODEOWNERS update",
        state: "completed",
        statePhrase: "updated CODEOWNERS",
        completedTaskIds: ["de34c681"],
      }),
      "updated CODEOWNERS",
      { tasks: [{ id: "de34c681", state: "completed" }] },
    ),
    { title: "Record the CODEOWNERS update" },
  );
});

test("parseIntent rejects model-inferred completion for action requests", () => {
  const context = { tasks: [{ id: "de34c681", state: "open" }] };
  for (const input of [
    "add w to codeowners",
    "please add w to codeowners",
    "w should be added to codeowners",
    "w was not added to codeowners",
    "set w in codeowners",
    "I expected to add w to codeowners",
  ]) {
    assert.deepEqual(
      parseIntent(
        JSON.stringify({
          state: "completed",
          statePhrase: input,
          completedTaskIds: ["de34c681"],
        }),
        input,
        context,
      ),
      {},
      input,
    );
  }
});

test("parseIntent accepts other reported past work", () => {
  assert.deepEqual(
    parseIntent(
      JSON.stringify({
        state: "completed",
        statePhrase: "I sent the report",
        completedTaskIds: ["report"],
      }),
      "I sent the report",
      { tasks: [{ id: "report", title: "Send the report", state: "active" }] },
    ),
    { state: "completed", taskRelativeCompletion: true, completedTaskIds: ["report"] },
  );
});

test("parseIntent accepts an irregular past form of the task action", () => {
  const input = "I wrote report";
  assert.deepEqual(
    parseIntent(
      JSON.stringify({
        state: "completed",
        statePhrase: input,
        completedTaskIds: ["report"],
      }),
      input,
      { tasks: [{ id: "report", title: "Write report", state: "open" }] },
    ),
    { state: "completed", taskRelativeCompletion: true, completedTaskIds: ["report"] },
  );
});

test("parseIntent recognizes doubled consonants and conjunctions within a task", () => {
  for (const [input, title] of [
    ["I stopped timer", "Stop timer"],
    ["I dropped report", "Drop report"],
    ["I updated research and development docs", "Update research and development docs"],
  ]) {
    assert.deepEqual(
      parseIntent(
        JSON.stringify({ state: "completed", statePhrase: input, completedTaskIds: ["task"] }),
        input,
        { tasks: [{ id: "task", title, state: "open" }] },
      ),
      { state: "completed", taskRelativeCompletion: true, completedTaskIds: ["task"] },
      input,
    );
  }
});

test("parseIntent accepts completed work with adverbs and later request clauses", () => {
  const context = { tasks: [{ id: "de34c681", title: "Add Wojtech to CODEOWNERS", state: "open" }] };
  for (const [input, statePhrase] of [
    ["I finally added w to codeowners", "added w to codeowners"],
    ["added w to codeowners, but need to tell the team", "added w to codeowners"],
    ["added w to codeowners and need to tell the team", "need to tell the team"],
    ["I've added w to codeowners", "added w to codeowners"],
  ]) {
    assert.deepEqual(
      parseIntent(
        JSON.stringify({
          state: "completed",
          statePhrase,
          completedTaskIds: ["de34c681"],
        }),
        input,
        context,
      ),
      {
        state: "completed",
        taskRelativeCompletion: true,
        completedTaskIds: ["de34c681"],
      },
      input,
    );
  }
});

test("parseIntent does not use past work from a different clause", () => {
  for (const [input, statePhrase] of [
    ["add w to codeowners; I sent the report", "I sent the report"],
    ["add w to codeowners; I added the report to codeowners", "add w to codeowners"],
    ["I sent the report and add w to codeowners", "add w to codeowners"],
    ["I added the report to codeowners", "I added the report to codeowners"],
    ["I added the report to CODEOWNERS and can add w to CODEOWNERS", "I added the report to CODEOWNERS"],
    ["I added the report to CODEOWNERS and I can add w to CODEOWNERS", "I added the report to CODEOWNERS"],
    ["I added the report to CODEOWNERS and you can add w to CODEOWNERS", "I added the report to CODEOWNERS"],
    ["I added the report to CODEOWNERS and I'll add w to CODEOWNERS", "I added the report to CODEOWNERS"],
    ["I added the report to CODEOWNERS and I’ll add w to CODEOWNERS", "I added the report to CODEOWNERS"],
    ["I added the report to CODEOWNERS and I won't add w to CODEOWNERS", "I added the report to CODEOWNERS"],
  ]) {
    assert.deepEqual(
      parseIntent(
        JSON.stringify({
          state: "completed",
          statePhrase,
          completedTaskIds: ["de34c681"],
        }),
        input,
        { tasks: [{ id: "de34c681", title: "Add Wojtech to CODEOWNERS", state: "open" }] },
      ),
      {},
      input,
    );
  }
});


test("buildInferenceContext exposes bounded task taxonomy", () => {
  assert.deepEqual(
    buildInferenceContext(
      [
        {
          displayId: "abc123",
          title: "Prepare release notes",
          state: "open",
          semanticProbability: 0.96,
          project: { displayId: "Anaconda" },
          labels: [{ displayId: "release" }, { displayId: "blocked" }],
        },
      ],
      [{ displayId: "Mamba" }],
      [{ displayId: "security" }],
    ),
    {
      tasks: [
        {
          id: "abc123",
          title: "Prepare release notes",
          state: "open",
          semanticProbability: 0.96,
          project: "Anaconda",
          labels: ["release"],
        },
      ],
      projects: ["Mamba", "Anaconda"],
      labels: ["security", "release"],
    },
  );
});


test("buildInferenceContext bounds labels on each task", () => {
  const [task] = buildInferenceContext([
    {
      displayId: "abc123",
      labels: Array.from({ length: 8 }, (_, index) => ({
        displayId: `label-${index}`,
      })),
    },
  ]).tasks;

  assert.deepEqual(task.labels, [
    "label-0",
    "label-1",
    "label-2",
    "label-3",
    "label-4",
  ]);
});

test("parseIntent reuses known taxonomy and rejects invented lifecycle labels", () => {
  assert.deepEqual(
    parseIntent(
      JSON.stringify({
        title: "Prepare customer escalation release notes",
        state: "unchanged",
        project: "anaconda",
        labels: ["release", "blocked", "invented"],
      }),
      "prepare customer escalation release notes +customer-escalation",
      { projects: ["Anaconda"], labels: ["release"] },
    ),
    {
      title: "Prepare customer escalation release notes",
      project: "Anaconda",
      labels: ["release", "customer-escalation"],
    },
  );
});


test("parseIntent accepts only relevant existing labels", () => {
  const context = { labels: ["deprecate"] };
  assert.deepEqual(
    parseIntent(
      '{"title":"Ask M about B","labels":["deprecate"]}',
      "Ask M about B",
      context,
    ),
    {},
  );
  assert.deepEqual(
    parseIntent(
      '{"title":"Raise deprecation request","labels":["deprecate"]}',
      "Raise deprecation request",
      context,
    ),
    { labels: ["deprecate"] },
  );
});


test("parseIntent accepts explicit priority and due-date metadata", () => {
  assert.deepEqual(
    parseIntent(
      JSON.stringify({
        title: "Ask M about B low prio tomorrow",
        state: "unchanged",
        priority: "low",
        priorityPhrase: "low prio",
        dueAt: "2026-09-24T12:34:56-07:00",
        duePhrase: "tomorrow",
        project: "",
        labels: ["low-prio", "add"],
      }),
      "Ask M about B low prio tomorrow",
    ),
    {
      title: "Ask M about B",
      priority: "low",
      dueAt: "2026-09-24T07:00:00.000Z",
    },
  );
});


test("parseIntent preserves an explicit due time", () => {
  assert.deepEqual(
    parseIntent(
      JSON.stringify({
        title: "Send report tomorrow at 5pm",
        dueAt: "2026-09-24T17:00:00-07:00",
        duePhrase: "tomorrow at 5pm",
      }),
      "Send report tomorrow at 5pm",
    ),
    {
      title: "Send report",
      dueAt: "2026-09-25T00:00:00.000Z",
    },
  );
});

test("parseIntent rejects unsourced priority and due-date metadata", () => {
  assert.deepEqual(
    parseIntent(
      JSON.stringify({
        title: "Ask M about B",
        priority: "high",
        priorityPhrase: "high priority",
        dueAt: "2026-09-24T00:00:00Z",
        duePhrase: "tomorrow",
      }),
      "Ask M about B",
    ),
    {},
  );
});


test("parseIntent rejects model-invented metadata backed by unrelated text", () => {
  const input = "Raise deprecation request for API v1";
  assert.deepEqual(
    parseIntent(
      JSON.stringify({
        title: input,
        priority: "high",
        priorityPhrase: "deprecation request",
        dueAt: "2026-09-23T12:04:21+02:00",
        duePhrase: input,
      }),
      input,
    ),
    {},
  );
});

test("parseIntent ignores unchanged and malformed model output", () => {
  assert.deepEqual(
    parseIntent('{"title":"Same note","state":"unchanged"}', "Same note"),
    {},
  );
  assert.deepEqual(parseIntent("not json", "Same note"), {});
});
