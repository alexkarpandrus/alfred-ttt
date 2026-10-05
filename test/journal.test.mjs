import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { appendJournalNote } from "../src/journal.mjs";
import { applyJournalRequest, journalSuggestions } from "../src/journal-flow.mjs";
import { judgeTaskReport } from "../src/jev.mjs";
import { decodeRequest } from "../src/plan.mjs";

async function graph() {
  const root = await mkdtemp(join(tmpdir(), "alfred-ll-test-"));
  await mkdir(join(root, "logseq"));
  await mkdir(join(root, "journals"));
  await writeFile(join(root, "logseq", "config.edn"), "{}\n");
  return root;
}

const now = new Date(2026, 8, 24, 14, 6);
const openTask = { displayId: "abc123", title: "Ask Jade about data quality",
  project: { displayId: "Operations" }, state: "open", semanticProbability: 0.93 };

test("journal appends a timestamped plain block without creating a native TODO", async () => {
  const root = await graph();
  try {
    const file = join(root, "journals", "2026_09_24.md");
    await appendJournalNote("TODO ask Jade about data quality", { graph: root, now });
    assert.equal(await readFile(file, "utf8"), "- 14:06 TODO ask Jade about data quality\n");
    await writeFile(file, "- Earlier note");
    await appendJournalNote("Asked Jade about data quality", { graph: root, now });
    assert.equal(await readFile(file, "utf8"), "- Earlier note\n- 14:06 Asked Jade about data quality\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("journal rejects multiline input and an unconfigured graph without writing", async () => {
  const root = await graph();
  try {
    await assert.rejects(appendJournalNote("first\n- TODO injected", { graph: root }), /one nonempty line/);
    await assert.rejects(appendJournalNote("hello", { graph: join(root, "other") }), /graph not found/);
    assert.deepEqual(await (await import("node:fs/promises")).readdir(join(root, "journals")), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ll TODO proposes a Taskwarrior creation with the original note and no native Logseq TODO", async () => {
  const [item] = await journalSuggestions("TODO ask Jade about data quality");
  assert.match(item.subtitle, /pending ttt #90/);
  assert.deepEqual(decodeRequest(item.arg), {
    action: "journal", kind: "create", note: "TODO ask Jade about data quality",
    title: "ask Jade about data quality",
  });
});

test("ll offers completion only for a Jev-verified open task and shows its title", async () => {
  const note = "asked Jade about data quality";
  const items = await journalSuggestions(note, {
    search: async () => [openTask], judge: async () => true,
  });
  assert.match(items[0].title, /Complete Taskwarrior: Ask Jade/);
  assert.equal(decodeRequest(items[0].arg).item, "abc123");
  assert.equal(decodeRequest(items[1].arg).kind, "note");
  const [rejected] = await journalSuggestions(note, {
    search: async () => [openTask], judge: async () => false,
  });
  assert.equal(decodeRequest(rejected.arg).kind, "note");
  assert.doesNotMatch(rejected.title, /Complete/);
});

test("ll offers journal-only capture when semantic search returns unscored results", async () => {
  const note = "adsad";
  const [item] = await journalSuggestions(note, {
    search: async () => [{ ...openTask, semanticProbability: undefined }],
    judge: async () => assert.fail("Unscored tasks must not be judged for completion"),
  });
  assert.notEqual(item.valid, false);
  assert.match(item.subtitle, /Task completion not verified/);
  const request = decodeRequest(item.arg);
  assert.deepEqual(request, { action: "journal", kind: "note", note });
  let written;
  assert.equal(await applyJournalRequest(request, {
    append: async (text) => { written = text; },
    apply: async () => assert.fail("Journal-only capture must not change a task"),
  }), "Saved journal entry; no task changed");
  assert.equal(written, note);
});

test("journal applies Taskwarrior changes only after writing the raw entry", async () => {
  const events = [];
  const deps = {
    append: async (note) => events.push(["journal", note]),
    requireTracker: async () => {}, requireActions: async () => {},
    apply: async (request) => events.push(["ttt", request]),
    search: async () => [openTask], judge: async () => true,
  };
  const creation = await applyJournalRequest({ action: "journal", kind: "create",
    note: "TODO ask Jade about data quality", title: "ask Jade about data quality" }, deps);
  assert.match(creation, /created Taskwarrior/);
  assert.deepEqual(events[1], ["ttt", { action: "create_item", title: "ask Jade about data quality",
    comment: "TODO ask Jade about data quality" }]);
  events.length = 0;
  await applyJournalRequest({ action: "journal", kind: "complete",
    note: "asked Jade about data quality", item: "abc123", itemTitle: openTask.title,
    itemProject: "Operations" }, deps);
  assert.equal(events[0][0], "journal");
  assert.deepEqual(events[1], ["ttt", { action: "update_item", item: "abc123",
    state: "completed", comment: "asked Jade about data quality" }]);
});

test("journal refuses a changed target before writing and reports partial tracker failure", async () => {
  let written = false;
  const deps = {
    append: async () => { written = true; }, requireTracker: async () => {},
    requireActions: async () => {}, search: async () => [{ ...openTask, title: "Different task" }],
    judge: async () => true,
  };
  const request = { action: "journal", kind: "complete", note: "asked Jade",
    item: "abc123", itemTitle: openTask.title, itemProject: "Operations" };
  await assert.rejects(applyJournalRequest(request, deps), /no longer a verified match/);
  assert.equal(written, false);
  await assert.rejects(applyJournalRequest({ action: "journal", kind: "create",
    note: "TODO ask Jade", title: "ask Jade" }, {
    ...deps, apply: async () => { throw new Error("tracker unavailable"); },
  }), /Journal saved, but Taskwarrior was not confirmed/);
  assert.equal(written, true);
});

test("Jev rejects wrong recipients and projects even when another question favors completion", async () => {
  const reply = (same, relation = "unspecified") => ({ ok: true, json: async () => ({ answers: {
    same: { noul: same }, action: { choice: "complete", probabilities: { complete: 0.98 } },
    project: { choice: relation, confidence: 0.99 },
  } }) });
  const fetchMock = async (_url, request) => {
    const body = JSON.parse(request.body);
    assert.equal(body.state.task, openTask.title);
    assert.equal(request.headers.Authorization, "Bearer test-key");
    return reply(0.72);
  };
  assert.equal(await judgeTaskReport("asked Jade about data quality", openTask,
    { key: "test-key", fetch: fetchMock }), true);
  assert.equal(await judgeTaskReport("asked Bob about data quality", openTask,
    { key: "test-key", fetch: async () => reply(0.03) }), false);
  assert.equal(await judgeTaskReport("asked Jade in AnotherProject", openTask,
    { key: "test-key", fetch: async () => reply(0.95, "different") }), false);
});

test("ll keeps hashtags in the journal and sends them as Taskwarrior labels", async () => {
  const note = "TODO ask Jade about data quality #sadsad";
  const [item] = await journalSuggestions(note);
  assert.match(item.subtitle, /Taskwarrior tags: \+sadsad/);
  const events = [];
  const deps = {
    append: async (text) => events.push(["journal", text]),
    requireTracker: async () => {}, requireActions: async () => {},
    apply: async (request) => events.push(["ttt", request]),
    search: async () => [openTask], judge: async () => true,
  };
  await applyJournalRequest(decodeRequest(item.arg), deps);
  assert.deepEqual(events[0], ["journal", note]);
  assert.deepEqual(events[1][1], {
    action: "create_item", title: "ask Jade about data quality #sadsad",
    comment: note, labels: ["sadsad"],
  });

  const report = "asked Jade about data quality #sadsad";
  const [completion] = await journalSuggestions(report, deps);
  assert.match(completion.subtitle, /Taskwarrior tags: \+sadsad/);
  events.length = 0;
  await applyJournalRequest(decodeRequest(completion.arg), deps);
  assert.deepEqual(events[0], ["journal", report]);
  assert.deepEqual(events[1][1], {
    action: "update_item", item: "abc123", state: "completed",
    comment: report, addLabels: ["sadsad"],
  });
});

test("Jev requires an Alfred-configured key before sending a task decision", async () => {
  await assert.rejects(
    judgeTaskReport("asked Jade", openTask, { key: "", fetch: () => {
      throw new Error("Jev must not be called without a key");
    } }),
    /Set the Jev API key in Alfred workflow configuration/,
  );
});
