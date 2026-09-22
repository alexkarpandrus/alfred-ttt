#!/usr/bin/env node

import { decodeRequest } from "./plan.mjs";
import { previewAndApply, requireStandaloneActions } from "./ttt.mjs";

export function successMessage(request) {
  if (request.action === "create_item") return `Created task: ${request.title}`;
  return `Updated ${request.item}: ${request.comment}`;
}

async function main() {
  const request = decodeRequest(process.argv[2] || "");
  if (request.action === "show_summary") {
    process.stdout.write("__TTT_SUMMARY__");
    return;
  }
  await requireStandaloneActions();
  await previewAndApply(request);
  process.stdout.write(successMessage(request));
}

main().catch((error) => {
  process.stdout.write(`Could not track work: ${error.message}`);
});
