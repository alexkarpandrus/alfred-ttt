# alfred-ttt

Capture, find, and update tracker tasks from Alfred without maintaining a separate notes list.

Type `ttt`, then write naturally. The workflow uses [`ttt`](https://github.com/alexkarpandrus/tickettrain) to show:

- a new standalone task first, followed by matching tasks that can receive the text as an update;
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

## Browse and update tasks

`ttt list` shows current tasks and their state, project, labels, priority, and due date. Add text after `list` to filter the results. Select a task with Tab, then type a free-form update after the generated `<task-id>:` prefix.

The text after the prefix is stored unchanged as a comment. The local model infers explicit structured lifecycle, priority, and due-date changes. Alfred shows every inferred change before approval.

## Live dashboard

`ttt summary` or `ttt s` opens an Alfred Text View with playful state icons and responsive task cards grouped by lifecycle state. Each card shows blockers, priority, due date, project, labels, task ID, and the full title. Completed and canceled tasks are excluded.

Short aliases are `ttt l` for listing and `ttt l o/a/w/d/c` for open, active, waiting, completed, or canceled tasks.

## On-device inference

Apple's Foundation Models framework receives a bounded local context from matching tasks, projects, and labels. It rewrites new-task titles, reuses the existing project and label taxonomy, and infers explicit lifecycle, priority, and due-date changes. New labels require an explicit `+label` token. Relative due dates use the current local date and timezone. Alfred shows every inferred mutation before approval. The raw note is preserved in the tracker description, and update comments remain exact. Disable Apple Intelligence in the workflow configuration to keep exact titles and rule-based labels.

## Optional semantic matching

Enable **Use Jev semantic ranking** in the workflow configuration after configuring `TYPESAFE_API_KEY` for `ttt`. This sends the entered text and tracker candidate excerpts to TypeSafe AI. Without it, the workflow uses `ttt` lexical search.

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
