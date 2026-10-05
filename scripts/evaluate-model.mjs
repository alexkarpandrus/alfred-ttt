// Run with npm run test:model, or set TTT_MODEL_BINARY to another built bin/rephrase executable.
// Synthetic context only: this check does not read or change tracker tasks.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { buildItems, decodeRequest } from "../src/plan.mjs";
import { buildInferenceContext, confirmCompletionWithJev, inferWork, reportsPastWork } from "../src/rephrase.mjs";

const binary = process.env.TTT_MODEL_BINARY;
if (!binary) throw new Error("Set TTT_MODEL_BINARY to the built bin/rephrase executable.");
const tttHome = process.env.TTT_JEV_HOME || join(homedir(), ".local/share/tickettrain");
const tttSource = process.env.TTT_JEV_SOURCE || tttHome;
const execFileAsync = promisify(execFile);
const jevProgram = `
(require '[cheshire.core :as json] '[ttt.inference.typesafe :as jev])
(let [input (json/parse-string (System/getenv "TTT_JEV_INPUT") true)
      result (jev/rerank (:note input) (:candidates input))]
  (println (json/generate-string {:candidates (or (:candidates result) [])})))`;
const projectProgram = `
(require '[cheshire.core :as json] '[ttt.inference.typesafe :as jev])
(let [input (json/parse-string (System/getenv "TTT_JEV_INPUT") true)]
  (println (json/generate-string
            (jev/project-relation (:note input) (:project input)))))`;

async function queryJev(program, input) {
  const { stdout } = await execFileAsync("bb", ["-cp", "src", "-e", program], {
    cwd: tttSource,
    env: { ...process.env, TTT_HOME: tttHome, TTT_JEV_INPUT: JSON.stringify(input) },
    timeout: 15_000,
    maxBuffer: 64 * 1024,
  });
  return JSON.parse(stdout);
}

async function jevCandidates(note, items) {
  return (await queryJev(jevProgram, { note, candidates: items })).candidates;
}

const items = [
  { displayId: "report", title: "Send report to Alice", state: "open" },
  { displayId: "billing", title: "Fix billing retry failures", state: "open" },
  { displayId: "release", title: "Prepare release notes", state: "open" },
  { displayId: "dana", title: "Build indexing project for Dana", state: "open" },
  { displayId: "mamba", title: "Implement Mamba search feature", state: "open" },
];
const report = items[0];
const releaseNotesToAlice = { displayId: "alice-notes", title: "Send release notes to Alice", state: "open" };
const releaseNotesToBob = { displayId: "bob-notes", title: "Send release notes to Bob", state: "open" };
const archiveInMamba = { displayId: "mamba-archive", title: "Archive invoices in Mamba", state: "open" };
const mambaProject = { displayId: "Mamba", title: "Mamba" };
const anacondaProject = { displayId: "Anaconda", title: "Anaconda" };
const archiveInMambaProject = { displayId: "mamba-project-archive", title: "Archive invoices",
  state: "open", project: mambaProject };
const elliott = { displayId: "elliott", title: "Answer Elliott about apo sheet", state: "open" };
const otherElliott = { displayId: "other-elliott", title: "Review invoices with Elliott", state: "open" };
const maryna = { displayId: "maryna", title: "Respond to Maryna", state: "open" };
const otherMaryna = { displayId: "other-maryna", title: "Ask Maryna for project status", state: "open" };
const lee = { displayId: "lee", title: "Build dashboard project for Lee", state: "open" };
const wojtech = { displayId: "wojtech", title: "Add Wojtech to CODEOWNERS", state: "open" };
const cases = [
  ["Where is the billing retry work?", "browse", "billing"],
  ["Find the release notes task", "browse", "release"],
  ["Do we have a task for the report to Alice?", "browse", "report"],
  ["Please fix billing retry failures", "create"],
  ["Create a follow-up to review invoices", "create"],
  ["I sent the report to Alice", "complete", "report"],
  ["The report was sent to Alice", "complete", "report"],
  ["I might have sent the report to Alice", "create"],
  ["I will send the report to Alice", "create"],
  ["I sent the report to Bob", "create", undefined, [report]],
  ["I sent the invoice to Alice", "create", undefined, [report]],
  ["I archived invoices in Anaconda", "create", undefined, [archiveInMamba]],
  ["I archived invoices in Anaconda", "create", undefined, [archiveInMambaProject], [mambaProject, anacondaProject]],
  ["I archived invoices in Anaconda", "create", undefined, [archiveInMambaProject], [mambaProject]],
  ["I archived invoices in Mamba", "complete", "mamba-project-archive", [archiveInMambaProject], [mambaProject, anacondaProject]],
  ["I sent release notes to Bob with Alice", "create", undefined, [releaseNotesToAlice]],
  ["I sent release notes to Bob with Alice", "complete", "bob-notes", [releaseNotesToAlice, releaseNotesToBob]],
  ["answered to elliot", "complete", "elliott", [elliott]],
  ["answer elliott about apo sheet", "create", undefined, [otherElliott]],
  ["respond to Maryna", "create", undefined, [otherMaryna]],
  ["answered maryna", "complete", "maryna", [maryna]],
  ["started working on a project for lee", "active", "lee", [lee]],
  ["woj", "browse", "wojtech", [wojtech]],
  ["I did not send the report to Alice", "create"],
  ["I did not complete the report to Alice", "create"],
  ["I might have completed the report to Alice", "create"],
  ["I will complete the report to Alice", "create"],
  ["started working on a project for Dana", "active", "dana"],
  ["started Mamab search feature", "active", "mamba"],
  ["I will start the Mamba search feature", "create"],
];

for (const [note, expected, id, candidates = items, projects = []] of cases) {
  test(`${note} [${candidates.map((item) => item.displayId).join(", ")}]`, async () => {
    let intent = await inferWork(note, { enabled: true, binary, context: buildInferenceContext(candidates, projects) });
    if (reportsPastWork(note, note)) {
      const matches = await jevCandidates(note, candidates);
      const selected = candidates.find((item) => item.displayId === matches[0]?.displayId);
      const relation = selected?.project
        ? await queryJev(projectProgram, { note, project: selected.project.displayId }) : undefined;
      intent = confirmCompletionWithJev(intent, matches, candidates, relation);
    }
    const choices = buildItems(note, { items: candidates, projects, intent });
    const [first] = choices;
    const request = first.arg && decodeRequest(first.arg);
    const actual = first.autocomplete ? "browse"
      : request?.action === "create_item" ? "create"
        : request?.state === "completed" ? "complete" : request?.state === "active" ? "active" : "capture";
    const completed = choices.filter((choice) => choice.arg)
      .map((choice) => decodeRequest(choice.arg))
      .filter((choice) => choice.state === "completed");
    assert.deepEqual(completed.map((choice) => choice.item), expected === "complete" ? [id] : [],
      "Only a definite matching past report may propose completion");
    const active = choices.filter((choice) => choice.arg)
      .map((choice) => decodeRequest(choice.arg))
      .filter((choice) => choice.action === "update_item" && choice.state === "active");
    assert.deepEqual(active.map((choice) => choice.item), expected === "active" ? [id] : [],
      "Only a related started-work report may mark a task Active");
    assert.equal(actual, expected);
    if (id) assert.equal(first.autocomplete || request?.item, expected === "browse" ? `${id}: ` : id);
  });
}
