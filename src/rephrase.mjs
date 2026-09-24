import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_BINARY = fileURLToPath(
  new URL("../bin/rephrase", import.meta.url),
);
const STATE_CUES = {
  open: /\b(?:reopen(?:ed|ing)?|resum(?:e|ed|ing)|unblock(?:ed|ing)?|no longer (?:waiting|blocked))\b/i,
  active: /\b(?:start(?:ed|ing)?|begin|began|in progress|working on)\b/i,
  waiting:
    /\b(?:wait(?:ing)?|await(?:ing)?|on hold|paus(?:e|ed|ing)|blocked|stuck)\b/i,
  completed:
    /\b(?:done|complete|completed|completing|finish(?:ed|ing)?|resolved|shipped|delivered)\b/i,
  canceled:
    /\b(?:cancel(?:ed|led|ing)?|drop(?:ped|ping)?|abandon(?:ed|ing)?|delete|deleted|deleting)\b/i,
};
const COMPLETABLE_STATES = new Set(["open", "active", "waiting"]);

// Model-selected completion targets still need evidence that the note reports past work.
const PAST_VERB = "(?:[a-z]{2,}ed|sent|wrote|made|did|done|built|ran|went|gave|got|took)";
const PAST_REPORT = new RegExp(
  `^(?:(?:yesterday|today|i|we|they|he|she|it|just|already|finally|[a-z]+ly)\\s+)*${PAST_VERB}\\b|\\b(?:was|were|have|has|had|(?:i|we|they)['’]ve|(?:he|she|it)['’]s)\\s+(?:(?:been|just|already|finally|[a-z]+ly)\\s+)*${PAST_VERB}\\b`,
  "i",
);
const REQUEST_WORD = "(?:not|never|can|should|could|would|will|must|might|may|need(?:s|ed)?|want(?:s|ed)?|plan(?:s|ned)?|please)";
const REQUEST_OR_NEGATION = new RegExp(`\\b${REQUEST_WORD}\\b`, "i");
const TASK_STOPWORDS = new Set(["a", "an", "the", "to", "in", "on", "for", "of", "with", "from", "about", "by", "at", "and"]);
const IRREGULAR_PAST = new Map([
  ["send", "sent"], ["write", "wrote"], ["make", "made"], ["run", "ran"],
  ["go", "went"], ["give", "gave"], ["get", "got"], ["take", "took"],
  ["do", "did"], ["build", "built"], ["plan", "planned"], ["try", "tried"],
  ["stop", "stopped"], ["drop", "dropped"],
]);

function reportsPastWork(note, phrase, title) {
  if (!sourcedPhrase(note, phrase)) return false;
  const [action, ...details] = normalized(title).split(" ");
  const [subject, ...context] = details.filter((word) => !TASK_STOPWORDS.has(word));
  const pastAction = IRREGULAR_PAST.get(action) ||
    `${action}${action.endsWith("e") ? "d" : "ed"}`;
  // Split coordinated actions and requests, not nouns such as “research and development”.
  const clauses = note.split(new RegExp(
    `[,;.!?]|\\bbut\\b|\\band\\s+(?=(?:[a-z]+\\s+)?(?:[a-z]+['’](?:ll|d|t)\\s+|(?:${PAST_VERB}|${action}|${REQUEST_WORD})\\b))`,
    "i",
  ));
  const phraseClause = clauses.find((clause) => sourcedPhrase(clause, phrase));
  if (phraseClause && !PAST_REPORT.test(phraseClause.trim()) &&
      normalized(phraseClause).split(" ").includes(action)) return false;

  return clauses.some((clause) => {
    if (REQUEST_OR_NEGATION.test(clause) || !PAST_REPORT.test(clause.trim())) return false;
    const words = normalized(clause).split(" ");
    const verbIndex = words.indexOf(pastAction);
    if (verbIndex < 0) return false;
    const objects = /\b(?:was|were)\b/i.test(clause)
      ? words : words.slice(verbIndex + 1);
    return (!subject || objects.includes(subject) || objects.includes(subject[0])) &&
      (!context.length || context.some((word) => objects.includes(word)));
  });
}

