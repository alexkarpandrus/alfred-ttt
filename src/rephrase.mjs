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

export function cleanTitle(output) {
  return output.trim().replace(/^["“”]+|["“”.!?]+$/gu, "");
}

export function parseIntent(output, input) {
  try {
    const parsed = JSON.parse(output);
    const title =
      typeof parsed.title === "string" ? cleanTitle(parsed.title) : undefined;
    const state = STATE_CUES[parsed.state]?.test(input)
      ? parsed.state
      : undefined;
    const intent = {};
    if (title && title !== input.trim()) intent.title = title;
    if (state) intent.state = state;
    return intent;
  } catch {
    return {};
  }
}

export async function inferWork(input, options = {}) {
  if (!options.enabled) return {};
  const binary = options.binary || DEFAULT_BINARY;

  try {
    const { stdout } = await execFileAsync(binary, [input], {
      timeout: 10_000,
      maxBuffer: 64 * 1024,
    });
    return parseIntent(stdout, input);
  } catch {
    return {};
  }
}
