---
name: ship-check
description: Use before committing or reporting any change as complete — decides which verification a change actually needs, so CSS edits are not gated on the full test suite and logic edits are not shipped on a green build alone. Covers the per-layer check matrix for this repo, the scratch-file rule for commit messages, and the rule that a fix is not fixed until the check that would have caught it has run. Use at the end of any implementation task, before "done", before every commit, and when asked whether something is ready.
version: 1.0.0
---

Running the full suite for a CSS tweak wastes minutes and proves nothing about the thing changed. Skipping the right check ships real bugs. This picks the right level.

## Check matrix

| Layer touched | Run | Not needed |
|---|---|---|
| `src/index.css` only | `npm run build`, `npm run lint` | tests |
| `.tsx` markup / class names | build, lint, `npm test` | — |
| `.ts` logic, store, services | build, lint, `npm test` | — |
| `src/locales/*.json` | **tests are mandatory** — the i18n parity test is the only guard on key drift | — |
| `src-tauri/**` | `cargo check --all-targets`, plus `cargo test` for behaviour | frontend tests |
| Publish scripts / `scripts/**` | the script's own `--dry-run` against the real bucket | — |

`npm test` is fast (16 files, well under a second), so it is cheap insurance for any TypeScript change. It is not cheap enough to run for a stylesheet edit, and it cannot see a CSS bug either way.

## The guards that catch what you cannot see

Two tests exist specifically because the failure is silent:

- **`i18n-coverage.test.ts`** rejects a locale key with no `t()` caller, and a key used but missing. It scans for string literals passed *directly* to `t()`. A key selected in a variable, or chosen by an inline ternary, reads as unused. When plural or conditional keys are needed, call `t()` in each branch with a literal.
- **`settings-schema-parity.test.ts`** fails if Rust and TypeScript settings structs drift.

If you add UI strings, the failing test is usually correct and you added a key you never called.

## Reporting a fix

A fix is not a fix until the check that would have caught the original bug has run.

Observed: a green `npm test` sat next to a completely broken `cargo check`, because a capability file had invalid JSON. Frontend tests never parse it. "Tests pass" was true and meaningless.

State what you ran. If a change was CSS-only, say `build + lint`. If a bug could not be reproduced, say that rather than claiming it is resolved — an unverified "fixed" is worse than an open item, because it stops anyone looking.

## Commit hygiene

**Do not write scratch files into the repository root.** `COMMIT_MSG.txt` was committed eight times before being caught.

Use:

```
git commit -m "short single line"
```

For a multi-line message, use `-m` per paragraph, or write the file to the OS temp directory. If a scratch file is created in the repo, confirm `.gitignore` covers it.

Before committing:

```powershell
git status --short
```

An untracked scratch file is visible there. `git add -A` will pick it up.

## Committing

One logical change per commit. The message states what changed and, where non-obvious, why — especially when the reason is not recoverable from the diff.

```powershell
git add -A
git commit -m "fix(verify): drop the valid count, which only restated the progress ratio"
git status --short   # expect empty
```

## Before saying "done"

- [ ] The checks for the layers touched have run, this session, and passed
- [ ] A fix was verified by the check matching the bug, not by a nearby one
- [ ] No dead code, orphaned class names, or unused locale keys were left behind
- [ ] `git status --short` is empty afterwards
- [ ] Anything unverified is stated plainly, not glossed
