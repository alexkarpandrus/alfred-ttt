import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { applyJournalRequest, journalSuggestions } from "../src/journal-flow.mjs";
import { decodeRequest } from "../src/plan.mjs";
import { search } from "../src/ttt.mjs";

const exec = promisify(execFile);
const home = process.env.TTT_LOGSEQ_TEST_HOME;
assert.ok(home, "Set TTT_LOGSEQ_TEST_HOME to a clean ttt v0.13+ checkout.");

test("released ttt creates one native TODO, completes it, and rejects a switched graph", async () => {
  const directory = await mkdtemp(resolve("dist/logseq-sdk-"));
  const graph = join(directory, "graph");
  const pages = [], blocks = new Map(), methods = [];
  let currentGraph = graph;
  let rejectComments = false;
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.headers.authorization, "Bearer fixture-token");
      let raw = ""; for await (const chunk of request) raw += chunk;
      const { method, args } = JSON.parse(raw); methods.push(method);
      let result;
      switch (method) {
        case "logseq.App.getCurrentGraph": result = { path: currentGraph }; break;
        case "logseq.Editor.getAllPages": result = pages; break;
        case "logseq.DB.datascriptQuery": result = pages.filter(p => [...blocks.values()].some(b => b.page.id === p.id)).map(p => [p.uuid]); break;
        case "logseq.Editor.createPage": {
          const page = { id: pages.length + 1, uuid: randomUUID(), name: args[0], originalName: args[0], "journal?": true,
            journalDay: Number(args[0].replaceAll("-", "")) };
          pages.push(page); result = page; break;
        }
        case "logseq.Editor.getPage": result = pages.find(p => p.id === args[0] || p.uuid === args[0]); break;
        case "logseq.Editor.getPageBlocksTree": result = [...blocks.values()].filter(b => b.page.id === pages.find(p => p.uuid === args[0])?.id); break;
        case "logseq.Editor.getBlock": result = blocks.get(args[0]) || null; break;
        case "logseq.Editor.appendBlockInPage": {
          const page = pages.find(p => p.uuid === args[0]);
          result = { uuid: args[2].properties.id, content: args[1], page: { id: page.id }, children: [] };
          blocks.set(result.uuid, result); break;
        }
        case "logseq.Editor.updateBlock": blocks.get(args[0]).content = args[1]; result = null; break;
        case "logseq.Editor.insertBlock": {
          if (rejectComments) throw new Error("Fixture comment failure");
          result = { uuid: randomUUID(), content: args[1], children: [] };
          blocks.get(args[0]).children.push(result); break;
        }
        default: throw new Error(`Unexpected SDK method: ${method}`);
      }
      response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify(result));
    } catch (error) { response.writeHead(500); response.end(JSON.stringify({ error: error.message })); }
  });
  try {
    await mkdir(join(graph, "logseq"), { recursive: true }); await mkdir(join(graph, "journals"));
    await writeFile(join(graph, "logseq/config.edn"), "{}\n");
    await new Promise(done => server.listen(0, "127.0.0.1", done));
    const config = join(directory, "ttt.edn");
    await writeFile(config, '{:default-profile :journal :profiles {:journal {:tracker {:provider :logseq}}}}');
    const binary = join(directory, "ttt");
    await writeFile(binary, `#!/bin/sh\nexec "${resolve(home, "bin/ttt")}" "$@" --config "${config}"\n`);
    await chmod(binary, 0o700);
    const env = { ...process.env, TTT_BIN: binary, TTT_PROFILE: "own", LOGSEQ_PROFILE: "journal", LOGSEQ_GRAPH: graph,
      LOGSEQ_TOKEN: "fixture-token", LOGSEQ_BASE_URL: `http://127.0.0.1:${server.address().port}`, TYPESAFE_API_KEY: "" };
    const options = { env, binary, profile: "journal" };
    const root = new URL("../", import.meta.url).pathname;
    const filter = async note => JSON.parse((await exec(process.execPath, [join(root, "src/filter.mjs"), note], {
      env: { ...env, alfred_workflow_keyword: "ll", TTT_REFINEMENT_JOB: "" }, timeout: 10000 })).stdout);
    const apply = async arg => (await exec(process.execPath, [join(root, "src/apply.mjs"), arg], { env, timeout: 10000 })).stdout;

    const note = "TODO ask fixture teammate #test-tag";
    const { items: [item] } = await filter(note);
    assert.equal(blocks.size, 0); assert.equal(pages.length, 0);
    assert.match(await apply(item.arg), /Created Logseq TODO/);
    assert.equal(blocks.size, 1);
    const [block] = blocks.values();
    assert.equal(block.content, "TODO ask fixture teammate #test-tag");
    assert.equal(block.children[0].content, `> ${note}`);
    assert.deepEqual(await readdir(join(graph, "journals")), [], "Native creation must not also append a plain TODO");

    const [task] = await search("item", block.uuid, options);
    assert.equal(task.state, "open");
    const report = "asked fixture teammate #test-tag";
    const [done] = await journalSuggestions(report, { ...options,
      search: async () => [{ ...task, semanticProbability: .99 }], judge: async () => true });
    await applyJournalRequest(decodeRequest(done.arg), { ...options, judge: async () => true });
    assert.equal(block.content, "DONE ask fixture teammate #test-tag");
    assert.equal(block.children[1].content, report);
    const [journal] = await readdir(join(graph, "journals"));
    assert.match(await readFile(join(graph, "journals", journal), "utf8"), /- \d\d:\d\d asked fixture teammate #test-tag/);

    rejectComments = true;
    const partial = await apply(item.arg);
    assert.match(partial, /Item [0-9a-f-]+ may already have changed.*inspect it before retrying/);
    assert.equal(blocks.size, 2, "Comment failure can leave the newly created task behind");
    assert.equal((await readdir(join(graph, "journals"))).length, 1);
    rejectComments = false;

    currentGraph = join(directory, "other-graph");
    const count = blocks.size;
    assert.match(await apply(item.arg), /configured Logseq graph|not confirmed/);
    assert.equal(blocks.size, count);
    assert.ok(methods.includes("logseq.Editor.updateBlock"));
    assert.ok(methods.includes("logseq.Editor.appendBlockInPage"));
  } finally {
    await new Promise(done => server.close(done));
    await rm(directory, { recursive: true, force: true });
  }
});
