# Dashboard redesign — decisions and rationale

Agreed with the user during the dashboard audit. This file records _why_ each
decision was made, because several of them reverse an earlier decision and the
reasoning is the part that would otherwise be lost.

## Structure

The dashboard is **not** a games app. Games is one section of it.

```
Games | Launcher | Website | Services | Commands     ← top level

Games    → [game list column] + Metadata · Artwork · Builds · News · Prune
Launcher → launcher releases + catalog CRUD
Website  → what the site renders, git state, verify, deploy
Services → local dev servers
Commands → copyable command reference
```

All five sections are permanent rail entries. Only Games needs a selection, so only
Games shows the game list column; the other four render full-page and the rail keeps
all five sections visible, so "not everything revolves around a game" is visible
rather than inferred from a hidden control.

Launcher owns the catalog because the catalog _is_ the launcher's game index —
both answer "what does the launcher show".

## Artwork: pick from the bucket, upload separately

**Decision.** Choosing an icon or banner picks from the images already in R2,
shown as thumbnails. Uploading a new file is a separate, explicit action.

**Why this and not fixed filenames.** The obvious design is `icon.png`, where
uploading replaces the file in place. That was tried and reverted: the CDN serves
build bytes under `immutable, max-age=31536000`, so a stable name means a client
that already downloaded the art can _never_ learn it changed. The workaround was
`NO_CACHE`, which made every launcher launch re-download megabytes of artwork and
showed up as slow cards and layout shift.

Names are therefore content-addressed (`icon-<hash8>.<ext>`). A changed image
lands on a new URL, the old URL stays valid forever, and clients pick up new art
only by reading a manifest that names it. That is why replacing art never
overwrites: superseded objects accumulate.

**Consequence the UI must handle.** The bucket holds every version of an image and
records no mapping from object to field. So the picker lists all of them, marks
which one the field currently points at, marks the rest as superseded, and treats
"these cost storage" as something to show rather than hide. Pruning them is a
deliberate act.

## No typed local paths

**Decision.** The "path to a local image" text input is gone. A browser file
picker and a bucket picker are the only two routes.

**Why.** A browser cannot report an absolute path from a file input, so the typed
box existed to bridge that gap — and it invited the failure where the operator
pastes a path from another machine, or leaves the previous game's path in place and
publishes this game's art from the wrong folder. The gap is closed properly by
`POST /api/art/stage`, which posts the bytes and returns a real path the existing
`--icon-file` flow uploads. The picker already used that route; the text box was
redundant with it and strictly more error-prone.

## Controlled vocabularies

**Decision.** Genres, platforms and channels are selected from a list rather than
typed. The list is the set of values already in use across the catalog, plus a
**Manage** action to add a new one in one shared place. Invented values stay
possible through an explicit free-text entry.

**Known limitation, stated plainly.** This is not a fixed vocabulary. The dropdown
is derived from what other games happen to use, so two games can drift onto
different spellings of the same thing (`Multiplayer` vs `Multi-player`). That is
the exact inconsistency this is meant to remove, and it is only mitigated, not
solved: on save, near-duplicate values are flagged so the drift is visible rather
than silent. A truly fixed vocabulary would be one versioned file that the
dashboard, the publisher and the launcher all read — worth doing if the drift
actually shows up in practice.

Channels are the exception and are already fixed: `stable | beta | alpha` is a
closed set in `scripts/lib/metadata-fields.mjs`, mirrored in the launcher frontend
and validated by `src/lib/channels.test.ts`.

## Builds: history first, automation second

**Decision.** The Builds tab is a **history table** for the selected game — version,
build number, per-platform presence, ship time, and which one is current. Prune
becomes "select rows to delete" from that same table rather than a separate form
with its own game and channel inputs. Publishing asks only for the version bump
and the build folder; everything else is derived.

**Why the derivation matters.** These were all manual and all error-prone:

- build number is a per-game counter, so the next one is _max published build + 1_.
  Taking the minimum risks republishing over a build that exists.
- version comparison must be **numeric per component**, never a lexicographic sort.
  `versions.sort()` puts `0.4.9` after `0.4.10`; that shipped as a visible bug and
  the bug recurred in a second place. One shared helper backs both the card and the
  suggester.
- platform directories describe local build output and cannot be inferred, so
  switching games must **clear** them — carrying the previous game's paths over
  publishes this game's files from another game's folder.
- the executable name follows the game id by convention (`<gameId>.exe`).

## Visual language

