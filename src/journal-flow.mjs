import { encodeRequest } from "./plan.mjs";
import { taggedLabels } from "./rephrase.mjs";
import { appendJournalNote } from "./journal.mjs";
import { judgeTaskReport } from "./jev.mjs";
import { previewAndApply, requireStandaloneActions, requireTaskwarrior, search } from "./ttt.mjs";

const OPEN_STATES = new Set(["open", "active", "waiting"]);

function tagSummary(note) {
  const tags = taggedLabels(note);
  return tags.length ? ` · Taskwarrior tags: ${tags.map((tag) => `+${tag}`).join(", ")}` : "";
}

function journalItem(note, subtitle = "Journal only · no task changes") {
  return {
    title: `Write to Logseq journal: ${note}`,
    subtitle: `${subtitle} · Return to save`,
    arg: encodeRequest({ action: "journal", kind: "note", note }),
  };
}

export async function journalSuggestions(note, options = {}) {
  if (!note.trim()) return [{ title: "Type a journal entry", valid: false }];
  if (/[\r\n]/.test(note)) return [{ title: "Use one line per journal entry", valid: false }];

  const todo = note.match(/^TODO(?:\s+|$)/i);
  if (todo) {
    const title = note.slice(todo[0].length).trim();
    if (!title) return [{ title: "Type a task after TODO", valid: false }];
    return [{
      title: `Create Taskwarrior task: ${title}`,
      subtitle: `Also save a plain journal entry${tagSummary(note)} · Logseq task pending ttt #90 · Return to create`,
      arg: encodeRequest({ action: "journal", kind: "create", note, title }),
    }];
  }

  if (!options.search) await requireTaskwarrior();
  const find = options.search || search;
  const candidates = await find("item", note, { semantic: true, limit: 5 });
  if (candidates.some((task) => !Number.isFinite(task.semanticProbability)))
    return [{ title: "Jev semantic matching is unavailable", subtitle: "No task or journal change", valid: false }];
  const candidate = candidates.find((task) => OPEN_STATES.has(task.state));
  if (!candidate || candidate.semanticProbability < 0.75)
    return [journalItem(note, "No sufficiently close open task")];

  const judge = options.judge || judgeTaskReport;
  if (!await judge(note, candidate))
    return [journalItem(note, "Jev did not verify task completion; no task changes")];

  return [{
    title: `Complete Taskwarrior: ${candidate.title}`,
    subtitle: `${candidate.displayId} · save journal entry${tagSummary(note)} · Logseq task pending ttt #90 · Return to confirm`,
    arg: encodeRequest({ action: "journal", kind: "complete", note,
      item: candidate.displayId, itemTitle: candidate.title,
      itemProject: candidate.project?.displayId || candidate.project?.title }),
  }, journalItem(note, "Journal only · leave Taskwarrior task open")];
}

export async function applyJournalRequest(request, options = {}) {
  const append = options.append || appendJournalNote;
  const apply = options.apply || previewAndApply;
  if (request.action !== "journal" || !["note", "create", "complete"].includes(request.kind) ||
      typeof request.note !== "string" || !request.note.trim() || /[\r\n]/.test(request.note))
    throw new Error("Invalid journal request.");

  if (request.kind === "create" && (typeof request.title !== "string" || !request.title.trim()))
    throw new Error("Invalid task title.");
  if (request.kind !== "note") {
    await (options.requireTracker || requireTaskwarrior)();
    await (options.requireActions || requireStandaloneActions)();
  }

  if (request.kind === "complete") {
    const find = options.search || search;
    const [current] = await find("item", request.item, { limit: 1 });
    if (!current || current.displayId !== request.item || current.title !== request.itemTitle ||
        (current.project?.displayId || current.project?.title) !== request.itemProject ||
        !OPEN_STATES.has(current.state) || !await (options.judge || judgeTaskReport)(request.note, current))
      throw new Error("The task is no longer a verified match. Search again.");
  }

  const tags = taggedLabels(request.note);
  // Logseq TODO/DONE belongs to ttt #90. A timestamp keeps this entry a plain block.
  await append(request.note);
  if (request.kind === "note") return "Saved journal entry; no task changed";

  try {
    if (request.kind === "create") {
      await apply({ action: "create_item", title: request.title, comment: request.note,
        ...(tags.length ? { labels: tags } : {}) });
      return `Saved journal entry and created Taskwarrior task: ${request.title}`;
    }
    await apply({ action: "update_item", item: request.item,
      state: "completed", comment: request.note,
      ...(tags.length ? { addLabels: tags } : {}) });
    return `Saved journal entry and completed Taskwarrior task: ${request.itemTitle}`;
  } catch (error) {
    throw new Error(`Journal saved, but Taskwarrior was not confirmed: ${error.message} Inspect the task before retrying.`);
  }
}
