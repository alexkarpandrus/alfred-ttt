# alfred-ttt

Capture, find, and update tracker tasks from Alfred without maintaining a separate notes list.

Type `ttt`, then write naturally. The workflow uses [`ttt`](https://github.com/alexkarpandrus/tickettrain) to show:

- matching tasks that can receive the text as an update;
- a new standalone task;
- polished new-task titles, with the original note preserved in the description;
- current tasks through `ttt list [filter]` and a live dashboard through `ttt summary`.

Selecting a mutation is the approval step. The workflow runs `ttt preview`, then applies that unchanged proposal. Updates preserve the entered free-form text as an append-only comment. Apple Intelligence separately infers an explicit state change to `open`, `active`, `waiting`, `completed`, or `canceled`. The `promised` and `follow-up` labels remain classifications rather than lifecycle states.

## Requirements

- Alfred 5.5 or newer with the Powerpack (Text View is required for the dashboard)
- Node.js 20 or newer
- `ttt` with the `create-items`, `update-items`, `list-items`, and `item-lifecycle` capabilities
- a configured tracker profile; the default is `own`
- macOS 26 with Apple Intelligence enabled for local title and state inference

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

The text after the prefix is stored unchanged as a comment. The local model infers only the structured state transition. Alfred shows the inferred transition before approval.

## Live dashboard

`ttt summary` or `ttt s` opens an Alfred Text View with playful state icons and responsive task cards grouped by lifecycle state. Each card shows blockers, priority, due date, project, labels, task ID, and the full title. Completed and canceled tasks are excluded.

Short aliases are `ttt l` for listing and `ttt l o/a/w/d/c` for open, active, waiting, completed, or canceled tasks.

## On-device inference

Apple's Foundation Models framework rewrites new-task titles and infers explicit lifecycle changes. Alfred shows the polished title first and an **as written** fallback. The raw note is preserved in the tracker description. Disable Apple Intelligence in the workflow configuration to keep exact titles and comment-only updates.

## Optional semantic matching

Enable **Use Jev semantic ranking** in the workflow configuration after configuring `TYPESAFE_API_KEY` for `ttt`. This sends the entered text and tracker candidate excerpts to TypeSafe AI. Without it, the workflow uses `ttt` lexical search.

## Examples

```text
ttt s

ttt l

ttt l w
ttt ask Jade for a status update on Project X
ttt finished the CODEOWNERS update
ttt still waiting for Jade on Project X
ttt I promised the revised document tomorrow
```
