import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";
import test from "node:test";

import { firstPass } from "../src/jev.mjs";
import { decodeRequest } from "../src/plan.mjs";
import { cachedRefinement, firstItems, refinementFrame } from "../src/refinement.mjs";

const exec = promisify(execFile);
const note = "add workflow checks for patrol";
const tasks = [
  { displayId: "old", title: "Raise deprecate request for patrol", state: "open" },
  { displayId: "checks", title: "Workflow checks for Patrol", state: "open" },
];
function answers(questions, mode = "lookup") {
  return Object.fromEntries(Object.entries(questions).map(([name, question]) => {
    const choice = name === "intent" ? mode : "candidate-1";
    return [name, { choice, confidence: 1, probabilities: Object.fromEntries(
      Object.keys(question.criteria).map((option) => [option, Number(option === choice)]),
    ) }];
  }));
}

test("Jev ranks candidates in one request without authorizing completion", async () => {
  let calls = 0;
  const result = await firstPass(note, tasks, { key: "test-placeholder", fetch: async (_, request) => {
    calls++;
    const body = JSON.parse(request.body);
    assert.deepEqual(Object.keys(body.questions), ["intent", "match"]);
    assert.equal(body.state.note, note);
    return { ok: true, json: async () => ({ answers: answers(body.questions) }) };
  } });
  assert.equal(calls, 1);
  assert.deepEqual(result.lookupTaskIds, ["checks"]);
  assert.equal(result.items[0].displayId, "checks");
  assert.equal(result.items[0].semanticProbability, undefined);
  assert.equal(result.state, undefined);
  assert.equal(decodeRequest(firstItems(note, result.items, result)[0].arg).action, "create_item");
});

test("Jev rejects malformed and unbounded first-pass decisions", async () => {
  for (const corrupt of [
    (a) => { a.intent.choice = "complete"; },
    (a) => { a.match.probabilities["candidate-1"] = 2; },
    (a) => { a.intent.confidence = null; },
    (a) => { a.match.probabilities.foreign = 1; },
  ]) await assert.rejects(firstPass(note, tasks, { key: "test-placeholder", fetch: async (_, request) => {
    const a = answers(JSON.parse(request.body).questions); corrupt(a);
    return { ok: true, json: async () => ({ answers: a }) };
  } }), /invalid first-pass/);
});

test("first-pass captures preserve both recipients and keep raw actions stable", () => {
  const text = "tell jan and elliott about the maple loans";
  const initial = firstItems(text)[0];
  assert.equal(decodeRequest(initial.arg).title, text);
  assert.match(initial.subtitle, /no inferred metadata/);
  const first = refinementFrame([initial], "job-abcdef", true);
  const later = refinementFrame([initial, ...firstItems(text, tasks)], "job-abcdef", false);
  assert.equal(first.items[0].uid, later.items[0].uid);
  assert.equal(first.items[0].arg, later.items[0].arg);
  assert.equal(later.rerun, undefined);
});

