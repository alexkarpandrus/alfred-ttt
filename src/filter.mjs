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
import { buildInferenceContext, inferWork } from "./rephrase.mjs";
import { listItems, requireStandaloneActions, search } from "./ttt.mjs";

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

function output(items) {
  process.stdout.write(JSON.stringify({ skipknowledge: true, items }));
}

async function main() {
  const input = process.argv.slice(2).join(" ").trim();
  if (!input) {
    output(buildItems(""));
    return;
  }

  const command = parseCommand(input);
  if (command.mode === "summary") {
    output(buildSummaryItem());
    return;
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
  const semantic = process.env.TTT_SEMANTIC === "1";
  const searches = target
    ? [search("item", target, { limit: 1 })]
    : [search("item", text, { semantic, limit: 5 })];
  if (!target && focused.toLowerCase() !== text.toLowerCase())
    searches.push(search("item", focused, { limit: 5 }));

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
  const intent = await inferWork(text, {
    enabled: process.env.TTT_REPHRASE !== "0",
    context: buildInferenceContext(items, availableProjects, availableLabels),
  });

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
