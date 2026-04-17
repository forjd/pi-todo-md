---
name: Release checklist
about: Maintainer checklist for verifying a release end-to-end
title: "[release] "
labels: [maintenance]
assignees: []
---

## Release target

- Version:
- Release Please PR:
- Tag:
- GitHub release URL:

## Pre-merge checks

- [ ] Release Please PR version looks correct
- [ ] Changelog entries look correct
- [ ] No accidental release-only noise needs explaining
- [ ] CI is green on `main`

## Publish checks

- [ ] GitHub release was created
- [ ] npm package version is live
- [ ] npm dist-tag `latest` points to the expected version
- [ ] Publish ran via trusted publishing
- [ ] Provenance was generated

## Install checks

- [ ] `pi install npm:pi-todo-md -l` works in a fresh repo
- [ ] `/todos` still loads correctly after install

## Package gallery checks

- [ ] npm latest manifest includes `pi.image`
- [ ] package appears in the npm search API for `keywords:pi-package`
- [ ] package appears on `https://pi.dev/packages`

## Security checks

- [ ] No `NPM_TOKEN` secret was required for this release
- [ ] Trusted publisher is still configured for `forjd/pi-todo-md`
- [ ] npm package settings still disallow legacy token publishing (if enabled)

## Notes

<!-- Paste links to workflow runs, npm package page, or anything odd here. -->
