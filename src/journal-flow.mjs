import { encodeRequest } from "./plan.mjs";
import { appendJournalNote, journalGraph } from "./journal.mjs";
import { judgeTaskReport } from "./jev.mjs";
import { previewAndApply, requireStandaloneActions, requireLogseq, search } from "./ttt.mjs";

const OPEN_STATES = new Set(["open", "active", "waiting"]);

function trackerOptions(options) {
  const env = options.env || process.env;
  return { ...options, profile: options.profile || env.LOGSEQ_PROFILE,
    env: { ...env, LOGSEQ_GRAPH: journalGraph(env.LOGSEQ_GRAPH) } };
}

function journalItem(note, graph, subtitle = "Journal only · no task changes") {
  return {
    title: `Write to Logseq journal: ${note}`,
    subtitle: `${subtitle} · Return to save`,
    arg: encodeRequest({ action: "journal", kind: "note", note, graph }),
  };
}

export async function journalSuggestions(note, options = {}) {
  if (!note.trim()) return [{ title: "Type a journal entry", valid: false }];
  if (/[\r\n]/.test(note)) return [{ title: "Use one line per journal entry", valid: false }];
  const tracker = trackerOptions(options);
  const graph = tracker.env.LOGSEQ_GRAPH;
  const todo = note.match(/^TODO(?:\s+|$)/i);
  if (todo) {
    const title = note.slice(todo[0].length).trim();
    if (!title) return [{ title: "Type a task after TODO", valid: false }];
    await (options.requireTracker || requireLogseq)(tracker);
    return [{
      title: `Create Logseq TODO: ${title}`,
      subtitle: "Native TODO in today's journal · original note as child comment · Return to create",
      arg: encodeRequest({ action: "journal", kind: "create", note, title, profile: tracker.profile, graph }),
    }];
  }

  if (!tracker.profile)
    return [journalItem(note, graph, "Set LOGSEQ_PROFILE for task matching · journal only")];
  await (options.requireTracker || requireLogseq)(tracker);
  const find = options.search || search;
  const candidates = await find("item", note, { ...tracker, semantic: true, limit: 5 });
  if (candidates.some((task) => !Number.isFinite(task.semanticProbability)))
    return [journalItem(note, graph, "Task completion not verified · journal only")];
  const candidate = candidates.find((task) => OPEN_STATES.has(task.state));
  if (!candidate || candidate.semanticProbability < 0.75)
    return [journalItem(note, graph, "No sufficiently close open task")];
  if (!await (options.judge || judgeTaskReport)(note, candidate))
    return [journalItem(note, graph, "Jev did not verify task completion; no task changes")];

  return [{
    title: `Complete Logseq: ${candidate.title}`,
    subtitle: `${candidate.displayId} · native DONE and journal entry · Return to confirm`,
    arg: encodeRequest({ action: "journal", kind: "complete", note, profile: tracker.profile, graph,
      item: candidate.displayId, itemTitle: candidate.title,
      itemProject: candidate.project?.displayId || candidate.project?.title }),
  }, journalItem(note, graph, "Journal only · leave Logseq task open")];
}

export async function applyJournalRequest(request, options = {}) {
  const append = options.append || appendJournalNote;
  const apply = options.apply || previewAndApply;
  const tracker = trackerOptions(options);
  if (request.action !== "journal" || !["note", "create", "complete"].includes(request.kind) ||
      typeof request.note !== "string" || !request.note.trim() || /[\r\n]/.test(request.note))
    throw new Error("Invalid journal request.");
  if (request.graph !== tracker.env.LOGSEQ_GRAPH)
    throw new Error("The Logseq graph changed. Search again.");
  if (request.kind === "note") {
    await append(request.note, { graph: request.graph });
    return "Saved journal entry; no task changed";
  }
  if (!tracker.profile || request.profile !== tracker.profile)
    throw new Error("The Logseq profile changed. Search again.");
  if (request.kind === "create" && (typeof request.title !== "string" || !request.title.trim() || /[\r\n]/.test(request.title)))
    throw new Error("Invalid task title.");
  await (options.requireTracker || requireLogseq)(tracker);
  await (options.requireActions || requireStandaloneActions)(tracker);

  if (request.kind === "complete") {
    const [current] = await (options.search || search)("item", request.item, { ...tracker, limit: 1 });
    if (!current || current.displayId !== request.item || current.title !== request.itemTitle ||
        (current.project?.displayId || current.project?.title) !== request.itemProject ||
        !OPEN_STATES.has(current.state) || !await (options.judge || judgeTaskReport)(request.note, current))
      throw new Error("The task is no longer a verified match. Search again.");
  }
  try {
    await apply(request.kind === "create"
      ? { action: "create_item", title: request.title, comment: request.note }
      : { action: "update_item", item: request.item, state: "completed", comment: request.note }, tracker);
  } catch (error) {
    throw new Error(`Logseq change was not confirmed: ${error.message} Inspect Logseq before retrying; do not repeat creation blindly.`);
  }
  if (request.kind === "create") return `Created Logseq TODO: ${request.title}`;
  try {
    await append(request.note, { graph: request.graph });
  } catch (error) {
    throw new Error(`Logseq task completed, but journal entry was not saved: ${error.message} Do not retry completion.`);
  }
  return `Saved journal entry and completed Logseq task: ${request.itemTitle}`;
}
