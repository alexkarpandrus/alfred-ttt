import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildItems, buildListItems } from "./plan.mjs";
import { isCaptureRequest } from "./rephrase.mjs";

const JOB_NAME = /^job-[a-zA-Z0-9]{6}$/;

export function refinementKey(text, env = process.env) {
  return createHash("sha256").update(JSON.stringify([
    text, env.TTT_PROFILE || "own", env.TTT_BIN || "ttt", env.TTT_REPHRASE, env.TTT_SEMANTIC,
    env.alfred_workflow_keyword || "ttt",
  ])).digest("hex");
}

export function firstItems(text, items = [], intent) {
  if (isCaptureRequest(text)) {
    const raw = buildItems(text)[0];
    raw.subtitle = "as written · no inferred metadata · Return to create";
    return [raw, ...buildListItems(items).filter((item) => item.autocomplete)];
  }
  if (intent?.inputMode === "lookup") {
    const matches = items.filter((item) => intent.lookupTaskIds.includes(item.displayId));
    return buildListItems(matches, matches.length ? "" : text);
  }
  return [{ title: "Interpreting tracked work…", subtitle: "Apple refinement pending · no task changes", valid: false }];
}

export function refinementFrame(items, job, pending) {
  return {
    items: items.map((item) => ({ ...item,
      uid: createHash("sha256").update(item.autocomplete || item.arg || item.title).digest("hex"),
    })),
    variables: { TTT_REFINEMENT_JOB: job },
    ...(pending ? { rerun: 0.1 } : {}), // Alfred's minimum supported refresh interval.
  };
}

async function optionalJson(path) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
}

export async function discardObsoleteRefinement(text, env = process.env) {
  if (!env.alfred_workflow_cache || !JOB_NAME.test(env.TTT_REFINEMENT_JOB || "")) return;
  const root = join(env.alfred_workflow_cache, "staged-ttt");
  const active = await optionalJson(join(root, "active.json"));
  if (active?.job !== env.TTT_REFINEMENT_JOB) return;
  const directory = join(root, active.job);
  const state = await optionalJson(join(directory, "state.json"));
  if (state && state.key !== refinementKey(text, env))
    await rm(directory, { recursive: true, force: true });
}

export async function cachedRefinement(text, env = process.env) {
  const job = env.TTT_REFINEMENT_JOB;
  if (!JOB_NAME.test(job || "")) return undefined;
  const root = join(env.alfred_workflow_cache, "staged-ttt");
  const active = await optionalJson(join(root, "active.json"));
  if (active?.job !== job) return undefined;
  const directory = join(root, job);
  const state = await optionalJson(join(directory, "state.json"));
  if (state?.key !== refinementKey(text, env)) return undefined;
  const result = await optionalJson(join(directory, "result.json"));
  if (result && !result.pending) return refinementFrame(result.items, job, false);
  let running = true;
  try { process.kill(state.pid, 0); }
  catch (error) { if (error.code !== "ESRCH") throw error; running = false; }
  const items = result?.items || state.items;
  return refinementFrame(running ? items : items.map((item) => ({ ...item,
    subtitle: `${item.subtitle} · Apple refinement unavailable`,
  })), job, running);
}

export async function startRefinement(text, items, projects, labels, env = process.env) {
  const root = join(env.alfred_workflow_cache, "staged-ttt");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const active = await optionalJson(join(root, "active.json"));
  if (JOB_NAME.test(active?.job || ""))
    await rm(join(root, active.job), { recursive: true, force: true });
  const directory = await mkdtemp(join(root, "job-"));
  const job = basename(directory);
  const pointer = join(directory, "active.tmp");
  await writeFile(pointer, JSON.stringify({ job }), { mode: 0o600 });
  await rename(pointer, join(root, "active.json"));
  const initial = firstItems(text);
  const child = spawn(process.execPath, [fileURLToPath(new URL("./refine.mjs", import.meta.url))], {
    env, detached: true, stdio: ["pipe", "ignore", "ignore"],
  });
  await once(child, "spawn");
  child.stdin.on("error", () => {}); // A canceled worker may close the pipe before consuming its input.
  try {
    await writeFile(join(directory, "state.json"), JSON.stringify({
      key: refinementKey(text, env), items: initial, pid: child.pid,
    }), { mode: 0o600 });
    child.stdin.end(JSON.stringify({ directory, text, items, projects, labels }));
  } catch (error) {
    child.stdin.end();
    throw error;
  } finally {
    child.unref();
  }
  return refinementFrame(initial, job, true);
}
