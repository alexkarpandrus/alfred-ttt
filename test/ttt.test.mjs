import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  listItems,
  previewAndApply,
  checkProject,
  requireStandaloneActions,
  requireTaskwarrior,
  search,
} from "../src/ttt.mjs";

async function fakeTtt() {
  const directory = await mkdtemp(join(tmpdir(), "alfred-ttt-test-"));
  const binary = join(directory, "ttt");
  const log = join(directory, "calls.log");
  await writeFile(
    binary,
    `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
const requestIndex = args.indexOf("--request-file");
const request = requestIndex < 0 ? null : JSON.parse(readFileSync(args[requestIndex + 1], "utf8"));
appendFileSync(process.env.TTT_FAKE_LOG, JSON.stringify({ args, request }) + "\\n");
let data;
if (args[0] === "version") data = { capabilities: ["create-items", "update-items", "list-items", "search-items", "search-projects", "search-labels", "item-lifecycle"] };
else if (args[0] === "status") data = { tracker: { provider: process.env.TTT_FAKE_TRACKER || "taskwarrior" } };
else if (args[0] === "list") data = { items: [{ displayId: "abc123", title: "Ask Jade", state: "open" }] };
else if (args[0] === "search") data = { candidates: [{ displayId: "abc123", title: "Ask Jade" }] };
else if (args[0] === "check-project") data = { relation: "different", confidence: 0.85 };
else if (args[0] === "preview") data = { proposalId: "lp2_test" };
else if (args[0] === "apply") data = { item: { displayId: "abc123" } };
process.stdout.write(JSON.stringify({ schemaVersion: 2, ok: true, data }));
`,
  );
  await chmod(binary, 0o700);
  return { directory, binary, log, env: { ...process.env, TTT_FAKE_LOG: log } };
}

test("ttt wrapper lists, searches, and applies the exact previewed request", async () => {
  const fake = await fakeTtt();
  const options = { binary: fake.binary, env: fake.env, profile: "own" };
  const request = {
    action: "update_item",
    item: "abc123",
    comment: "Jade replied, so this is done.",
    state: "completed",
  };

  try {
    await requireStandaloneActions(options);
    const listed = await listItems({ ...options, state: "open" });
    const candidates = await search("item", "Jade", {
      ...options,
      semantic: true,
    });
    const result = await previewAndApply(request, options);
    const calls = (await readFile(fake.log, "utf8"))
      .trim()
      .split("\n")
      .map(JSON.parse);

    assert.equal(listed[0].state, "open");
    assert.equal(candidates[0].displayId, "abc123");
    assert.equal(result.item.displayId, "abc123");
    assert.ok(calls[1].args.includes("--state"));
    assert.deepEqual(calls[3].request, request);
    assert.deepEqual(calls[4].request, request);
    assert.ok(calls[4].args.includes("lp2_test"));
  } finally {
    await rm(fake.directory, { recursive: true, force: true });
  }
});


test("ttt wrapper asks for a read-only project comparison", async () => {
  const fake = await fakeTtt();
  try {
    const answer = await checkProject("I archived invoices in Anaconda", "Mamba", {
      binary: fake.binary, env: fake.env,
    });
    assert.deepEqual(answer, { relation: "different", confidence: 0.85 });
    const [call] = (await readFile(fake.log, "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(call.args, ["check-project", "--note", "I archived invoices in Anaconda",
      "--project", "Mamba"]);
  } finally {
    await rm(fake.directory, { recursive: true, force: true });
  }
});

test("ttt wrapper refuses a non-Taskwarrior profile for journal tasks", async () => {
  const fake = await fakeTtt();
  try {
    assert.equal(await requireTaskwarrior({ binary: fake.binary, env: fake.env }), "own");
    await assert.rejects(requireTaskwarrior({ binary: fake.binary,
      env: { ...fake.env, TTT_FAKE_TRACKER: "github-issues" } }), /must use Taskwarrior/);
  } finally {
    await rm(fake.directory, { recursive: true, force: true });
  }
});
