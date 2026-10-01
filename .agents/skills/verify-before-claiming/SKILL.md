---
name: verify-before-claiming
description: Use when debugging a failure, especially one that has resisted a fix, or before reporting that something is fixed. Covers reproducing the actual error, distrusting your own first hypothesis, and why a passing check is not the same as a working feature.
version: 1.0.0
---

# Verify before claiming

Most of the wasted time in this repo came from a single pattern: proposing a
fix based on a plausible theory, then reporting success without checking whether
the original failure had actually changed. The theory was usually wrong. The
check that would have caught it was cheap.

## Reproduce the real error first

Before editing anything, make the original failure happen again and read the
message.

A hang that produced no output was diagnosed as a permissions problem and then
as a missing secret, across several rounds. Reading the log would have shown
`expect a prompt for password` on the first attempt and answered it immediately.

Silence is a symptom, not an absence of information. When a command produces
nothing, find out whether it is writing to a stream that is being dropped - a
redirect that never landed, a background process that lost its output - before
concluding that it did nothing.

## Distrust the first hypothesis

Every one of these was wrong at least once:

- "The pubkey format is wrong" - it was correct; the confusion was `decode` vs
  `from_base64`.
- "`--no-checksum` fixes the upload" - it does not; the fix is the
  `AWS_REQUEST_CHECKSUM_CALCULATION` environment variable.
- "minisign rejected the signature, so signing is broken" - minisign 0.12 cannot
  parse Tauri's comment at all.
- "The secret key is corrupted" - the key was fine; the key had been generated
  by a different tool.

A hypothesis is a starting point, not a finding. When one is contradicted, do
not patch around it - go back to the source. The authoritative answer is in the
dependency's code, not in a comment describing it, and the comment may itself be
what is wrong. In this repo a stale comment described an error that turned out to
have a different cause, which sent the investigation in the wrong direction.

## A passing check is not a working feature

These all passed while the feature was broken:

- the secret key file existed
- `tauri signer sign` succeeded on a probe file
- the pubkey was synced into the config
- CI reported a green build step

Each confirmed one link in a chain that had several. The only check that proved
anything was the one that used the artifact the way a user would - downloading
the published file and verifying its signature with the same library the
application uses.

Ask what a check would still report if the feature were completely broken. If the
answer is "the same thing", it is not testing the feature.

## Prefer the tool the system actually uses

When a check cannot tell a working system from a broken one, the problem is the
check. Use the dependency's own library rather than a lookalike:

| Instead of | Use |
|---|---|
| `minisign` CLI | `minisign-verify`, the crate the plugin uses |
| asserting a file exists | parsing it with the parser the app uses |
| reimplementing a transform | calling the one function in production |

## Be honest about uncertainty

Say "unverified" when something is unverified. Say which parts were checked and
which were not.

Claiming a fix worked, and being wrong, costs more than saying "I think this
addresses it, here is how we check." It also erodes the value of every earlier
claim, because the reader can no longer tell which were checked.

## Cost of a wrong fix

Some wrong fixes are recoverable and some are not:

- Renaming a variable or fixing a path: cheap.
- Regenerating a signing key: invalidates every published signature.
- Deleting a tag or release: rewrites a published ref.
- Reading a credential into a log: requires rotation by someone else.

State the blast radius before doing any of these, and ask when it is not
obviously safe. The user can say no in one second; an exposed key cannot be
un-exposed.