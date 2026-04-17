# pi-todo-md

[![CI](https://img.shields.io/github/actions/workflow/status/forjd/pi-todo-md/ci.yml?branch=main&style=flat-square&label=ci)](https://github.com/forjd/pi-todo-md/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/pi-todo-md?style=flat-square)](https://www.npmjs.com/package/pi-todo-md)

A shareable [pi](https://www.npmjs.com/package/@mariozechner/pi-coding-agent) package that gives the agent a structured `todo_md` tool backed by a repo-local `TODO.md` file.

## What it does

- manages `TODO.md` through a structured tool instead of ad-hoc file edits
- finds the nearest `TODO.md` in the current directory or a parent directory
- creates `TODO.md` at the git repo root when none exists yet
- keeps stable task IDs with hidden HTML comments
- supports sections, reordering, bulk add, rename, focus mode, priority metadata, notes, subtasks, check/uncheck, archive, and prioritize
- adds an interactive `/todos [section]` browser inside pi with keyboard actions

## Install

### From npm

```bash
pi install npm:pi-todo-md
```

### From a local checkout

```bash
pi install /absolute/path/to/pi-todo-md -l
```

## Quick start

After installing, start `pi` in your project and ask things like:

- `Show me the current todo list`
- `Add a task to TODO.md to publish the plugin`
- `Add these tasks to TODO.md: write docs, record demo, publish package`
- `What should I work on next from TODO.md?`
- `Focus task #2 and show me the current focus list`
- `Mark task #3 as high priority`
- `Rename task #2 to finish README polish`
- `Add a note to task #2 saying publish after the docs land`
- `Add subtasks to #2 for writing docs and publishing the package`
- `Mark task #2 as done`
- `Archive all completed tasks`
- `Move task #3 to In Progress`
- `Prioritize task #5`
- `/todos`
- `/todos In Progress`

## Tool API

The extension registers a tool named `todo_md`.

| Action | Required | Optional | Description |
|---|---|---|---|
| `list` | — | `section` | Show the current task list |
| `list_focused` | — | — | Show the current focused tasks |
| `next_task` | — | `section` | Recommend the next open task |
| `add` | `text` | `section`, `index` | Add one task |
| `bulk_add` | `items` | `section`, `index` | Add multiple tasks at once |
| `check` | `id` | — | Mark a task done |
| `uncheck` | `id` | — | Mark a task not done |
| `rename` | `id`, `text` | — | Change task text |
| `focus_task` | `id` | — | Mark a task as part of the active working set |
| `unfocus_task` | `id` | — | Remove a task from the active working set |
| `set_priority` | `id`, `priority` | — | Set priority to `low`, `medium`, or `high` |
| `clear_priority` | `id` | — | Remove priority metadata |
| `set_note` | `id`, `text` | — | Replace a task's note text |
| `append_note` | `id`, `text` | — | Append note line(s) to a task |
| `clear_note` | `id` | — | Remove all notes from a task |
| `add_subtask` | `id`, `text` | — | Add a subtask to a task |
| `check_subtask` | `id`, `subtask` | — | Mark a subtask done |
| `uncheck_subtask` | `id`, `subtask` | — | Mark a subtask not done |
| `remove_subtask` | `id`, `subtask` | — | Delete a subtask |
| `archive_done` | — | `section` | Move completed tasks into `Archive` |
| `remove` | `id` | — | Delete a task |
| `move` | `id` | `section`, `index` | Move a task to another section or position |
| `prioritize` | `id` | `section` | Move a task to the top of a section |

There is also a `/todos [section]` command for an interactive view. Inside the browser you can use:

- `↑↓` or `j/k` to move
- `x` to toggle the selected task or subtask
- `f` to focus or unfocus the selected task
- `h`, `m`, `l`, or `0` to set high, medium, low, or no priority
- `r` to rename a task
- `n` to edit a task note
- `s` to add a subtask
- `p` to prioritize a task
- `d` to delete the selected task or subtask
- `a` to archive completed tasks
- `o` to toggle done items on and off

## Managed file format

`pi-todo-md` normalizes `TODO.md` into a canonical format like this:

```md
# TODO

## Tasks
- [ ] ship the plugin [focus] [high] <!-- pi-todo-md:id=1 -->
  - note: publish after trusted publishing works
  - [ ] write docs
  - [ ] publish package
- [x] read the docs <!-- pi-todo-md:id=2 -->

## In Progress
- [ ] package it for sharing <!-- pi-todo-md:id=3 -->

## Archive
- [x] initial release <!-- pi-todo-md:id=4 -->
```

The hidden `<!-- pi-todo-md:id=... -->` markers keep task IDs stable across edits.

## File placement rules

When the tool runs, it will:

1. use `TODO.md` in the current directory if present
2. otherwise walk up parent directories looking for `TODO.md`
3. if none exists, create one at the nearest git repo root
4. if not inside a git repo, create one in the current directory

## Local development

Run the tests:

```bash
npm test
```

Preview the publish tarball:

```bash
npm pack --dry-run
```

Try the extension directly without installing it globally:

```bash
pi -e ./extensions/todo-md.js
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for:

- release conventions
- Release Please workflow details
- npm trusted publishing setup
- release debugging notes

## License

MIT
