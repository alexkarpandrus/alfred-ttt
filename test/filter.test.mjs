import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { decodeRequest } from "../src/plan.mjs";

const execFileAsync = promisify(execFile);
const note = "I sent release notes to Bob with Alice";
const alice = { displayId: "alice", title: "Send release notes to Alice", state: "open" };
const bob = { displayId: "bob", title: "Send release notes to Bob", state: "open" };

// The fake ttt preserves the real search envelope, including the unscored lexical fallback.
const fakeTtt = `#!/usr/bin/env node
const args = process.argv.slice(2);
let data;
if (args[0] === "version") data = { capabilities: ["create-items", "update-items", "list-items", "search-items", "search-projects", "search-labels", "item-lifecycle"] };
else if (args[0] === "check-project") data = { relation: process.env.FAKE_PROJECT_RELATION || "unspecified", confidence: 0.85 };
else if (args[0] === "search") {
  if (args.includes("--semantic") && process.env.FAKE_JEV_ERROR === "1") {
    console.log(JSON.stringify({ schemaVersion: 2, ok: false, error: { message: "Jev unavailable" } }));
    process.exit(0);
  }
  const kind = args[args.indexOf("--kind") + 1];
  data = { candidates: kind === "project" ? JSON.parse(process.env.FAKE_JEV_PROJECTS || "[]")
    : kind === "item" ? JSON.parse(process.env[args.includes("--semantic") ? "FAKE_JEV_TASKS" : "FAKE_TASKS"])
      : [] };
}
console.log(JSON.stringify({ schemaVersion: 2, ok: true, data }));
`;
const fakeModel = `#!/usr/bin/env node
const note = process.argv[2];
console.log(JSON.stringify({ inputMode: "capture", state: "completed", statePhrase: note,
  completedTaskIds: process.env.FAKE_MODEL_MISSES === "1" ? [] : ["alice"] }));
`;

test("Alfred checks the model's completion target with Jev before offering Complete", async () => {
  const directory = await mkdtemp(join(tmpdir(), "alfred-ttt-filter-"));
  try {
    await cp(new URL("../src/", import.meta.url), join(directory, "src"), { recursive: true });
    await mkdir(join(directory, "bin"));
    const ttt = join(directory, "ttt");
    const model = join(directory, "bin/rephrase");
    await writeFile(ttt, fakeTtt);
    await writeFile(model, fakeModel);
    await chmod(ttt, 0o700);
    await chmod(model, 0o700);

    for (const [tasks, jevTasks, semantic, expected] of [
      [[alice], [alice], "0", undefined], // Jev returned "none"; ttt fell back to unscored lexical results.
      [[alice, bob], [{ ...bob, semanticProbability: 0.71 }, { ...alice, semanticProbability: 0.05 }], "0", undefined],
      [[alice, bob], [{ ...bob, semanticProbability: 0.71 }, { ...alice, semanticProbability: 0.05 }], "1", "bob"],
    ]) {
      const { stdout } = await execFileAsync(process.execPath, [join(directory, "src/filter.mjs"), note], {
        env: { ...process.env, TTT_BIN: ttt, TTT_SEMANTIC: semantic,
          alfred_workflow_cache: join(directory, "cache"),
          FAKE_TASKS: JSON.stringify(tasks), FAKE_JEV_TASKS: JSON.stringify(jevTasks) },
      });
      const choices = JSON.parse(stdout).items;
      const completions = choices.filter((choice) => choice.arg).map((choice) => decodeRequest(choice.arg))
        .filter((request) => request.state === "completed");
      assert.deepEqual(completions.map((request) => request.item), expected ? [expected] : []);
      if (expected) {
        assert.match(choices[0].title, /^✅ Complete: Send release notes to Bob/);
        assert.equal(completions[0].comment, note);
      }
    }
    const recovered = await execFileAsync(process.execPath, [join(directory, "src/filter.mjs"), note], {
      env: { ...process.env, TTT_BIN: ttt, TTT_SEMANTIC: "1", FAKE_MODEL_MISSES: "1",
        FAKE_TASKS: JSON.stringify([alice, bob]),
        FAKE_JEV_TASKS: JSON.stringify([{ ...bob, semanticProbability: 0.68 }]) },
    });
    assert.equal(decodeRequest(JSON.parse(recovered.stdout).items[0].arg).item, "bob");

    const archive = { displayId: "archive", title: "Archive invoices", state: "open",
      project: { displayId: "Mamba" } };
    const conflicting = await execFileAsync(process.execPath,
      [join(directory, "src/filter.mjs"), "I archived invoices in Anaconda"], {
        env: { ...process.env, TTT_BIN: ttt, TTT_SEMANTIC: "1", FAKE_TASKS: JSON.stringify([archive]),
          FAKE_JEV_TASKS: JSON.stringify([{ ...archive, semanticProbability: 0.88 }]),
          FAKE_PROJECT_RELATION: "different" },
      });
    assert.ok(JSON.parse(conflicting.stdout).items.every((choice) => !choice.title.startsWith("✅ Complete:")));

    const { stdout } = await execFileAsync(process.execPath, [join(directory, "src/filter.mjs"), note], {
      env: { ...process.env, TTT_BIN: ttt, TTT_SEMANTIC: "0", FAKE_JEV_ERROR: "1",
        FAKE_TASKS: JSON.stringify([alice]), FAKE_JEV_TASKS: "[]" },
    });
    assert.ok(JSON.parse(stdout).items.every((choice) => !choice.title.startsWith("✅ Complete:")));

    const taggedNote = "ask Jade about data quality #sadsad";
    const tagged = await execFileAsync(process.execPath,
      [join(directory, "src/filter.mjs"), taggedNote], {
        env: { ...process.env, alfred_workflow_keyword: "ttt", TTT_BIN: ttt,
          TTT_REPHRASE: "0", TTT_SEMANTIC: "0", FAKE_TASKS: "[]", FAKE_JEV_TASKS: "[]" },
      });
    const taggedRequest = decodeRequest(JSON.parse(tagged.stdout).items[0].arg);
    assert.equal(taggedRequest.action, "create_item");
    assert.deepEqual(taggedRequest.labels, ["sadsad"]);
    assert.equal(taggedRequest.comment, taggedNote);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
