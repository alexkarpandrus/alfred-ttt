#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { listItems, requireStandaloneActions } from "./ttt.mjs";

const LIVE_STATES = new Set(["open", "active", "waiting"]);

function entityName(entity) {
  return entity?.displayId || entity?.title || "—";
}

function hasBlockers(item) {
  return Array.isArray(item.blockedBy)
    ? item.blockedBy.length > 0
    : Boolean(item.blockedBy);
}

function dueDate(item) {
  return item.dueAt ? String(item.dueAt).slice(0, 10) : "—";
}

function isOverdue(item, now) {
  if (!item.dueAt) return false;
  const due = Date.parse(item.dueAt);
  return Number.isFinite(due) && due < now.getTime();
}

function markdown(value) {
  return String(value).replace(/([\\`*_{}[\]<>])/g, "\\$1");
}

function taskCard(item, now) {
  const details = [`🎫 \`${item.displayId}\``];
  const project = entityName(item.project);
  if (project !== "—") details.push(`🗂️ **${markdown(project)}**`);
  if (item.priority && item.priority !== "none") {
    const icon = { high: "⚡", medium: "🎯", low: "🍃" }[item.priority] || "🎯";
    details.push(`${icon} ${markdown(item.priority)} priority`);
  }
  if (item.dueAt)
    details.push(
      isOverdue(item, now)
        ? `🔥 **Overdue ${dueDate(item)}**`
        : `📅 Due ${dueDate(item)}`,
    );
  if (hasBlockers(item)) details.push("🧱 **Blocked**");

  const labels = (item.labels || [])
    .map(entityName)
    .filter((label) => label !== "—")
    .map((label) => `#${markdown(label)}`);
  if (labels.length) details.push(`🏷️ ${labels.join(" ")}`);

  return `- **${markdown(item.title || item.displayId)}**\n  ${details.join(" · ")}`;
}

export function buildDashboard(items, now = new Date()) {
  const live = items.filter((item) => LIVE_STATES.has(item.state));
  const count = (state) => live.filter((item) => item.state === state).length;
  const blocked = live.filter(hasBlockers).length;
  const overdue = live.filter((item) => isOverdue(item, now)).length;
  const summary = [
    `✨ ${live.length} live`,
    `🌱 ${count("open")} open`,
    `🚀 ${count("active")} active`,
    `⏳ ${count("waiting")} waiting`,
    `🧱 ${blocked} blocked`,
    `🔥 ${overdue} overdue`,
  ].join(" · ");

  if (!live.length)
    return `# ✨ Live tasks\n\n> **${summary}**\n\nNo live tasks.`;

  const sections = [
    ["🚀 Active", "active"],
    ["🌱 Open", "open"],
    ["⏳ Waiting", "waiting"],
  ]
    .map(([title, state]) => {
      const tasks = live.filter((item) => item.state === state);
      return tasks.length
        ? `## ${title} (${tasks.length})\n\n${tasks
            .map((item) => taskCard(item, now))
            .join("\n\n")}`
        : undefined;
    })
    .filter(Boolean);

  return `# ✨ Live tasks\n\n> **${summary}**\n\n---\n\n${sections.join("\n\n---\n\n")}`;
}

async function main() {
  await requireStandaloneActions();
  const items = await listItems({ limit: 50 });
  process.stdout.write(
    JSON.stringify({
      response: buildDashboard(items),
      footer: "Esc to close · Use ttt l to update · Shows up to 50 items",
    }),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stdout.write(
      JSON.stringify({
        response: `# Task summary unavailable\n\n${error.message}`,
      }),
    );
  });
}
