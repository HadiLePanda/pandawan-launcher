---
name: safe-edit
description: Use when editing, restructuring, or renaming existing source files — especially JSX/TSX, CSS, or any file over ~100 lines. Covers how to apply a change without destroying neighbouring code, recovering when an edit silently fails to match, and the line-slicing shell pattern that silently deletes whole files. Use before any multi-file refactor, when an edit tool reports "text not found", or when a previous attempt corrupted a file. Not for creating genuinely new files, and not for one-line typo fixes where a direct edit obviously cannot overreach.
version: 1.0.0
---

Lost work is the most expensive failure mode in this repo, and it is entirely procedural. Three incidents in a single session destroyed real code that had to be recovered from git. Every rule here exists because ignoring it cost something.

## The core rule

**Structural edits go through the editor tool. Never through the shell.**

A source file is not a list of lines to be sliced. It is a structure with braces, tags, and invariants that a line-range operation knows nothing about.

## Never line-slice source

This is the pattern that destroys files:

```powershell
$l = Get-Content file.tsx
($l[0..89] + $l[92..($l.Count-1)]) | Set-Content file.tsx   # WRONG
```

It is only safe if you have *just* read the exact line numbers and confirmed the boundaries. It is never safe when:

- the line indices came from a stale read
- prettier has reformatted the file since
- the region contains multi-line structures (JSX blocks, CSS rules, comments)
- the operation is a truncate (`$l[0..N]`) — this drops everything after `N`

**Observed cost, three times in one session:**

| Incident | Loss | Recovery |
|---|---|---|
| Truncated a 192-line component to strip a leftover block | whole file | `git checkout` |
| Split a hook into its own file via substring | 34 lines from the top of `utils.ts` — `cn`, `formatBytes` and 4 others | `git checkout` |
| Trimmed a CSS block by line range | unbalanced braces, build failed | manual repair |

In all three, `git checkout -- <file>` restored it, and all three were avoidable.

If a genuine shell edit is truly necessary, do it **additively** (append with `Add-Content`, or targeted `node -e` string replace on a full read), never by index arithmetic.

## Re-read before every edit

`old_text` is matched against the file **as it is now**. Anything that reformats between your read and your edit invalidates the match.

Prettier runs on nearly every file touched here and will:

- wrap a long `transition` onto multiple lines
- expand a one-line rule into a multi-line block
- reindent after a neighbour changes

**So:** read the file immediately before editing it. If you edited it two steps ago, read it again. A failed `old_text` match is not a puzzle to guess at — it means the file moved, and the correct response is a fresh read, not a retry with adjusted whitespace.

Never "fix" a failed match by loosening the `old_text` from memory.

## Read back after multi-file changes

After editing several files, or any file over ~100 lines, read the changed regions back before moving on. Confirm:

- the intended change landed
- nothing adjacent was clobbered
- the file still has the structure you expect (matching braces, a closing tag per opener, a function terminator)

A replacement that matched once can still delete more than you intended, because `old_text` was larger than you thought or the file had drifted.

## Before truncating or removing

If the goal is "delete this block," prefer an editor call whose `old_text` **includes** the block and whose `new_text` omits it. That is atomic: either the block was there and it is now gone, or nothing changed.

Never "find the line, truncate to it." Prefer:

1. Read enough context to see both boundaries.
2. One editor call spanning the whole block.
3. Read back to confirm the seams.

## Recovery

If a file is already corrupted and the last commit was clean:

```
git checkout -- path/to/file.tsx
```

Then re-apply the change with the editor. Do not attempt to repair corruption with the same shell technique that caused it.

## When to ignore this

- Creating a brand-new file with no existing content to protect
- A one-line change where `old_text` is short and unique
- Formatter-driven rewrites (`prettier --write`, `cargo fmt`) — these own the file

## What this skill prevents

| Symptom | Cause |
|---|---|
| `error TS2305: no exported member 'cn'` across many files | top of a file was truncated |
| `CssSyntaxError: Missing opening {` | brace imbalance from a bad trim |
| Edit tool reports "text not found" | stale `old_text`; re-read |
| Build fails only after a "successful" edit | read-back was skipped |
