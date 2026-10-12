import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const ROOT = new URL("..", import.meta.url).pathname;

test("Alfred ll creates a native TODO without Taskwarrior or a duplicate plain TODO", async () => {
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
const {join}=require('node:path');
const args=process.argv.slice(2);
const at=args.indexOf('--request-file');
const request=at<0?null:JSON.parse(readFileSync(args[at+1],'utf8'));
appendFileSync(process.env.FAKE_TTT_LOG,JSON.stringify({args,request})+'\\n');
let data={};
if(args[0]==='status')data={tracker:{provider:'logseq'}};
if(args[0]==='search')data={candidates:[]};
if(args[0]==='version')data={capabilities:['create-items','update-items','list-items','search-items','search-projects','search-labels','item-lifecycle']};
if(args[0]==='preview')data={proposalId:'lp2_test'};
if(args[0]==='apply') {
 const d=new Date(),pad=n=>String(n).padStart(2,'0');
 const file=join(process.env.LOGSEQ_GRAPH,'journals',d.getFullYear()+'_'+pad(d.getMonth()+1)+'_'+pad(d.getDate())+'.md');
 appendFileSync(file,'- TODO '+request.title+'\\n  id:: 00000000-0000-0000-0000-000000000001\\n  - > '+request.comment+'\\n');
 data={item:{displayId:'00000000-0000-0000-0000-000000000001'}};
}
process.stdout.write(JSON.stringify({ok:true,data}));
`);
    await chmod(binary, 0o700);
    const env = { ...process.env, TTT_BIN: binary, TTT_PROFILE: "own", LOGSEQ_PROFILE: "journal", FAKE_TTT_LOG: log,
      LOGSEQ_GRAPH: graph, alfred_workflow_keyword: "ll", TYPESAFE_API_KEY: "" };
    const filter = (note) => JSON.parse(execFileSync(process.execPath,
      [join(ROOT, "src/filter.mjs"), note], { env, encoding: "utf8" })).items;
    const apply = (arg) => execFileSync(process.execPath,
      [join(ROOT, "src/apply.mjs"), arg], { env, encoding: "utf8" });

    const [todo] = filter("TODO ask teammate about data quality #sadsad");
    assert.match(todo.title, /Create Logseq TODO/);
    assert.deepEqual(await readdir(join(graph, "journals")), [], "Suggestions must not write");
    assert.match(apply(todo.arg), /Created Logseq TODO/);
    const [note] = filter("Captured an ordinary observation #sadsad");
    assert.match(apply(note.arg), /no task changed/);

    const files = await readdir(join(graph, "journals"));
    assert.equal(files.length, 1);
    const journal = await readFile(join(graph, "journals", files[0]), "utf8");
    assert.equal(journal.match(/^- TODO /gm).length, 1);
    assert.match(journal, /- TODO ask teammate about data quality #sadsad\n/);
    assert.match(journal, /  - > TODO ask teammate about data quality #sadsad\n/);
    assert.match(journal, /- \d\d:\d\d Captured an ordinary observation #sadsad\n/);
    assert.doesNotMatch(journal, /- \d\d:\d\d TODO /);
    const calls = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
    const changes = calls.filter(call => ["preview", "apply"].includes(call.args[0]));
    assert.equal(changes.length, 2);
    assert.deepEqual(changes[0].request, changes[1].request);
    assert.deepEqual(changes[0].request, { action: "create_item", title: "ask teammate about data quality #sadsad",
      comment: "TODO ask teammate about data quality #sadsad" });
    assert.ok(calls.filter(call => call.args.includes("--profile")).every(call => call.args[call.args.indexOf("--profile")+1] === "journal"));
    assert.ok(changes[1].args.includes("lp2_test"));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
