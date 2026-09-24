// Run explicitly with TTT_MODEL_BINARY set to the built bin/rephrase executable.
// Synthetic context only: this check does not read or change tracker tasks.
import assert from "node:assert/strict";
import test from "node:test";

import { buildItems, decodeRequest } from "../src/plan.mjs";
import { buildInferenceContext, inferWork } from "../src/rephrase.mjs";

const binary = process.env.TTT_MODEL_BINARY;
if (!binary) throw new Error("Set TTT_MODEL_BINARY to the built bin/rephrase executable.");

const items = [
  { displayId: "report", title: "Send report to Alice", state: "open" },
  { displayId: "billing", title: "Fix billing retry failures", state: "open" },
  { displayId: "release", title: "Prepare release notes", state: "open" },
  { displayId: "dana", title: "Build indexing project for Dana", state: "open" },
  { displayId: "mamba", title: "Implement Mamba search feature", state: "open" },
];
const context = buildInferenceContext(items);
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
  ["I sent the report to Bob", "create"],
  ["I did not send the report to Alice", "create"],
  ["I did not complete the report to Alice", "create"],
  ["I might have completed the report to Alice", "create"],
  ["I will complete the report to Alice", "create"],
  ["started working on a project for Dana", "active", "dana"],
  ["started Mamab search feature", "active", "mamba"],
  ["I will start the Mamba search feature", "create"],
];

for (const [note, expected, id] of cases) {
  test(note, async () => {
    const intent = await inferWork(note, { enabled: true, binary, context });
    const choices = buildItems(note, { items, intent });
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
