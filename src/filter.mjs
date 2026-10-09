#!/usr/bin/env node

import {
  buildItems,
  buildListItems,
  buildSummaryItem,
  buildUpdatePrompt,
  listState,
  matchingTitles,
  parseCommand,
  searchQuery,
} from "./plan.mjs";
import { buildInferenceContext, confirmCompletionWithJev, inferWork, reportsPastWork, reportsProgress } from "./rephrase.mjs";
import { journalSuggestions } from "./journal-flow.mjs";
import { checkProject, listItems, requireStandaloneActions, search } from "./ttt.mjs";
import { cachedRefinement, discardObsoleteRefinement, startRefinement } from "./refinement.mjs";

function uniqueEntities(entities) {
  const seen = new Set();
  return entities.filter((entity) => {
    const key = entity?.displayId || entity?.title;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueCandidates(groups) {
  return uniqueEntities(groups.flat());
}

function output(items, refresh = {}) {
  process.stdout.write(JSON.stringify({ skipknowledge: true, items, ...refresh }));
}

async function main() {
  const input = process.argv.slice(2).join(" ").trim();
  await discardObsoleteRefinement(input);
  if (process.env.alfred_workflow_keyword === "ll") {
    output(await journalSuggestions(process.argv.slice(2).join(" ")));
    return;
  }
  if (!input) {
    output(buildItems(""));
    return;
  }

  const command = parseCommand(input);
  if (command.mode === "summary") {
    output(buildSummaryItem());
    return;
  }

  const staged = process.env.TTT_SEMANTIC === "1" && process.env.TTT_REPHRASE !== "0" &&
    Boolean(process.env.alfred_workflow_cache) && command.mode !== "list" && !command.target &&
    !reportsProgress(command.text) && !reportsPastWork(command.text, command.text);
  if (staged) {
    const cached = await cachedRefinement(command.text);
    if (cached) {
      const { items, ...refresh } = cached;
      output(items, refresh);
      return;
    }
  }

  await requireStandaloneActions();
  if (command.mode === "list") {
    const items = await listItems({
      limit: 50,
      state: listState(command.query),
    });
    output(buildListItems(items, command.query));
    return;
  }

  const { target, text } = command;
  if (target && !text) {
    const [candidate] = await search("item", target, { limit: 1 });
    output(buildUpdatePrompt(candidate, target));
    return;
  }

  const focused = searchQuery(text);
  const semantic = process.env.TTT_SEMANTIC === "1" && !staged;
  const searches = target
    ? [search("item", target, { limit: 1 })]
    : [search("item", text, { semantic, limit: staged ? 10 : 5 })];
  if (!target && focused.toLowerCase() !== text.toLowerCase())
    searches.push(search("item", focused, { limit: staged ? 10 : 5 }));

  const [itemGroups, projects, labels] = await Promise.all([
    Promise.all(searches),
    target
      ? Promise.resolve([])
      : search("project", focused, { semantic, limit: 2 }),
    search("label", focused, { semantic, limit: 8 }),
  ]);
  const items = uniqueCandidates(itemGroups);
  if (!target) {
    const matches = matchingTitles(items, text);
    if (matches.length) {
      output(buildListItems(matches));
      return;
    }
  }
  const availableProjects = uniqueEntities([
    ...projects,
    ...items.map((item) => item.project).filter(Boolean),
  ]);
  const availableLabels = uniqueEntities([
    ...labels,
    ...items.flatMap((item) => item.labels || []),
  ]);
  if (staged) {
    const { items: initial, ...refresh } = await startRefinement(text, items, availableProjects, availableLabels);
    output(initial, refresh);
    return;
  }
  let intent = await inferWork(text, {
    enabled: process.env.TTT_REPHRASE !== "0",
    context: buildInferenceContext(items, availableProjects, availableLabels),
  });
  if (!target && reportsPastWork(text, text)) {
    // The Jev checkbox controls external matching; without it, past-work reports cannot auto-complete.
    const jevCandidates = semantic ? itemGroups[0] : [];
    const selected = jevCandidates[0];
    const task = items.find((item) => item.displayId?.toLocaleLowerCase() === selected?.displayId?.toLocaleLowerCase());
    let projectRelation;
    if (Number.isFinite(selected?.semanticProbability) && task?.project) {
      try {
        projectRelation = await checkProject(text, task.project.displayId || task.project.title);
      } catch {
        // If project verification fails, do not offer an irreversible completion.
      }
    }
    intent = confirmCompletionWithJev(intent, jevCandidates, items, projectRelation);
  }

  output(
    buildItems(text, {
      items,
      projects: availableProjects,
      intent,
      allowCreate: !target,
      target,
    }),
  );
}

main().catch((error) => {
  process.stdout.write(
    JSON.stringify({
      items: [
        {
          title: "Work tracking is unavailable",
          subtitle: error.message,
          valid: false,
        },
      ],
    }),
  );
});
