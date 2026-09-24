const LABEL_RULES = [
  {
    label: "promised",
    add: /\b(?:promised|commitment|committed|owe)\b/i,
    remove:
      /\b(?:promise fulfilled|fulfilled the promise|delivered what i promised)\b/i,
  },
  {
    label: "follow-up",
    add: /\b(?:follow[ -]?up|check[ -]?in|status update)\b/i,
  },
];

const SEARCH_STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "been",
  "existing",
  "from",
  "have",
  "i",
  "just",
  "need",
  "still",
  "task",
  "that",
  "the",
  "this",
  "update",
  "with",
]);

const LIST_STATES = new Set([
  "open",
  "active",
  "waiting",
  "completed",
  "canceled",
]);
const RESERVED_LABELS = new Set([...LIST_STATES, "blocked"]);

export function parseCommand(input) {
  const text = input.trim();
  if (/^(?:summary|s)$/i.test(text)) return { mode: "summary" };
  const list = text.match(/^(?:list|l)(?:\s+(.*))?$/i);
  if (list) return { mode: "list", query: list[1]?.trim() || "" };

  const targeted = text.match(/^([A-Z][A-Z0-9]+-\d+|[0-9a-f]{8,}):\s*(.*)$/i);
  return {
    mode: "capture",
    target: targeted?.[1],
    text: targeted ? targeted[2].trim() : text,
  };
}

export function listState(query) {
  const state = query.trim().toLowerCase();
  const aliases = {
    a: "active",
    c: "canceled",
    d: "completed",
    o: "open",
    w: "waiting",
  };
  if (state === "done") return "completed";
  if (state === "cancelled") return "canceled";
  return aliases[state] || (LIST_STATES.has(state) ? state : undefined);
}

export function labelChanges(text, inferredLabels = []) {
  const removeLabels = LABEL_RULES.filter(({ remove }) =>
    remove?.test(text),
  ).map(({ label }) => label);
  const removed = new Set(removeLabels.map((label) => label.toLocaleLowerCase()));
  const ruleLabels = LABEL_RULES.filter(
    ({ add, label }) => add.test(text) && !removed.has(label.toLocaleLowerCase()),
  ).map(({ label }) => label);
  const addLabels = [...new Set([...ruleLabels, ...inferredLabels])].filter(
    (label) => {
      const normalized = label.toLocaleLowerCase();
      return !removed.has(normalized) && !RESERVED_LABELS.has(normalized);
    },
  );
  return { addLabels, removeLabels };
}

export function searchQuery(text) {
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
  const useful = words.filter((word) => {
    const normalized = word.toLowerCase();
    return (
      !SEARCH_STOP_WORDS.has(normalized) &&
      (normalized.length > 2 || word !== normalized)
    );
  });
  return useful.slice(0, 8).join(" ") || text.trim();
}

export function encodeRequest(request) {
  return Buffer.from(JSON.stringify(request)).toString("base64url");
}

export function decodeRequest(encoded) {
  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new Error(
      "The selected Alfred item contains an invalid ttt request.",
    );
  }
}

function hasValue(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string" || Array.isArray(value))
    return value.length > 0;
  return true;
}

function localDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return String(value).slice(0, 10);
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function requestArg(request) {
  return encodeRequest(
    Object.fromEntries(
      Object.entries(request).filter(([, value]) => hasValue(value)),
    ),
  );
}

export function buildSummaryItem() {
  return [
    {
      title: "Open live task dashboard",
      subtitle: "State, blockers, priority, due dates, projects, and task IDs",
      arg: requestArg({ action: "show_summary" }),
    },
  ];
}

function mutationSummary({ addLabels, removeLabels }, intent) {
  const parts = [];
  if (intent.state) parts.push(`state → ${intent.state}`);
  if (intent.priority) parts.push(`priority → ${intent.priority}`);
  if (intent.dueAt) parts.push(`due → ${localDate(intent.dueAt)}`);
  if (addLabels.length) parts.push(`add ${addLabels.join(", ")}`);
  if (removeLabels.length) parts.push(`remove ${removeLabels.join(", ")}`);
  return parts.length ? parts.join(" · ") : "comment only";
}

function updateItem(input, candidate, changes, intent) {
  const target = candidate.displayId;
  return {
    title: `Update “${candidate.title || target}”`,
    subtitle: `${target} · ${mutationSummary(changes, intent)} · Return to apply`,
    arg: requestArg({
      action: "update_item",
      item: target,
      comment: input,
      state: intent.state,
      priority: intent.priority,
      dueAt: intent.dueAt,
      addLabels: changes.addLabels,
      removeLabels: changes.removeLabels,
    }),
  };
}

