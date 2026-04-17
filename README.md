# pi-todo-md

[![CI](https://img.shields.io/github/actions/workflow/status/forjd/pi-todo-md/ci.yml?branch=main&style=flat-square&label=ci)](https://github.com/forjd/pi-todo-md/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/pi-todo-md?style=flat-square)](https://www.npmjs.com/package/pi-todo-md)

A shareable [pi](https://www.npmjs.com/package/@mariozechner/pi-coding-agent) package that gives the agent a structured `todo_md` tool backed by a `TODO.md` file in the current repo.

## What it does

- finds `TODO.md` in the current directory or nearest parent directory
- if no `TODO.md` exists yet, creates one at the repo root when inside git, otherwise in the current directory
- exposes a structured tool instead of making the model edit `TODO.md` manually
- keeps stable numeric task IDs by storing them as hidden HTML comments in the Markdown file
- supports listing, adding, bulk-adding, renaming, checking, unchecking, removing, moving, and prioritizing tasks
- adds an interactive `/todos` browser inside pi

## Tool API

The extension registers a tool named `todo_md` with this API:

- `action: "list"`
  - optional: `section`
- `action: "add"`
  - required: `text`
  - optional: `section`, `index`
- `action: "bulk_add"`
  - required: `items`
  - optional: `section`, `index`
- `action: "check"`
  - required: `id`
- `action: "uncheck"`
  - required: `id`
- `action: "rename"`
  - required: `id`, `text`
- `action: "remove"`
  - required: `id`
- `action: "move"`
  - required: `id`
  - optional: `section`, `index`
- `action: "prioritize"`
  - required: `id`
  - optional: `section`

There is also a `/todos [section]` command that opens an interactive browser in pi.

## Managed file format

`pi-todo-md` owns the `TODO.md` format and normalizes it to a canonical layout like this:

```md
# TODO

## Tasks
- [ ] ship the plugin <!-- pi-todo-md:id=1 -->
- [x] read the docs <!-- pi-todo-md:id=2 -->

## In Progress
- [ ] package it for sharing <!-- pi-todo-md:id=3 -->
```

The hidden `<!-- pi-todo-md:id=... -->` markers are how the tool keeps task IDs stable.

## Install

### Install from a local checkout

```bash
pi install /absolute/path/to/pi-todo-md -l
```

### Install from npm later

```bash
pi install npm:pi-todo-md
```

## Local development

Run the package tests:

```bash
npm test
```

Try the extension directly without installing it globally:

```bash
pi -e ./extensions/todo-md.js
```

Or install the current checkout into another project:

```bash
cd /path/to/your/project
pi install /absolute/path/to/pi-todo-md -l
```

Then start pi in that project and ask things like:

- `Add a task to TODO.md to publish the plugin`
- `Add these tasks to TODO.md: write docs, record demo, publish package`
- `Show me the current todo list`
- `Rename task #2 to finish README polish`
- `Mark task #2 as done`
- `Move task #3 to In Progress`
- `Prioritize task #5`
- `/todos`
- `/todos In Progress`

## Automated releases

This repo includes GitHub Actions for CI and release automation.

### CI

`.github/workflows/ci.yml` runs on pushes to `main` and on pull requests. It:

- runs `npm test`
- runs `npm pack --dry-run`

### Release Please flow

`.github/workflows/release-please.yml` runs on every push to `main`.

It uses **Release Please** to:

- inspect conventional commits since the last release
- open or update a release PR with the next version bump
- generate changelog content for that release PR
- create the git tag and GitHub release when the release PR is merged
- publish the tagged version to npm
- upload the release tarball to the GitHub release

### Commit style for versioning

Release Please uses conventional commits to decide the next version:

- `fix:` → patch release
- `feat:` → minor release
- `feat!:` or `BREAKING CHANGE:` → major release

Examples:

```text
feat: add archive_done action
fix: preserve task IDs when normalizing legacy markdown
feat!: change TODO.md section ordering rules
```

### One-time npm setup

For seamless publishing, configure **npm trusted publishing** for:

- GitHub repo: `forjd/pi-todo-md`
- workflow filename: `release-please.yml`

Use the workflow filename only in npm's UI, not the full `.github/workflows/...` path.
That lets GitHub Actions publish to npm without a long-lived token or OTP prompts.

If you prefer not to use trusted publishing, add an `NPM_TOKEN` repository secret instead.

### Day-to-day release flow

1. Merge normal PRs to `main` using conventional commit titles or squash messages.
2. Let Release Please open or update the release PR.
3. Review the generated version bump and changelog.
4. Merge the release PR.
5. GitHub Actions tags, releases, and publishes automatically.

## Notes

- The extension uses pi's file mutation queue so concurrent file edits do not clobber each other.
- A plain `list` can create or normalize `TODO.md` so the task IDs become stable.
- The canonical file is easy to read and easy to commit.

## License

MIT
