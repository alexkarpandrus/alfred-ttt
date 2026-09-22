import assert from "node:assert/strict";
import test from "node:test";

import { buildDashboard } from "../src/summary.mjs";

test("buildDashboard summarizes and lists only live tasks", () => {
  const dashboard = buildDashboard(
    [
      {
        displayId: "open0001",
        title: "Prepare release notes",
        state: "open",
        priority: "high",
        project: { displayId: "release" },
        dueAt: "2026-09-20T12:00:00Z",
        blockedBy: [],
        labels: [{ displayId: "release-note" }],
      },
      {
        displayId: "wait0001",
        title: "Wait for approval",
        state: "waiting",
        priority: "none",
        project: null,
        dueAt: null,
        blockedBy: [{ displayId: "open0001" }],
      },
      {
        displayId: "done0001",
        title: "Already shipped",
        state: "completed",
        blockedBy: [],
      },
    ],
    new Date("2026-09-22T12:00:00Z"),
  );

  assert.match(dashboard, /✨ 2 live/);
  assert.match(dashboard, /🌱 1 open/);
  assert.match(dashboard, /🚀 0 active/);
  assert.match(dashboard, /⏳ 1 waiting/);
  assert.match(dashboard, /🧱 1 blocked/);
  assert.match(dashboard, /🔥 1 overdue/);
  assert.match(dashboard, /## 🌱 Open \(1\)/);
  assert.match(dashboard, /## ⏳ Waiting \(1\)/);
  assert.match(dashboard, /🗂️ \*\*release\*\*/);
  assert.match(dashboard, /🔥 \*\*Overdue 2026-09-20\*\*/);
  assert.match(dashboard, /🏷️ #release-note/);
  assert.doesNotMatch(dashboard, /```/);
  assert.match(dashboard, /Prepare release notes/);
  assert.match(dashboard, /Wait for approval/);
  assert.doesNotMatch(dashboard, /Already shipped/);
});

test("buildDashboard handles an empty live set", () => {
  assert.match(buildDashboard([]), /0 live.*No live tasks\./s);
});
