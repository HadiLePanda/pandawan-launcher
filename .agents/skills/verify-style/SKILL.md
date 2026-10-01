---
name: verify-style
description: Use when changing CSS, Tailwind classes, or any visual layout — and before claiming a styling change "works" or "looks right". Covers unlayered custom CSS silently beating Tailwind's layered utilities, confirming rules reached the compiled bundle, detecting dead classes after a rename, finding gap-plus-margin spacing double-counts, and checking whether a layout issue is an environment problem or a real bug. Use after any edit to src/index.css, when a sizing or spacing utility appears to do nothing, or when the user reports a style "did not change". Not for pure TypeScript or Rust logic changes.
version: 1.0.0
---

This project mixes hand-written CSS in `src/index.css` with Tailwind v4 utilities. That combination has one dominant failure mode: **a utility that silently does nothing**, and no error anywhere.

## Check the compiled bundle, not the source

The source is not what the browser sees. Verify in `dist/assets/*.css` after a build:

```powershell
$c = Get-Content dist/assets/*.css -Raw
[regex]::Match($c, '\.my-class\{[^}]*\}').Value
```

If a rule is missing there, it is missing everywhere. If it is present, the next question is whether it wins.

## Unlayered custom CSS beats Tailwind utilities

Tailwind v4 emits utilities inside `@layer`. Hand-written CSS in `index.css` is **unlayered**. Unlayered wins over layered regardless of source order.

Consequence: `className="modal modal-auto max-w-md"` renders at `.modal`'s `max-width: 48rem`, because `.modal` is unlayered and `max-w-md` is layered. The utility is a no-op with no warning.

This applies to any `max-w-*`, `h-[...]`, `text-*`, `p-*`, `m-*` utility placed on an element that also carries a custom class.

**Rule:** when a utility must override a custom class, set the value in `index.css` as a scoped modifier and delete the utility from the JSX. Two rules with equal specificity means the outcome depends on file order, which is not a thing to rely on.

```css
.modal-auto { max-width: 23rem; }        /* real */
```
```jsx
<div className="modal modal-auto">        {/* not max-w-md */}
```

## Suspect the code, not the environment

When a style "did not change" after a restart, the default assumption should be that the code is wrong, because that is almost always true. A stale process is the rare case.

Observed: a user reported a dialog that looked unchanged three times. The cause was `.modal { display: flex }` with no `flex-direction`, so header/body/footer laid out as a **row** — left, middle, right. Two rounds were wasted asserting "stale HMR, restart it."

**Check the actual layout property before blaming the process.** A symptom described as "left, middle and right" is a row, not a stale cache.

## After every bulk CSS edit

**Brace balance.** A trim that cuts mid-rule produces a build error with no line number:

```powershell
$c = Get-Content src/index.css -Raw
'open=' + ([regex]::Matches($c,'\{')).Count + ' close=' + ([regex]::Matches($c,'\}')).Count
```

Must be equal. This is a two-second check that catches what the build reports as an unhelpful `CssSyntaxError`.

**Dead classes.** After renaming or removing a class, grep both files for the old name. Orphaned rules are silent rot:

```powershell
(Select-String -Path src/index.css,src/**/*.tsx -Pattern 'old-class-name').Count
```

**Token correctness.** `var(--ink)` is not a real token here; the tokens are `--ink-default`, `--ink-muted`, `--ink-dim`, `--ink-subtle`, `--surface-default`, `--surface-light`, `--border-default`. An invalid `var()` name is legal CSS and resolves to nothing, so text renders in the initial colour with no border and no background — and no error.

**Theme coverage.** The codebase has a `.light` block. Hardcoded hex in a component's styles will not adapt. Prefer existing tokens; if a new colour is genuinely needed, add it to both `:root` and `.light` with values that pass contrast in each.

## The gap-plus-margin hazard

A container with `gap` whose children also carry vertical margins double-counts on the same axis. Flex and grid do not collapse margins, so both apply.

```css
.download-row-body { display: flex; flex-direction: column; gap: 6px; }
.download-row-file  { margin-top: 6px; }   /* actual gap: 12px */
.download-row-files { margin-top: 4px; }   /* actual gap: 10px */
```

Three different spacings, one declared rhythm. Looks subtly wrong and cannot be reasoned about from the code.

**Audit command** — find every custom class carrying a vertical margin, then check whether its parent has a `gap`:

```powershell
Select-String -Path src/index.css -Pattern '^\.[a-z][a-z0-9-]* \{' -Context 0,6 |
  ForEach-Object { $blk = $_.Line + ($_.Context.PostContext -join ' ')
    if ($blk -match 'margin-(top|bottom):' -and $blk -notmatch 'margin:') { $_.Line -replace ' \{','' } }
```

Then trace each usage's parent in the TSX. A margin on a container relative to *its* parent is fine; a margin on a child of a `gap` container is the bug.

Note that `margin-top` and `gap` on the **same** element are different axes and are not a hazard.

## Spacing belongs to the container

When a child needs space, set it on the parent's `gap`. Item-level margins inside a spaced container are the root cause of this class of bug. If an item must deviate, say why in a comment, and keep the deviation the same value as the container's gap.

## Checklist before reporting a style change done

1. `npm run build` exits 0
2. `npm run lint` exits 0
3. Every touched rule is present in `dist/assets/*.css`
4. No stray `text-align` / sizing utility is fighting a custom class
5. Brace count balanced
6. No orphaned class names remain
7. Spacing on any axis is governed by exactly one mechanism