const fakeTracker = `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.TEST_COMMANDS, JSON.stringify(args)+'\\n');
const kind = args[args.indexOf('--kind')+1];
if(args[0] === 'search' && Number(args[args.indexOf('--limit')+1]) > 10) throw new Error('--limit must be between 1 and 10');
const data = args[0] === 'version' ? {capabilities:['create-items','update-items','list-items','search-items','search-projects','search-labels','item-lifecycle']}
 : args[0] === 'status' ? {tracker:{provider:'taskwarrior'}}
 : {candidates:kind === 'item' ? JSON.parse(process.env.TEST_TASKS) : []};
console.log(JSON.stringify({ok:true,data}));
`;
const fakeModel = `#!/usr/bin/env node
import { existsSync, writeFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
writeFileSync(process.env.TEST_MODEL_STARTED, 'started');
while(!existsSync(process.env.TEST_RELEASE)) await setTimeout(10);
console.log(process.env.TEST_MODEL_OUTPUT || JSON.stringify({inputMode:'lookup', title:'Add workflow checks for patrol',
 lookupTaskIds:['old'], priority:'high', priorityPhrase:'high priority'}));
`;
const mockFetch = `import { appendFileSync } from 'node:fs';
globalThis.fetch = async (_, request) => {
 appendFileSync(process.env.TEST_JEV_CALLS, 'called\\n');
 if(process.env.TEST_JEV_FAIL === '1') throw new Error('Unavailable');
 if(process.env.TEST_JEV_HANG === '1') return new Promise((_, reject) => {
  request.signal.addEventListener('abort', () => reject(new Error('Aborted')), {once:true});
 });
 const body = JSON.parse(request.body);
 const answers = Object.fromEntries(Object.entries(body.questions).map(([name, q]) => {
  const choice = name === 'intent' ? 'lookup' : 'candidate-1';
  return [name, {choice,confidence:1,probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,Number(k===choice)]))}];
 }));
 return {ok:true,json:async()=>({answers})};
};
`;
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "alfred-ttt-staged-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await cp(new URL("../src/", import.meta.url), join(directory, "src"), { recursive: true });
  await cp(new URL("../package.json", import.meta.url), join(directory, "package.json"));
  await mkdir(join(directory, "bin"));
  await writeFile(join(directory, "ttt.mjs"), fakeTracker);
  await writeFile(join(directory, "bin/rephrase"), fakeModel);
  await chmod(join(directory, "ttt.mjs"), 0o700);
  await chmod(join(directory, "bin/rephrase"), 0o700);
  await writeFile(join(directory, "mock.mjs"), mockFetch);
  const env = { ...process.env, TTT_BIN: join(directory, "ttt.mjs"), TTT_SEMANTIC: "1", TTT_REPHRASE: "1",
    alfred_workflow_keyword: "ttt", alfred_workflow_cache: join(directory, "cache"), TTT_REFINEMENT_JOB: "",
    TYPESAFE_API_KEY: "test-placeholder", NODE_OPTIONS: `--import=${join(directory, "mock.mjs")}`,
    TEST_TASKS: JSON.stringify(tasks), TEST_COMMANDS: join(directory, "commands"),
    TEST_RELEASE: join(directory, "release"), TEST_MODEL_STARTED: join(directory, "model-started"),
    TEST_JEV_CALLS: join(directory, "jev-calls"), TEST_JEV_FAIL: "0", TEST_JEV_HANG: "0" };
  const filter = async (text, extra = {}) => JSON.parse((await exec(process.execPath,
    [join(directory, "src/filter.mjs"), text], { env: { ...env, ...extra }, timeout: 5000 })).stdout);
  return { directory, env, filter };
}
async function until(check) {
  const deadline = Date.now() + 5000;
  while(Date.now() < deadline) {
    const value = await check();
    if(value) return value;
    await setTimeout(10);
  }
  assert.fail("Background refinement did not reach the expected phase");
}
async function resultFor(env, frame) {
  try { return JSON.parse(await readFile(join(env.alfred_workflow_cache, "staged-ttt",
    frame.variables.TTT_REFINEMENT_JOB, "result.json"), "utf8")); }
  catch(error) { if(error.code === "ENOENT") return undefined; throw error; }
}

