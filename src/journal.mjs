import { open, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export async function appendJournalNote(note, options = {}) {
  if (!note.trim() || /[\r\n]/.test(note))
    throw new Error("Journal entries must be one nonempty line.");

  const configured = options.graph || process.env.LOGSEQ_GRAPH || join(homedir(), "logseq");
  const graph = resolve(configured.startsWith("~/") ? join(homedir(), configured.slice(2)) : configured);
  try {
    await stat(join(graph, "logseq", "config.edn"));
    const journals = await stat(join(graph, "journals"));
    if (!journals.isDirectory()) throw new Error("Missing journals directory.");
  } catch {
    throw new Error(`Logseq graph not found at ${graph}. Set LOGSEQ_GRAPH to your graph directory.`);
  }

  const now = options.now || new Date();
  const pad = (value) => String(value).padStart(2, "0");
  // ponytail: The configured graph uses default journal filenames; check its format before supporting other graphs.
  const date = `${now.getFullYear()}_${pad(now.getMonth() + 1)}_${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const file = await open(join(graph, "journals", `${date}.md`), "a+");
  try {
    const { size } = await file.stat();
    const tail = Buffer.alloc(1);
    if (size) await file.read(tail, 0, 1, size - 1);
    await file.writeFile(`${size && tail[0] !== 10 ? "\n" : ""}- ${time} ${note}\n`);
  } finally {
    await file.close();
  }
}