function createItem(rawNote, title, project, changes, intent) {
  const projectName = project?.displayId;
  const location = projectName ? ` in ${projectName}` : "";
  const rephrased = title !== rawNote;
  return {
    title: `Create task${location}: ${title}`,
    subtitle: `${rephrased ? "rephrased · " : "as written · "}${mutationSummary(changes, intent)} · Return to create`,
    arg: requestArg({
      action: "create_item",
      title,
      description: rephrased ? rawNote : undefined,
      project: projectName,
      labels: changes.addLabels,
      state: intent.state,
      priority: intent.priority,
      dueAt: intent.dueAt,
    }),
  };
}

function entityName(entity) {
  return entity?.displayId || entity?.title;
}

function listHaystack(item) {
  return [
    item.displayId,
    item.title,
    item.description,
    item.state,
    item.priority,
    entityName(item.project),
    ...(item.labels || []).flatMap((label) => [label.displayId, label.title]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function buildListItems(items, query = "") {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const state = listState(query);
  const matches = items.filter((item) =>
    state
      ? item.state === state
      : terms.every((term) => listHaystack(item).includes(term)),
  );

  if (!matches.length) {
    return [
      {
        title: query ? `No tasks match “${query}”` : "No tracked tasks",
        subtitle: "Type a new task or clear the list filter",
        valid: false,
      },
    ];
  }

  return matches.slice(0, 50).map((item) => {
    const labels = (item.labels || []).map(entityName).filter(Boolean);
    const details = [
      item.state,
      item.priority && item.priority !== "none"
        ? `${item.priority} priority`
        : undefined,
      entityName(item.project),
      labels.length ? labels.map((label) => `+${label}`).join(" ") : undefined,
      item.dueAt ? `due ${localDate(item.dueAt)}` : undefined,
      item.displayId,
      "Tab to update",
    ].filter(Boolean);
    return {
      title: item.title || item.displayId,
      subtitle: details.join(" · "),
      autocomplete: `${item.displayId}: `,
      valid: false,
    };
  });
}

export function buildUpdatePrompt(candidate, target) {
  return [
    {
      title: candidate?.title || `Task ${target} not found`,
      subtitle: candidate
        ? `${target} · Type a free-form comment after the colon`
        : "Return to the task list and select another task",
      autocomplete: candidate ? `${target}: ` : undefined,
      valid: false,
    },
  ];
}

export function buildItems(
  input,
  { items = [], projects = [], intent = {}, allowCreate = true, target } = {},
) {
  const text = input.trim();
  if (!text) {
    return [
      {
        title: "Type a task, update, list, or summary",
        subtitle: "Examples: s · l w · finished the CODEOWNERS update",
        valid: false,
      },
    ];
  }

  const changes = labelChanges(text, intent.labels);
  const title = intent.title?.trim() || text;
  const taskRelativeCompletion =
    intent.state === "completed" && intent.taskRelativeCompletion === true;
  const completionTarget =
    taskRelativeCompletion && typeof intent.completedTaskId === "string"
      ? intent.completedTaskId.toLocaleLowerCase()
      : undefined;
  const alternativeIntent = taskRelativeCompletion
    ? {
        ...intent,
        state: undefined,
        completedTaskId: undefined,
        taskRelativeCompletion: undefined,
      }
    : intent;
  const candidates = items.slice(0, 5);
  const completionIndex = completionTarget
    ? candidates.findIndex(
        (candidate) => candidate.displayId?.toLocaleLowerCase() === completionTarget,
      )
    : -1;
  const updates = candidates.map((candidate, index) =>
    updateItem(
      text,
      candidate,
      changes,
      taskRelativeCompletion && (completionIndex < 0 || index === completionIndex)
        ? intent
        : alternativeIntent,
    ),
  );
  if (!allowCreate)
    return updates.length
      ? updates
      : buildUpdatePrompt(undefined, target || "selected task");

  const inferredProject = projects.find(
    (project) =>
      entityName(project)?.toLocaleLowerCase() === intent.project?.toLocaleLowerCase(),
  );
  const otherProjects = projects.filter((project) => project !== inferredProject);
  const creates = [
    createItem(text, title, inferredProject, changes, alternativeIntent),
    ...(title === text
      ? []
      : [createItem(text, text, inferredProject, changes, alternativeIntent)]),
    ...(inferredProject
      ? [createItem(text, title, undefined, changes, alternativeIntent)]
      : []),
    ...otherProjects
      .slice(0, inferredProject ? 1 : 2)
      .map((project) => createItem(text, title, project, changes, alternativeIntent)),
  ];
  if (!taskRelativeCompletion) return [...creates, ...updates];
  if (completionIndex < 0) return [...updates, ...creates];
  return [
    updates[completionIndex],
    ...creates,
    ...updates.filter((_, index) => index !== completionIndex),
  ];
}
