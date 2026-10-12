import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { appendJournalNote, journalGraph } from "../src/journal.mjs";
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
const deps = { profile: "journal", env: { LOGSEQ_GRAPH: "/fixture/graph" },
  requireTracker: async () => {}, requireActions: async () => {},
  search: async () => [openTask], judge: async () => true };
const capture = { action: "journal", kind: "create", note: "TODO ask Jade",
  title: "ask Jade", profile: "journal", graph: "/fixture/graph" };
const completion = { ...capture, kind: "complete", note: "asked Jade about data quality",
  item: openTask.displayId, itemTitle: openTask.title, itemProject: "Operations" };

test("journal appends a timestamped plain block without creating a native TODO", async () => {
  const root = await graph();
  try {
    const file = join(root, "journals", "2026_09_24.md");
    await appendJournalNote("TODO ask Jade about data quality", { graph: root, now });
    assert.equal(await readFile(file, "utf8"), "- 14:06 TODO ask Jade about data quality\n");
    await writeFile(file, "- Earlier note");
    await appendJournalNote("Asked Jade about data quality", { graph: root, now });
    assert.equal(await readFile(file, "utf8"), "- Earlier note\n- 14:06 Asked Jade about data quality\n");
    assert.equal(journalGraph(root), root);
    assert.equal(journalGraph(""), journalGraph("~/logseq"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("journal rejects multiline input and an unconfigured graph without writing", async () => {
  const root = await graph();
  try {
    await assert.rejects(appendJournalNote("first\n- TODO injected", { graph: root }), /one nonempty line/);
    await assert.rejects(appendJournalNote("hello", { graph: join(root, "other") }), /graph not found/);
    assert.deepEqual(await readdir(join(root, "journals")), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("ll TODO proposes a native Logseq task bound to its profile and graph", async () => {
  const [item] = await journalSuggestions("TODO ask Jade about data quality #ops", deps);
  assert.match(item.title, /Create Logseq TODO/);
  assert.doesNotMatch(item.subtitle, /Taskwarrior|pending/);
  assert.deepEqual(decodeRequest(item.arg), { ...capture,
    note: "TODO ask Jade about data quality #ops", title: "ask Jade about data quality #ops" });
});

test("ll offers completion only for a Jev-verified open Logseq task", async () => {
  const items = await journalSuggestions(completion.note, deps);
  assert.match(items[0].title, /Complete Logseq: Ask Jade/);
  const { title, ...expected } = completion;
  assert.deepEqual(decodeRequest(items[0].arg), expected);
  assert.equal(decodeRequest(items[1].arg).kind, "note");
  for (const options of [{ judge: async () => false }, { search: async () => [{ ...openTask, state: "completed" }] },
    { search: async () => [{ ...openTask, semanticProbability: 0.2 }] }]) {
    const [item] = await journalSuggestions(completion.note, { ...deps, ...options });
    assert.equal(decodeRequest(item.arg).kind, "note");
  }
});

test("ll offers journal-only capture for unscored results or a missing task profile", async () => {
  for (const options of [
    { ...deps, search: async () => [{ ...openTask, semanticProbability: undefined }], judge: () => assert.fail("Unscored tasks must not be judged") },
    { env: { LOGSEQ_PROFILE: "", LOGSEQ_GRAPH: "/fixture/graph" }, search: () => assert.fail("Missing profiles must not fall back to Taskwarrior") },
  ]) {
    const [item] = await journalSuggestions("adsad", options);
    const request = decodeRequest(item.arg);
    assert.deepEqual(request, { action: "journal", kind: "note", note: "adsad", graph: "/fixture/graph" });
    let written;
    assert.equal(await applyJournalRequest(request, { ...deps, append: async (text) => { written = text; },
      apply: () => assert.fail("Journal-only capture must not change a task") }), "Saved journal entry; no task changed");
    assert.equal(written, "adsad");
  }
  await assert.rejects(journalSuggestions("TODO a task", { env: { LOGSEQ_PROFILE: "" } }), /Set LOGSEQ_PROFILE/);
});

test("native creation preserves hashtags in text and does not duplicate the journal TODO", async () => {
  const calls = [];
  const [item] = await journalSuggestions("TODO ask Jade #new-tag", deps);
  const result = await applyJournalRequest(decodeRequest(item.arg), { ...deps,
    append: () => assert.fail("The native TODO is already a journal entry"),
    apply: async (request, options) => calls.push({ request, profile: options.profile, graph: options.env.LOGSEQ_GRAPH }) });
  assert.match(result, /Created Logseq TODO/);
  assert.deepEqual(calls, [{ request: { action: "create_item", title: "ask Jade #new-tag", comment: "TODO ask Jade #new-tag" },
    profile: "journal", graph: "/fixture/graph" }]);
});

test("verified completion updates the native task before saving its journal entry", async () => {
  const events = [];
  await applyJournalRequest(completion, { ...deps,
    apply: async (request, options) => events.push(["native", request, options.profile]),
    append: async (note) => events.push(["journal", note]) });
  assert.deepEqual(events, [["native", { action: "update_item", item: "abc123", state: "completed", comment: completion.note }, "journal"],
    ["journal", completion.note]]);
});

test("changed task, profile, graph, or completion judgment prevents all writes", async () => {
  const noWrite = () => assert.fail("Stale approvals must not write");
  for (const options of [{ profile: "other" }, { env: { LOGSEQ_GRAPH: "/different/graph" } },
    { search: async () => [{ ...openTask, title: "Different task" }] },
    { search: async () => [{ ...openTask, project: { displayId: "Different project" } }] },
    { search: async () => [{ ...openTask, state: "completed" }] }, { judge: async () => false }]) {
    await assert.rejects(applyJournalRequest(completion, { ...deps, ...options, apply: noWrite, append: noWrite }), /changed|verified match/);
  }
});

test("native failure does not write a journal duplicate and partial success discourages retry", async () => {
  await assert.rejects(applyJournalRequest(capture, { ...deps,
    apply: async () => { throw new Error("comment failed; item abc123 exists"); },
    append: () => assert.fail("Failed creation must not append another TODO") }), /Inspect Logseq before retrying/);
  await assert.rejects(applyJournalRequest(completion, { ...deps, apply: async () => {},
    append: async () => { throw new Error("disk full"); } }), /task completed, but journal entry was not saved.*Do not retry completion/);
});

test("journal rejects invalid action, multiline title, and malformed note before writes", async () => {
  for (const request of [{ ...capture, action: "wrong" }, { ...capture, title: "first\nTODO second" },
    { ...capture, note: "first\nsecond" }, { ...capture, note: "" }]) {
    await assert.rejects(applyJournalRequest(request, { ...deps, apply: () => assert.fail("Invalid input must not apply") }), /Invalid/);
  }
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
  assert.equal(await judgeTaskReport("asked Jade about data quality", openTask, { key: "test-key", fetch: fetchMock }), true);
  assert.equal(await judgeTaskReport("asked Bob about data quality", openTask, { key: "test-key", fetch: async () => reply(0.03) }), false);
  assert.equal(await judgeTaskReport("asked Jade in AnotherProject", openTask, { key: "test-key", fetch: async () => reply(0.95, "different") }), false);
});

test("Jev requires an Alfred-configured key before sending a task decision", async () => {
  await assert.rejects(judgeTaskReport("asked Jade", openTask, { key: "", fetch: () => {
    throw new Error("Jev must not be called without a key");
  } }), /Set the Jev API key in Alfred workflow configuration/);
});
