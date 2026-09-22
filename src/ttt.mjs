import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const REQUIRED_CAPABILITIES = [
  "create-items",
  "update-items",
  "list-items",
  "item-lifecycle",
];

function parseEnvelope(output) {
  try {
    return JSON.parse(output);
  } catch {
    return undefined;
  }
}

function messageFrom(envelope, stderr, fallback = "ttt failed") {
  return (
    envelope?.error?.message || envelope?.message || stderr?.trim() || fallback
  );
}

export async function runTtt(args, options = {}) {
  const binary = options.binary || process.env.TTT_BIN || "ttt";
  const env = options.env || process.env;
  let stdout;

  try {
    ({ stdout } = await execFileAsync(binary, args, {
      env,
      maxBuffer: 1024 * 1024,
    }));
  } catch (error) {
    const envelope = parseEnvelope(error.stdout || "");
    throw new Error(messageFrom(envelope, error.stderr, error.message), {
      cause: error,
    });
  }

  const envelope = parseEnvelope(stdout);
  if (!envelope) throw new Error("ttt returned invalid JSON.");
  if (!envelope.ok) throw new Error(messageFrom(envelope));
  return envelope.data;
}

export async function requireStandaloneActions(options = {}) {
  const version = await runTtt(["version"], options);
  const missing = REQUIRED_CAPABILITIES.filter(
    (capability) => !version.capabilities?.includes(capability),
  );
  if (missing.length)
    throw new Error(
      "Installed ttt does not support standalone items. Update ttt and try again.",
    );
  return version;
}

export async function search(kind, query, options = {}) {
  if (!query.trim()) return [];
  const profile = options.profile || process.env.TTT_PROFILE || "own";
  const args = [
    "search",
    "--profile",
    profile,
    "--kind",
    kind,
    "--query",
    query,
    "--limit",
    String(options.limit || 5),
  ];
  if (options.semantic) args.push("--semantic");
  const result = await runTtt(args, options);
  return result.candidates || [];
}

export async function listItems(options = {}) {
  const profile = options.profile || process.env.TTT_PROFILE || "own";
  const args = [
    "list",
    "--profile",
    profile,
    "--kind",
    "item",
    "--limit",
    String(options.limit || 50),
  ];
  if (options.state) args.push("--state", options.state);
  const result = await runTtt(args, options);
  return result.items || [];
}

export async function previewAndApply(request, options = {}) {
  const profile = options.profile || process.env.TTT_PROFILE || "own";
  const directory = await mkdtemp(join(tmpdir(), "alfred-ttt-"));
  const requestFile = join(directory, "request.json");

  try {
    await writeFile(requestFile, JSON.stringify(request), { mode: 0o600 });
    const preview = await runTtt(
      ["preview", "--profile", profile, "--request-file", requestFile],
      options,
    );
    if (!preview.proposalId)
      throw new Error("ttt preview did not return a proposal ID.");
    return await runTtt(
      [
        "apply",
        "--profile",
        profile,
        "--request-file",
        requestFile,
        "--approve",
        preview.proposalId,
      ],
      options,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
