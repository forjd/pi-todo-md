# pi-todo-md

[![CI](https://img.shields.io/github/actions/workflow/status/forjd/pi-todo-md/ci.yml?branch=main&style=flat-square&label=ci)](https://github.com/forjd/pi-todo-md/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/pi-todo-md?style=flat-square)](https://www.npmjs.com/package/pi-todo-md)

A shareable [pi](https://www.npmjs.com/package/@mariozechner/pi-coding-agent) package that gives the agent a structured `todo_md` tool backed by a repo-local `TODO.md` file.

## What it does

- manages `TODO.md` through a structured tool instead of ad-hoc file edits
- finds the nearest `TODO.md` in the current directory or a parent directory
- creates `TODO.md` at the git repo root when none exists yet
- keeps stable task IDs with hidden HTML comments
- supports sections, reordering, bulk add, rename, check/uncheck, and prioritize
- adds an interactive `/todos [section]` browser inside pi

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
- `Rename task #2 to finish README polish`
- `Mark task #2 as done`
- `Move task #3 to In Progress`
- `Prioritize task #5`
- `/todos`
- `/todos In Progress`

## Tool API

The extension registers a tool named `todo_md`.

| Action | Required | Optional | Description |
|---|---|---|---|
| `list` | — | `section` | Show the current task list |
| `add` | `text` | `section`, `index` | Add one task |
| `bulk_add` | `items` | `section`, `index` | Add multiple tasks at once |
| `check` | `id` | — | Mark a task done |
| `uncheck` | `id` | — | Mark a task not done |
| `rename` | `id`, `text` | — | Change task text |
| `remove` | `id` | — | Delete a task |
| `move` | `id` | `section`, `index` | Move a task to another section or position |
| `prioritize` | `id` | `section` | Move a task to the top of a section |

There is also a `/todos [section]` command for a quick interactive view.

## Managed file format

`pi-todo-md` normalizes `TODO.md` into a canonical format like this:

```md
# TODO

## Tasks
- [ ] ship the plugin <!-- pi-todo-md:id=1 -->
- [x] read the docs <!-- pi-todo-md:id=2 -->

## In Progress
- [ ] package it for sharing <!-- pi-todo-md:id=3 -->
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
