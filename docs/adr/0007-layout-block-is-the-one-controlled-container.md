# The layout block is the one controlled container

A Layout block arranges other Blocks side by side: grid mode lays its cells into 2–4 equal
columns, flex mode lines them up to wrap. Users reaching for it want what Notion calls a
column — real Blocks, editable in place, living inside a page-level arrangement. That want
collides head-on with this codebase's oldest invariant: **a Note is a flat list of Blocks,
not a tree**. Depth is a number, nesting is expressed on the flat list, and no Block owns
children.

The decision is to keep the invariant where it is enforced and bound it where it is not:
the top level stays a flat list, and `layout` becomes the **only** Block type that contains
other Blocks. Its `cells` field is a list of lists — each Cell an ordinary flat block list,
subject to the ordinary block rules (deleting the last block leaves an empty text block,
duplicating clones with fresh ids). One level of nesting, no more: a Layout block cannot
appear inside a Cell. That is enforced twice, because the two doors in are independent —
the type menu filters it out inside cells (`CELL_EXCLUDED_TYPES`), and `changeBlockType`
refuses a layout conversion whose target list is not the document.

Data table and Gallery blocks are excluded from Cells for a different reason: both point at
a `.tbl` file that must exist before the block can (`ADR-0005`), an async resolve-and-create
flow written for the top level. Cells keep the simple synchronous contract instead.

**Consequences.**

On disk the block is `<div class="note-layout" data-layout="grid|flex" data-columns="…">`
holding one `<section>` per Cell. Cell contents are ordinary block HTML — `layoutHtml`
recurses into `blocksToHtml`, and `parseLayout` runs each `<section>` through the existing
`parseContainer`. The parse ⇄ serialize round-trip therefore holds *inside* cells by
construction: container blocks add no second read/write dialect, they reuse the only one.

Attributes follow the Gallery precedent: read **leniently** (an illegal `data-layout` falls
back to grid, an out-of-range `data-columns` falls back to the default) and written **only
when non-default** — the default column count (2) is never stored, and flex ignores column
count entirely. A hand-edited file degrades to the nearest sane rendering instead of
rejecting the Note.

Block operations generalize instead of duplicating. `locateBlock(id)` returns the list a
block lives in plus its index; insert, retype, duplicate and remove go through it, so
top-level and in-cell Blocks share one code path and a splice on the returned reactive list
just works. What does **not** generalize is drag: the top-level drop-index computation uses
`:scope >` to count only top-level rows (a Cell's rows are also block rows; counting them
into the top-level sequence misaligns every index), and dragging from inside a Cell is a
no-op. In-cell reordering by drag is an accepted gap, not a half-rule.

`Block` gains its seventh shape with every structural dispatch arm following
(`isTextualBlock`, `createBlock`, `retypeBlock`, `cloneBlock`, `blockText`,
`blocksToHtml`) — `assertRegistryComplete` makes a missed arm a compile error. `blockText`
recurses into Cells so the character count covers what is arranged, not just what floats at
the top level.

**Considered.**

*A general tree of Blocks* — the Notion data model. Rejected: it voids the flat-list
invariant everywhere at once. Every block API grows parent-pointer plumbing, `depth` becomes
ambiguous, and serialization has to distinguish "block list" from "block's children" in every
document forever, for a feature that wants exactly one level of arrangement.

*Cells hold rich text only* (runs, not Blocks) — cheaper, no recursion anywhere. Rejected on
product grounds: a column holding only paragraphs cannot hold a list, a quote or a heading,
which is the everyday Notion arrangement the feature exists for.

*No block at all — CSS multi-column over a span of top-level blocks* — rejected: a
"span" is not a thing the flat list can express, so the grouping could not round-trip, and
balancing content across columns is a rendering decision the model cannot record.