test("Create appears before Apple finishes and stays Create after Jev and Apple disagree", async (t) => {
  const { env, filter } = await fixture(t);
  const first = await filter(note);
  assert.equal(first.rerun, 0.1);
  assert.equal(decodeRequest(first.items[0].arg).title, note);
  const jev = await until(async () => (await resultFor(env, first))?.pending);
  assert.equal(jev, true);
  const pending = await filter(note, first.variables);
  assert.equal(decodeRequest(pending.items[0].arg).action, "create_item");
  assert.equal(pending.items[1].autocomplete, "checks: ");
  await writeFile(env.TEST_RELEASE, "ready");
  await until(async () => (await resultFor(env, first))?.pending === false);
  const final = await filter(note, first.variables);
  assert.equal(final.rerun, undefined);
  assert.equal(final.items[0].arg, first.items[0].arg);
  assert.equal(final.items[0].uid, first.items[0].uid);
  assert.ok(final.items.some(item => item.arg && decodeRequest(item.arg).title === "Add workflow checks for patrol"));
  assert.ok(final.items.every(item => !item.arg || decodeRequest(item.arg).state !== "completed"));
  const commands = (await readFile(env.TEST_COMMANDS, "utf8")).trim().split("\n").map(JSON.parse);
  assert.ok(commands.every(args => !args.includes("--semantic")));
  assert.ok(commands.every(args => ["version", "search"].includes(args[0])));
  assert.equal((await readFile(env.TEST_JEV_CALLS, "utf8")).trim().split("\n").length, 1);
  assert.equal((await stat(join(env.alfred_workflow_cache, "staged-ttt"))).mode & 0o777, 0o700);
  assert.equal((await stat(join(env.alfred_workflow_cache, "staged-ttt", first.variables.TTT_REFINEMENT_JOB, "result.json"))).mode & 0o777, 0o600);
  assert.equal(await cachedRefinement("tell jan about loans", { ...env, ...first.variables }), undefined);
  assert.equal(await cachedRefinement(note, { ...env, ...first.variables, TTT_PROFILE: "other" }), undefined);
});

test("Changing the query cancels obsolete refinement and never reuses its result", async (t) => {
  const { env, filter } = await fixture(t);
  const first = await filter(note);
  await until(async () => { try { return await readFile(env.TEST_MODEL_STARTED, "utf8"); } catch { return false; } });
  const state = JSON.parse(await readFile(join(env.alfred_workflow_cache, "staged-ttt", first.variables.TTT_REFINEMENT_JOB, "state.json"), "utf8"));
  const second = await filter("tell jan and elliott about the maple loans", first.variables);
  assert.notEqual(second.variables.TTT_REFINEMENT_JOB, first.variables.TTT_REFINEMENT_JOB);
  assert.match(decodeRequest(second.items[0].arg).title, /jan and elliott.*maple loans/);
  assert.equal(await cachedRefinement(note, { ...env, ...first.variables }), undefined);
  await until(() => { try { process.kill(state.pid, 0); return false; } catch(error) { return error.code === "ESRCH"; } });
  await writeFile(env.TEST_RELEASE, "ready");
  await until(async () => (await resultFor(env, second))?.pending === false);
});

test("Jev failure or delay cannot hold back Apple refinement", async (t) => {
  for(const extra of [{TEST_JEV_FAIL:"1"}, {TEST_JEV_HANG:"1"}]) {
    const { env, filter } = await fixture(t);
    const first = await filter(note, extra);
    await writeFile(env.TEST_RELEASE, "ready");
    await until(async () => (await resultFor(env, first))?.pending === false);
    const final = await filter(note, { ...extra, ...first.variables });
    assert.equal(final.rerun, undefined);
    assert.equal(decodeRequest(final.items[0].arg).action, "create_item");
  }
});


test("Apple refinement preserves explicit priority, due date, tags, and the raw note", async (t) => {
  const { env, filter } = await fixture(t);
  const text = `${note} high priority +ops tomorrow`;
  const first = await filter(text);
  const raw = decodeRequest(first.items[0].arg);
  assert.equal(raw.priority, undefined);
  assert.equal(raw.dueAt, undefined);
  assert.deepEqual(raw.labels, ["ops"]);
  assert.match(first.items[0].subtitle, /add ops/);
  await until(async () => (await resultFor(env, first))?.pending);
  await writeFile(env.TEST_RELEASE, "ready");
  await until(async () => (await resultFor(env, first))?.pending === false);
  const final = await filter(text, first.variables);
  const refined = final.items.filter(item => item.arg).map(item => decodeRequest(item.arg))
    .find(request => request.action === "create_item" && request.priority === "high" && request.dueAt);
  assert.ok(refined);
  assert.deepEqual(refined.labels, ["ops"]);
  assert.equal(refined.comment, text);
  assert.equal(final.items[0].arg, first.items[0].arg);
});