const PRIORITIES = new Set(["none", "low", "medium", "high", "urgent"]);
const PRIORITY_PHRASES = {
  none: /\b(?:(?:no|without)\s+prio(?:rity)?|(?:clear|remove)\s+(?:the\s+)?prio(?:rity)?)\b/i,
  low: /\b(?:low(?:est)?\s+prio(?:rity)?|prio(?:rity)?\s*[:=-]?\s*low(?:est)?)\b/i,
  medium: /\b(?:medium\s+prio(?:rity)?|prio(?:rity)?\s*[:=-]?\s*medium)\b/i,
  high: /\b(?:high\s+prio(?:rity)?|prio(?:rity)?\s*[:=-]?\s*high)\b/i,
  urgent: /\b(?:urgent|critical|asap|highest\s+prio(?:rity)?|prio(?:rity)?\s*[:=-]?\s*urgent)\b/i,
};
const DUE_PHRASE =
  /\b(?:today|tomorrow|tonight|eod|eow|end of (?:the )?(?:day|week|month)|(?:this|next)\s+(?:week|month|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|in\s+\d+\s+(?:days?|weeks?|months?)|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?|(?:on|by)\s+(?:the\s+)?\d{1,2}(?:st|nd|rd|th)|(?:by|at)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm))\b|\b\d{4}-\d{1,2}-\d{1,2}\b|\b\d{1,2}[/.]\d{1,2}(?:[/.]\d{2,4})?\b/i;

const LIFECYCLE_LABELS = new Set([
  "active",
  "blocked",
  "canceled",
  "completed",
  "open",
  "waiting",
]);

function entityName(entity) {
  return entity?.displayId || entity?.title;
}

function uniqueNames(entities) {
  return [
    ...new Map(
      entities
        .map(entityName)
        .filter(Boolean)
        .map((name) => [name.toLocaleLowerCase(), name]),
    ).values(),
  ];
}

function normalized(value) {
  return String(value)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function canonicalName(value, names) {
  const key = normalized(value);
  return names.find((name) => normalized(name) === key);
}

function cleanLabel(value) {
  const label = value.trim().replace(/\s+/g, "-");
  return /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,39}$/u.test(label)
    ? label
    : undefined;
}

function taggedLabels(input) {
  return [...input.matchAll(/(?:^|\s)\+([\p{L}\p{N}][\p{L}\p{N}._-]{0,39})(?=$|[\s,;.!?])/gu)]
    .map(([, value]) => cleanLabel(value))
    .filter(Boolean);
}

function mentionsLabel(input, label) {
  const inputWords = normalized(input).split(/\s+/);
  return normalized(label)
    .split(/\s+/)
    .every((labelWord) =>
      inputWords.some(
        (inputWord) =>
          inputWord === labelWord ||
          (inputWord.length >= 5 &&
            labelWord.length >= 5 &&
            inputWord.slice(0, 5) === labelWord.slice(0, 5)),
      ),
    );
}

function sourcedPhrase(input, phrase) {
  if (typeof phrase !== "string" || !phrase.trim()) return false;
  return input
    .normalize("NFKC")
    .toLocaleLowerCase()
    .includes(phrase.trim().normalize("NFKC").toLocaleLowerCase());
}

function dueInstant(value, phrase) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const hasTime = /\b(?:at|by)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\b\d{1,2}:\d{2}\b|\b(?:noon|midnight)\b/i.test(
    phrase,
  );
  const dateOnly = value.trim().match(/^(\d{4}-\d{2}-\d{2})T.*?(Z|[+-]\d{2}:?\d{2})$/i);
  let instant;
  if (!hasTime && dateOnly) {
    const offset = dateOnly[2].replace(/^([+-]\d{2})(\d{2})$/, "$1:$2");
    instant = new Date(`${dateOnly[1]}T00:00:00${offset}`);
  } else {
    instant = new Date(value);
  }
  return Number.isNaN(instant.valueOf()) ? undefined : instant.toISOString();
}

export function buildInferenceContext(items = [], projects = [], labels = []) {
  const projectNames = uniqueNames([
    ...projects,
    ...items.map((item) => item.project).filter(Boolean),
  ]).slice(0, 5);
  const labelNames = uniqueNames([
    ...labels,
    ...items.flatMap((item) => item.labels || []),
  ])
    .filter((label) => !LIFECYCLE_LABELS.has(normalized(label)))
    .slice(0, 12);

  return {
    tasks: items.slice(0, 5).map((item) => ({
      id: item.displayId,
      title: item.title,
      state: item.state,
      ...(Number.isFinite(item.semanticProbability)
        ? { semanticProbability: item.semanticProbability }
        : {}),
      project: entityName(item.project),
      labels: (item.labels || [])
        .map(entityName)
        .filter((label) => label && !LIFECYCLE_LABELS.has(normalized(label)))
        .slice(0, 5),
    })),
    projects: projectNames,
    labels: labelNames,
  };
}

