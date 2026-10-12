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
  requireLogseq,
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
if (args[0] === "apply" && process.env.TTT_FAKE_PARTIAL === "1") {
  console.log(JSON.stringify({ok:false,error:{message:"comment failed",partialResult:{item:{displayId:"abc123"}}}}));
  process.exit(1);
}
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

test("ttt wrapper requires an explicit Logseq profile and refuses Taskwarrior for ll", async () => {
  const fake = await fakeTtt();
  try {
    const options = { binary: fake.binary, profile: "journal", env: { ...fake.env, TTT_FAKE_TRACKER: "logseq" } };
    assert.equal(await requireLogseq(options), "journal");
    await assert.rejects(requireLogseq({ ...options, profile: "", env: { ...options.env, LOGSEQ_PROFILE: "" } }), /Set LOGSEQ_PROFILE/);
    await assert.rejects(requireLogseq({ ...options, env: { ...options.env, TTT_FAKE_TRACKER: "taskwarrior" } }), /Logseq file-graph/);
    const calls = (await readFile(fake.log, "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(calls[0].args, ["status", "--profile", "journal"]);
  } finally {
    await rm(fake.directory, { recursive: true, force: true });
  }
});


test("ttt retains the item identity when an apply fails after creation", async () => {
  const fake = await fakeTtt();
  try {
    await assert.rejects(previewAndApply({ action: "create_item", title: "Ask Jade" }, {
      binary: fake.binary, profile: "journal", env: { ...fake.env, TTT_FAKE_PARTIAL: "1" },
    }), /comment failed.*Item abc123 may already have changed.*inspect it before retrying/);
  } finally { await rm(fake.directory, { recursive: true, force: true }); }
});
