# AGENTS.md

`@lazco/pi-recap` is a pi extension with two commands, `/recap` and `/summary`.
Each command sends the conversation to a separate model call and shows the result in a popup.
In RPC mode, the result goes to the client as a `notify` request instead.
The result never goes into the session.

## Commands

| Command | What it does |
|---|---|
| `bun run check` | Type-check. |
| `bun run test` | Run the unit tests under node. |
| `npm run release -- <bump>` | Cut a release. See **Release** below. |

The package ships TypeScript source, so there is no build step.

## Layout

All source sits under `src/`.

| File | What it holds |
|---|---|
| `index.ts` | the two commands and the flow from the conversation to the popup or the RPC notification |
| `config.ts` | reads and checks `recap.json` in the pi agent directory |
| `conversation.ts` | turns the session branch into the transcript, inside the size limit |
| `generate.ts` | the two default prompts, the model choice, and the model call |
| `popup.ts` | the overlay with the spinner, the text, the scroll, and the copy key |
| `emphasis.ts` | the fix that lets the popup parse `**` bold and `*` italic next to CJK punctuation |

`scripts/release.sh` cuts a release.
`scripts/changelog-notes.sh` prints the `CHANGELOG.md` section for one version.
`.github/workflows/release-npm.yml` publishes one.

## Dependencies

Read `docs/packages.md` in the installed `@earendil-works/pi-coding-agent` before you add a dependency.

- A package that pi bundles goes in `peerDependencies` with a `"*"` range. Never bundle one.
- Any other runtime dependency goes in `dependencies`.

## Release

`npm version` owns the version number.
Never edit the `version` field in `package.json` by hand.

Every release has a `CHANGELOG.md` entry, and the GitHub release shows that entry.
Cut a release from `main` in this order:

1. Add a `## [<version>] - <YYYY-MM-DD>` section at the top of `CHANGELOG.md`, below the intro.
2. Add a `[<version>]: <compare-url>` link at the bottom of `CHANGELOG.md`.
3. Commit the entry and push `main`.
4. Run the release command:

```bash
npm run release -- <bump>
```

`<bump>` is `patch`, `minor`, `major`, `prepatch`, `preminor`, `premajor`, `prerelease`, or an exact version such as `<MAJOR>.<MINOR>.<PATCH>`.
Add `--dry-run` to run every check and print the plan without a change.

The script refuses to start unless the branch is `main`, the working tree is clean, `main` agrees with its upstream, and `npm run check` and `npm run test` pass.
It then runs `npm version <bump>`, refuses a version that has no `CHANGELOG.md` section or is already on npm, and pushes `main` and the `v<version>` tag.
If a step after the bump fails, it resets to the starting commit and deletes only the tag that this run created.

A push of a `v*` tag starts `release-npm.yml`.
The workflow reads the `CHANGELOG.md` section for the version, installs, type-checks, tests, reads `NPM_TOKEN` from Infisical, and publishes with provenance.
It then creates the GitHub release with the `CHANGELOG.md` section, followed by the notes that GitHub generates.
A missing section stops the workflow before the publish.
A version with a `-` goes to the `next` dist-tag. A normal version goes to `latest`.

The workflow needs this one-time setup:

1. The Infisical project `lazco-pi-recap`, env `prod`, path `/ci`, with `NPM_TOKEN`.
2. The repo variable `INFISICAL_CI_IDENTITY_ID`.
3. The Infisical machine identity, bound to this repo.

### Pick the bump

- `patch` for a fix only.
- `minor` for new user-facing behavior, such as a new key or command.
- `major` for a change that breaks a user setup.

### Write the changelog entry

- Write only changes that a user can see. Leave out CI, tests, and refactors.
- Group the items under `### Added`, `### Changed`, `### Fixed`, `### Removed`, or `### Docs`.
- Put each full sentence on its own line.