export function cleanTitle(output) {
  return output.trim().replace(/^["“”]+|["“”.!?]+$/gu, "");
}

function stripMetadata(title, phrases) {
  let result = title;
  for (const phrase of phrases.filter(Boolean)) {
    const needle = phrase.trim().toLocaleLowerCase();
    const index = result.toLocaleLowerCase().indexOf(needle);
    if (index >= 0) {
      result = `${result.slice(0, index)} ${result.slice(index + needle.length)}`;
    }
  }
  return cleanTitle(result.replace(/\s+/g, " "));
}

export function parseIntent(output, input, context = {}) {
  try {
    const parsed = JSON.parse(output);
    const explicitState = STATE_CUES[parsed.state]?.test(input)
      ? parsed.state
      : undefined;
    const completableTasks = (context.tasks || []).filter((task) =>
      COMPLETABLE_STATES.has(task.state),
    );
    const selectedIds = new Set(
      (Array.isArray(parsed.completedTaskIds) ? parsed.completedTaskIds : [])
        .filter((id) => typeof id === "string")
        .map((id) => id.toLocaleLowerCase()),
    );
    const completedTasks = completableTasks.filter((task) =>
      selectedIds.has(String(task.id).toLocaleLowerCase()) &&
      reportsPastWork(input, parsed.statePhrase, task.title),
    );
    const taskRelativeCompletion = completedTasks.length > 0;
    const state = explicitState || (taskRelativeCompletion ? "completed" : undefined);
    const priority =
      PRIORITIES.has(parsed.priority) &&
      sourcedPhrase(input, parsed.priorityPhrase) &&
      PRIORITY_PHRASES[parsed.priority]?.test(parsed.priorityPhrase)
        ? parsed.priority
        : undefined;
    const dueAt =
      sourcedPhrase(input, parsed.duePhrase) && DUE_PHRASE.test(parsed.duePhrase)
        ? dueInstant(parsed.dueAt, parsed.duePhrase)
        : undefined;
    let title;
    if (typeof parsed.title === "string") {
      const metadataPhrases = [];
      if (priority) metadataPhrases.push(parsed.priorityPhrase);
      if (dueAt) metadataPhrases.push(parsed.duePhrase);
      title = stripMetadata(parsed.title, metadataPhrases);
    }
    const project =
      typeof parsed.project === "string"
        ? canonicalName(parsed.project, context.projects || [])
        : undefined;
    const labels = [];
    for (const value of Array.isArray(parsed.labels) ? parsed.labels : []) {
      if (typeof value !== "string") continue;
      const label = cleanLabel(value);
      if (!label || LIFECYCLE_LABELS.has(normalized(label))) continue;
      const accepted = canonicalName(label, context.labels || []);
      if (accepted && mentionsLabel(input, accepted) && !labels.includes(accepted)) {
        labels.push(accepted);
        if (labels.length === 5) break;
      }
    }
    for (const label of taggedLabels(input)) {
      const accepted = canonicalName(label, context.labels || []) || label;
      if (!LIFECYCLE_LABELS.has(normalized(accepted)) && !labels.includes(accepted)) {
        labels.push(accepted);
        if (labels.length === 5) break;
      }
    }

    const intent = {};
    if (title && title !== input.trim()) intent.title = title;
    if (state) intent.state = state;
    if (taskRelativeCompletion) intent.taskRelativeCompletion = true;
    if (taskRelativeCompletion) intent.completedTaskIds = completedTasks.map((task) => task.id);
    if (priority) intent.priority = priority;
    if (dueAt) intent.dueAt = dueAt;
    if (project) intent.project = project;
    if (labels.length) intent.labels = labels;
    return intent;
  } catch {
    return {};
  }
}

export async function inferWork(input, options = {}) {
  if (!options.enabled) return {};
  const binary = options.binary || DEFAULT_BINARY;
  const context = options.context || {};

  try {
    const { stdout } = await execFileAsync(
      binary,
      [input, JSON.stringify(context)],
      {
        timeout: 10_000,
        maxBuffer: 64 * 1024,
      },
    );
    return parseIntent(stdout, input, context);
  } catch {
    return {};
  }
}
