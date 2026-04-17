# Contributing

Thanks for contributing to `pi-todo-md`.

## Local checks

Before opening or merging changes, run:

```bash
npm test
npm pack --dry-run
```

## Commit and PR conventions

This repo uses **Release Please**. Version bumps are driven by conventional commits.

Use commit messages or squash-merge titles like:

- `fix: preserve task IDs during normalization`
- `feat: add archive_done action`
- `feat!: change TODO.md section ordering rules`

Version impact:

- `fix:` → patch
- `feat:` → minor
- `feat!:` or `BREAKING CHANGE:` → major
- `docs:`, `chore:`, `test:` → usually no release

## Release process

1. Normal PRs merge into `main`.
2. Release Please opens or updates a release PR.
3. Merging that release PR creates the tag and GitHub release.
4. The release workflow publishes the tagged version to npm.

Key files:

- `.github/workflows/ci.yml`
- `.github/workflows/release-please.yml`
- `release-please-config.json`
- `.release-please-manifest.json`

## Trusted publishing

The intended production setup is **npm trusted publishing**, not a long-lived npm token.

Expected configuration:

- npm package: `pi-todo-md`
- GitHub repo: `forjd/pi-todo-md`
- trusted publisher workflow filename: `release-please.yml`

Important:

- npm's trusted publisher UI wants the **workflow filename only**
- not `.github/workflows/release-please.yml`
- the filename and repo match are case-sensitive

## Strongest recommended npm settings

Once trusted publishing is working, the strongest setup is:

1. keep trusted publishing enabled for `forjd/pi-todo-md`
2. do **not** store `NPM_TOKEN` in GitHub unless you explicitly need the fallback
3. in npm package settings, set publishing access to:
   - **Require two-factor authentication and disallow tokens**
4. revoke any old automation write tokens you no longer need

## Release debugging

If GitHub creates a release but npm does not update:

### Check the workflow logs

In the publish job, confirm you see:

- `Publishing with npm trusted publishing`
- a recent Node version (`v24.x` currently)
- a recent npm version (`11.x` currently)
- provenance output from npm publish

### Check repo/workflow config

Verify:

- `.github/workflows/release-please.yml` still has `permissions.id-token: write`
- `package.json.repository.url` still matches `git+https://github.com/forjd/pi-todo-md.git`
- the package is being published from the trusted workflow, not another workflow
- there is no unexpected `NPM_TOKEN` secret changing behavior

### Known release history note

GitHub releases `v0.1.2` and `v0.1.3` were workflow-fix releases during trusted-publishing setup and were **not** published to npm.
The first successful trusted-publishing npm release after `0.1.1` was `0.1.4`.
