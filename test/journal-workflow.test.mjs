import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const ROOT = new URL("..", import.meta.url).pathname;

test("Alfred ll creates only the Taskwarrior half and a plain Logseq journal block", async () => {
  const directory = await mkdtemp(join(tmpdir(), "alfred-ll-integration-"));
  const graph = join(directory, "graph");
  const binary = join(directory, "ttt");
  const log = join(directory, "ttt.log");
  try {
    await mkdir(join(graph, "logseq"), { recursive: true });
    await mkdir(join(graph, "journals"));
    await writeFile(join(graph, "logseq", "config.edn"), "{}\n");
    await writeFile(binary, `#!/usr/bin/env node
const {appendFileSync,readFileSync}=require('node:fs');
const args=process.argv.slice(2);
const at=args.indexOf('--request-file');
const request=at<0?null:JSON.parse(readFileSync(args[at+1],'utf8'));
appendFileSync(process.env.FAKE_TTT_LOG,JSON.stringify({args,request})+'\\n');
let data={};
if(args[0]==='status')data={tracker:{provider:'taskwarrior'}};
if(args[0]==='search')data={candidates:[]};
if(args[0]==='version')data={capabilities:['create-items','update-items','list-items','search-items','search-projects','search-labels','item-lifecycle']};
if(args[0]==='preview')data={proposalId:'lp2_test'};
process.stdout.write(JSON.stringify({ok:true,data}));
`);
    await chmod(binary, 0o700);
    const env = { ...process.env, TTT_BIN: binary, FAKE_TTT_LOG: log,
      LOGSEQ_GRAPH: graph, alfred_workflow_keyword: "ll", TYPESAFE_API_KEY: "" };
    const filter = (note) => JSON.parse(execFileSync(process.execPath,
      [join(ROOT, "src/filter.mjs"), note], { env, encoding: "utf8" })).items;
    const apply = (arg) => execFileSync(process.execPath,
      [join(ROOT, "src/apply.mjs"), arg], { env, encoding: "utf8" });

    const [todo] = filter("TODO ask teammate about data quality #sadsad");
    assert.match(todo.title, /Create Taskwarrior/);
    assert.match(apply(todo.arg), /created Taskwarrior/);
    const [note] = filter("Captured an ordinary observation #sadsad");
    assert.match(apply(note.arg), /no task changed/);

    const files = await (await import("node:fs/promises")).readdir(join(graph, "journals"));
    assert.equal(files.length, 1);
    const journal = await readFile(join(graph, "journals", files[0]), "utf8");
    assert.match(journal, /- \d\d:\d\d TODO ask teammate about data quality #sadsad\n/);
    assert.match(journal, /- \d\d:\d\d Captured an ordinary observation #sadsad\n/);
    assert.doesNotMatch(journal, /^- TODO /m);
    const calls = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(calls.filter((call) => ["preview", "apply"].includes(call.args[0]))
      .map((call) => call.request), [
        { action: "create_item", title: "ask teammate about data quality #sadsad",
          comment: "TODO ask teammate about data quality #sadsad", labels: ["sadsad"] },
        { action: "create_item", title: "ask teammate about data quality #sadsad",
          comment: "TODO ask teammate about data quality #sadsad", labels: ["sadsad"] },
      ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
