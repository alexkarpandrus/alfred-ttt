import { watch } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { firstPass } from "./jev.mjs";
import { buildItems } from "./plan.mjs";
import { firstItems } from "./refinement.mjs";
import { buildInferenceContext, inferWork, isCaptureRequest } from "./rephrase.mjs";

let directory;
let watcher;
const abort = new AbortController();
const deadline = setTimeout(() => abort.abort(), 12_000);
deadline.unref();
async function publish(items, pending) {
  const temporary = join(directory, "result.tmp");
  await writeFile(temporary, JSON.stringify({ items, pending }), { mode: 0o600 });
  await rename(temporary, join(directory, "result.json"));
}

try {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const job = JSON.parse(input);
  directory = job.directory;
  // The immutable state file is removed when this query becomes obsolete.
  watcher = watch(join(directory, "state.json"), { persistent: false }, () => abort.abort());
  const context = buildInferenceContext(job.items, job.projects, job.labels);
  const apple = inferWork(job.text, { enabled: true, context, signal: abort.signal })
    .then((intent) => ({ source: "apple", intent }));
  const jev = firstPass(job.text, job.items, { signal: abort.signal })
    .then((intent) => ({ source: "jev", intent }), () => ({ source: "unavailable" }));
  let first = await Promise.race([apple, jev]);
  if (first.source === "apple" && !Object.keys(first.intent).length) first = await jev;
  let initial = firstItems(job.text);
  let ranked = job.items.slice(0, 5);
  if (first.source === "jev") {
    ranked = first.intent.items;
    initial = firstItems(job.text, ranked, first.intent);
    await publish(initial, true);
  }
  const { intent } = first.source === "apple" ? first : await apple;
  if (first.source === "jev") {
    if (isCaptureRequest(job.text)) intent.inputMode = "capture";
    else if (first.intent.inputMode === "lookup") {
      intent.inputMode = "lookup";
      // Refinement cannot replace Jev's selected target with an unrelated task.
      intent.lookupTaskIds = first.intent.lookupTaskIds;
    }
  }
  const refined = Object.keys(intent).length || first.source === "jev"
    ? buildItems(job.text, { items: ranked, projects: job.projects, intent })
    : firstItems(job.text).map((item) => ({ ...item,
      subtitle: `${item.subtitle} · AI matching unavailable`,
    }));
  const items = isCaptureRequest(job.text)
    ? [initial[0], ...refined.filter((item) => item.arg !== initial[0].arg), ...initial.slice(1)]
    : refined;
  await publish(items, false);
} catch (error) {
  if (directory && error.code !== "ENOENT") {
    try {
      const state = JSON.parse(await readFile(join(directory, "state.json"), "utf8"));
      await publish(state.items.map((item) => ({ ...item,
        subtitle: `${item.subtitle} · AI refinement unavailable`,
      })), false);
    } catch (fallbackError) {
      if (fallbackError.code !== "ENOENT") process.exitCode = 1;
    }
  }
} finally {
  abort.abort();
  clearTimeout(deadline);
  watcher?.close();
}
