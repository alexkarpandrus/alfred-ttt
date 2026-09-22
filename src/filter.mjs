#!/usr/bin/env node

import {
  buildItems,
  buildListItems,
  buildSummaryItem,
  buildUpdatePrompt,
  listState,
  parseCommand,
  searchQuery,
} from "./plan.mjs";
import { inferWork } from "./rephrase.mjs";
import { listItems, requireStandaloneActions, search } from "./ttt.mjs";

function uniqueCandidates(groups) {
  const seen = new Set();
  return groups.flat().filter((candidate) => {
    const key = candidate.displayId;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

  const [itemGroups, projects, intent] = await Promise.all([
    Promise.all(searches),
    target
      ? Promise.resolve([])
      : search("project", focused, { semantic, limit: 2 }),
    inferWork(text, { enabled: process.env.TTT_REPHRASE !== "0" }),
  ]);

  output(
    buildItems(text, {
      items: uniqueCandidates(itemGroups),
      projects,
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
