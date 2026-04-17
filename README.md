# pi-todo-md

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

This repo includes GitHub Actions for CI and releases.

### CI

`.github/workflows/ci.yml` runs on pushes to `main` and on pull requests. It:

- runs `npm test`
- runs `npm pack --dry-run`

### Release flow

`.github/workflows/release.yml` runs when you push a semver tag like `v0.1.2`. It:

- verifies the tag matches `package.json`
- runs `npm test`
- builds the publish tarball
- publishes to npm
- creates a GitHub release with generated notes

### Recommended npm setup

Use **npm trusted publishing** for the smoothest release flow.

In npm package settings for `pi-todo-md`, add a trusted publisher for:

- GitHub repo: `forjd/pi-todo-md`
- workflow: `.github/workflows/release.yml`

That lets GitHub Actions publish to npm without a long-lived token or OTP prompts.

If you do not want trusted publishing, add an `NPM_TOKEN` repository secret instead.

### Releasing

After your changes are merged to `main`, run one of:

```bash
npm run release:patch
npm run release:minor
npm run release:major
```

Those commands:

- run release checks via `preversion`
- bump `package.json`
- create a git commit and semver tag
- push commit + tag to GitHub

Once the tag reaches GitHub, the release workflow publishes to npm and creates the GitHub release automatically.

## Notes

- The extension uses pi's file mutation queue so concurrent file edits do not clobber each other.
- A plain `list` can create or normalize `TODO.md` so the task IDs become stable.
- The canonical file is easy to read and easy to commit.

## License

MIT