**Decision.** A dense professional tool: tighter spacing, two-column metadata
form, real surface fills instead of white outlines on black, muted chrome with
colour reserved for state.

The specific complaint was "white outline and black, hardly readable" — a dark
canvas with low-contrast borders and no surface hierarchy, so everything reads as
the same weight. The fix is surface contrast and type hierarchy, not more colour.

### One rail, and it is the navigation

There is a single permanent left rail: brand, then the five sections with icons.
The section is the only thing the rail carries, and nothing reflows when it changes.
A section bar across the top plus a separate game rail was tried and rejected: it
splits navigation across two places and makes the whole page jump on every section
switch.

The rail is never hidden and never changes with the selection — switching to
Launcher or Website must not make the sections you came from disappear, which is
what "the rail is the navigation" means. The game list is **the Games page's own
left column**, not a rail: it is the master list of the section that owns it, so it
appears only while Games is active and nothing is reserved for it elsewhere. Adding
the list into the rail is the crowding this decision exists to avoid.

The relationship between a section and the thing it acts on is carried by the page
header instead of by a shared column: the header names the selection ("Games ›
Misspell · alpha"), so a full-page section never has to explain why it is not
showing a game.

### Show, don't tell — stated as a budget

**Cut hard.** Descriptive paragraphs are deleted, not shortened. The dashboard
carried ~430 words of on-screen prose across eight files; that is the ceiling now,
and most of what remains is a load-bearing warning rather than description.

What survives:

- **Labels and values.** `windows 0.4.11 #7`, not "Windows is running version…".
- **Status words.** `in sync`, `out of sync`, `1 behind`, `not published`.
- **Exactly one line where a sentence prevents a mistake.** The website deploy
  button says it hits the live public site. That is the exception, and it exists
  because the alternative is a destructive action with no warning.

What does not survive: ledes, scope explanations, "what this page is for" prose,
and hints that restate what the layout already shows. If a section seems to need
explaining, the layout is wrong — fix the layout instead.

**Prefer showing over describing.** A thumbnail beats a URL box. A status dot with
its word beats a sentence about status. A version ladder beats a paragraph
comparing two versions. Real state beats an explanation of what state would mean.

### Consistency is a constraint, not a goal

Every page follows one skeleton, in this order: **header (title + facts +
refresh) → tabs → content**. A page that invents its own arrangement is a bug even
if it looks fine alone, because it costs a re-orientation on every switch. Games is
the reference: a dense value-first header with no redundant nesting, and every
other section is measured against it.

The failure that prompted this: the Launcher page wrapped its content in a
`GlobalPanel`, added a page heading, then a scope paragraph, then a sub-tab strip,
then another heading inside the panel — four levels of framing for what is one
header and a form. Nesting that restates context is the thing to avoid.

### Two fonts, with one rule

Sans for all UI text and labels. Mono **only** for things that are literally code
or identifiers: version strings, build numbers, SHAs, file paths, command lines,
URLs. This is the convention the launcher frontend already uses.

The rule was needed because mono had crept into ordinary labels — `font-mono`
appeared in 35 places, including status text like "in sync" where it is pure
inconsistency. Numerals lining up in a column is a real benefit of mono; a
sentence set in mono is not.

### Icon-only controls, and the accessibility rule that goes with them

An icon button next to the word "Edit" says the same thing twice. Inside a table
row that repeats once per game, the redundancy is multiplied into noise, so
destructive and edit controls are **icon-only with an accessible name** —
`aria-label` naming the specific row ("Delete Misspell from the catalog"), never
a bare icon.

The non-negotiable part: **colour is never the only signal.** Every state pairs
colour with a word or a glyph, which is why the channel badges below keep their
text.

### Channel identity is colour-coded

Channels get distinct hues so a column of them is scannable without reading:
`stable` reads as calm/production, `beta` as intermediate, `alpha` as the
earliest. They are tokens in the palette like the platform hues, so the same
channel is the same colour everywhere it appears — rail, table, header.

Because colour alone is not accessible, the channel name stays written in the
badge. The colour is the fast path; the word is the accessible one.

Rules that carry over from the previous pass because they were deliberate:

- `--ink-subtle` / `--ink-faint` greys were chosen for WCAG AA on 11px labels.
  Contrast must not regress below 4.5:1 on any surface.
- Platform hues (`--win` / `--mac` / `--linux`) are a scanning aid and stay.
- The empty-cell hatch in the inventory grid is deliberately faint (0.013 alpha);
  a brighter one out-competed real data.
- Colour is never the only signal — every state pairs it with a word.
