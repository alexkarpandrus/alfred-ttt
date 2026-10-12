# alfred-ttt

Capture, find, and update tracker tasks from Alfred without maintaining a separate notes list.

Type `ttt`, then write naturally. The workflow uses [`ttt`](https://github.com/alexkarpandrus/tickettrain) to show:

- read-only task matches for lookup phrases, or a new task first for action notes followed by matching tasks that can receive an update;
- polished new-task titles, with the original note preserved in the description;
- current tasks through `ttt list [filter]` and a live dashboard through `ttt summary`.

Selecting a mutation is the approval step. The workflow runs `ttt preview`, then applies that unchanged proposal. Updates preserve the entered free-form text as an append-only comment. Apple Intelligence separately infers explicit lifecycle, priority, and due-date changes. The `promised` and `follow-up` labels remain classifications rather than lifecycle states.

## Requirements

- Alfred 5.5 or newer with the Powerpack (Text View is required for the dashboard)
- Node.js 20 or newer
- `ttt` with the `create-items`, `update-items`, `list-items`, `search-items`, `search-projects`, `search-labels`, `item-lifecycle`, `item-priority`, and `item-due-dates` capabilities
- a configured tracker profile; the default is `own`
- macOS 26 with Apple Intelligence enabled for local title and work-item inference

Check the required `ttt` capabilities:

```sh
ttt version
```

## Install

```sh
npm test
npm run build
open dist/alfred-ttt.alfredworkflow
```

Alfred's workflow configuration lets you change the `ttt` command and profile.

## Model regression checks

`npm test` runs deterministic command and safety cases. On a Mac with Apple Intelligence and ttt's Jev API key configured, test both models with synthetic tasks:

```sh
npm run test:model
```

This check sends only synthetic tasks to Jev through ttt's inference code. Set `TTT_JEV_HOME` if ttt is not installed at `~/.local/share/tickettrain`. Set `TTT_JEV_SOURCE` to a tickettrain checkout with `check-project` until that command is installed. It does not read or change tracker tasks. A failure means the workflow can still offer an incorrect action.

Automatic **Complete** suggestions require the **Use Jev semantic ranking** checkbox. When it is off, Alfred does not send notes to Jev and does not offer automatic completion. Other capture and lookup actions still work. Project-specific completions also require a `ttt` version with the read-only `check-project` command; if Jev or the command is unavailable, Alfred does not offer **Complete**.

## Browse and update tasks

`ttt list` shows current tasks and their state, project, labels, priority, and due date. Add text after `list` to filter the results. Select a task with Tab, then type a free-form update after the generated `<task-id>:` prefix.

The text after the prefix is stored unchanged as a comment. The local model infers explicit structured lifecycle, priority, and due-date changes. Alfred shows every inferred change before approval.

Unprefixed notes such as `started indexing for Dana` offer ▶️ Active for related open, active, or waiting tasks before Create. Ambiguous matches remain separate choices; the selected update preserves the note as a comment and still needs approval. Every identifying word must match the title (one adjacent letter swap allowed); use Tab to target a task when wording differs.

## Live dashboard

`ttt summary` or `ttt s` opens an Alfred Text View with playful state icons and responsive task cards grouped by lifecycle state. Each card shows blockers, priority, due date, project, labels, task ID, and the full title. Completed and canceled tasks are excluded.

Short aliases are `ttt l` for listing and `ttt l o/a/w/d/c` for open, active, waiting, completed, or canceled tasks.

## On-device inference

Apple's Foundation Models framework receives a bounded local context from matching tasks, projects, and labels. It distinguishes lookup phrases from action notes and selects plausible task IDs for read-only browsing; returned IDs are checked against that context. Without the model, literal title fragments still browse existing work. It rewrites new-task titles, reuses the existing project and label taxonomy, and infers explicit lifecycle, priority, and due-date changes. A past-tense report can also propose completing a matching open task; Alfred lists competing matches for explicit selection. New labels require an explicit `+label` or `#label` token. Relative due dates use the current local date and timezone; dates without a time are due at 23:59:59 local. Alfred shows every inferred mutation before approval. The raw note is preserved as a tracker comment. Disable Apple Intelligence in the workflow configuration to keep exact titles and rule-based labels.

## Optional semantic matching

Enable **Use Jev semantic ranking** in the workflow configuration after configuring `TYPESAFE_API_KEY` for `ttt`. This sends the entered text and tracker candidate excerpts to TypeSafe AI. Without it, the workflow uses `ttt` lexical search.

With Jev and Apple Intelligence enabled, unprefixed `ttt` requests use staged suggestions. Clear new-task requests show **Create as written** as soon as local search finishes. This action saves the exact title and rule-based labels, with **no inferred metadata**; wait for a refined suggestion to use an inferred project, priority, or due date. Jev classifies the note and ranks local task candidates in one request while Apple refines titles and metadata in parallel. The first pass searches up to 10 candidates for each of the raw and focused queries, within ttt's search limit. Alfred refreshes the list without changing the original Create action. Results from a different query or profile are ignored, and obsolete requests are canceled. Progress reports, explicit task targets, and `ll` keep their existing verification paths.

Staged results use Alfred's private workflow cache. Cached notes and suggestions are owner-only; the next query replaces them. Disabling the Jev checkbox keeps `ttt` on-device and uses the existing synchronous path.

## Journal (`ll`)

`ll <text>` saves a timestamped plain block in today's journal in `~/logseq`. Set **Logseq graph** (`LOGSEQ_GRAPH`) to another file graph if needed. Plain capture requires default journal filenames. The original one-line text and explicit `#tag` tokens remain unchanged.

`ll TODO ask a teammate` now creates one native Logseq TODO through `ttt` preview/apply. The original note is a native child comment; ttt quotes its leading TODO so the comment cannot become a duplicate task. No Taskwarrior item or extra plain TODO is created. For other notes, semantic search and Jev verify an open Logseq task before offering DONE. Approval rechecks the task, profile, graph, and completion judgment. Native completion happens before the report is saved as a plain journal entry. Hashtags remain in native text; this path does not request unsupported tracker labels.

### Native Logseq setup

1. Use **ttt v0.13.0 or newer**. Preserve local checkout changes before updating. Set **ttt command** to the release's executable if installing beside an existing checkout.
2. Enable Logseq's local HTTP API and keep the selected file graph open.
3. Configure a separate `logseq` tracker profile with `ttt setup --profile <name>`. Keep its API token in ttt's credential setup, not in this repository.
4. Set **Logseq task profile** (`LOGSEQ_PROFILE`) to that profile and **Logseq graph** to the exact API graph path. **ttt profile** remains your Taskwarrior profile. Without a Logseq task profile, ordinary notes remain journal-only; TODO creation fails with a setup message. DB graphs are not part of this `ll` integration.
5. Set **Jev API key** or provide `TYPESAFE_API_KEY` in Alfred's environment for verified completion. Explicit TODO creation does not send notes to Jev. The optional ttt semantic checkbox does not control ll matching. Alfred stores its settings in `prefs.plist`, not Keychain; do not share credentials or paste tokens into chat.

Native writes are not atomic. A failed creation or comment can leave a task behind; inspect the reported UUID before retrying. If completion succeeds but journal writing fails, do not repeat completion. The workflow reports that partial outcome. Do not switch graphs or edit the target block while apply runs. Existing Taskwarrior tasks are not migrated or mirrored.

### Disposable integration check

```sh
TTT_LOGSEQ_TEST_HOME=/path/to/clean/tickettrain-v0.13.0 node --test scripts/evaluate-logseq.mjs
```

This runs the released CLI against a temporary loopback SDK fixture and graph. It checks native TODO creation, child-comment quoting, DONE updates, approval gating, and graph-switch rejection. It sends no data to Jev and does not access the live Logseq API. `test/journal.feature` specifies the acceptance scenarios.

## Examples

```text
ttt s

ttt l

ttt l w
ttt ask Jade for a status update on Project X
ttt ask M about B low prio
ttt add adsa to asdsa tomorrow
ttt prepare release notes +release
ttt finished the CODEOWNERS update
ttt still waiting for Jade on Project X
ttt I promised the revised document tomorrow
```
