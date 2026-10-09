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

`ll <text>` saves a timestamped plain block in today's journal in the detected `~/logseq` graph. Set `LOGSEQ_GRAPH` to another graph directory if needed. The original one-line text follows the local `HH:mm` timestamp. Explicit `#tag` tokens remain native Logseq tags; no other tags are inferred.

`ll TODO ask a teammate` also creates a Taskwarrior item through `ttt` preview/apply, with the original note as an append-only comment. For other notes, `ttt` semantic search and Jev check whether the note confidently completes an open Taskwarrior task. Alfred shows its title before Return; if Jev cannot verify it, the entry is journal-only. Explicit `#tag` tokens also become Taskwarrior labels on created or completed items; the raw journal text stays unchanged. `ll` requires a Taskwarrior `ttt` profile. It sends the note and task context to Jev; it does not use the optional `ttt` semantic checkbox.

Set **Jev API key** in Alfred Workflow Configuration, or provide `TYPESAFE_API_KEY` in Alfred’s environment. The same key supports `ttt` staged matching. Alfred saves configuration values in `prefs.plist`, not Keychain; treat that file as sensitive and do not share or sync it without protecting it. A key in an interactive shell alone does not reach Alfred. If Jev or `ttt` is unavailable, `ll` does not propose an unverified completion.

**Logseq task creation and DONE updates are placeholders until [tickettrain #90](https://github.com/alexkarpandrus/tickettrain/issues/90) is implemented.** Journal entries remain plain blocks, even when their text starts with `TODO`. Taskwarrior mutations happen after writing the journal entry; if they fail, inspect the task before retrying to avoid a duplicate journal entry.

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