test("Semantic lookup stays read-only when Apple proposes an unrelated target", async (t) => {
  const { env, filter } = await fixture(t);
  const text = "find the check work";
  const first = await filter(text);
  assert.equal(first.items[0].valid, false);
  await until(async () => (await resultFor(env, first))?.pending);
  const matched = await filter(text, first.variables);
  assert.equal(matched.items[0].autocomplete, "checks: ");
  await writeFile(env.TEST_RELEASE, "ready");
  await until(async () => (await resultFor(env, first))?.pending === false);
  const final = await filter(text, first.variables);
  assert.equal(final.items[0].autocomplete, "checks: ");
  assert.equal(final.items[0].uid, matched.items[0].uid);
  assert.ok(final.items.every(item => item.valid === false && !item.arg));
});

test("Completion and journal capture preserve their verification path", async (t) => {
  const { env, filter } = await fixture(t);
  await writeFile(env.TEST_RELEASE, "ready");
  for (const [text, extra] of [
    ["started workflow checks for Patrol", {}],
    ["de34c681: high priority", {}],
    ["adsad", {alfred_workflow_keyword:"ll"}],
    [note, {TTT_SEMANTIC:"0"}],
    [note, {TTT_REPHRASE:"0"}],
  ]) {
    const frame = await filter(text, extra);
    assert.equal(frame.rerun, undefined);
    assert.equal(frame.variables, undefined);
  }
  await assert.rejects(readFile(env.TEST_JEV_CALLS), {code:"ENOENT"});
});

test("Switching to the dashboard cancels pending background inference", async (t) => {
  const { env, filter } = await fixture(t);
  const first = await filter(note);
  await until(async () => { try { return await readFile(env.TEST_MODEL_STARTED, "utf8"); } catch { return false; } });
  const state = JSON.parse(await readFile(join(env.alfred_workflow_cache, "staged-ttt", first.variables.TTT_REFINEMENT_JOB, "state.json"), "utf8"));
  const summary = await filter("s", first.variables);
  assert.equal(summary.rerun, undefined);
  assert.equal(decodeRequest(summary.items[0].arg).action, "show_summary");
  await until(() => { try { process.kill(state.pid, 0); return false; } catch(error) { return error.code === "ESRCH"; } });
});


test("Jev can still find work when Apple Intelligence is unavailable", async (t) => {
  const { env, filter } = await fixture(t);
  await writeFile(env.TEST_RELEASE, "ready");
  const text = "find the check work";
  const first = await filter(text, { TEST_MODEL_OUTPUT: "{}" });
  await until(async () => (await resultFor(env, first))?.pending === false);
  const final = await filter(text, { ...first.variables, TEST_MODEL_OUTPUT: "{}" });
  assert.equal(final.items[0].autocomplete, "checks: ");
  assert.equal(final.items[0].valid, false);
  assert.equal(final.rerun, undefined);
});


test("An unresolved lookup cannot become a mutation when both models are unavailable", async (t) => {
  const { env, filter } = await fixture(t);
  await writeFile(env.TEST_RELEASE, "ready");
  const text = "find the check work";
  const options = { TEST_MODEL_OUTPUT: "{}", TEST_JEV_FAIL: "1" };
  const first = await filter(text, options);
  await until(async () => (await resultFor(env, first))?.pending === false);
  const final = await filter(text, { ...first.variables, ...options });
  assert.equal(final.rerun, undefined);
  assert.ok(final.items.every(item => item.valid === false && !item.arg));
  assert.match(final.items[0].subtitle, /AI matching unavailable/);
});


test("A semantic miss reports no query match rather than an empty tracker", () => {
  const text = "find a deployment";
  const [item] = firstItems(text, tasks, { inputMode: "lookup", lookupTaskIds: [] });
  assert.equal(item.title, `No tasks match “${text}”`);
  assert.equal(item.valid, false);
  assert.equal(item.arg, undefined);
});
