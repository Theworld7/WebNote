# Gallery blocks travel as a snapshot with a pointer alongside

A Gallery block renders a Data table as a grid of poster cards. Its data lives in the
referenced `.tbl` — the same source a Data table block reads — but unlike the Data table
block, a Gallery block also carries **presentation settings**: column count (`"auto"` or a
number), image aspect ratio (`"2:3"`-style width-to-height), image fit (`cover` /
`contain`), and a list of hidden field ids. Those settings are part of the block, not part
of the table: two Notes gallery-ing the same `.tbl` are free to present it differently.

On the way out, the block is written as `<table data-gallery="…path…" data-columns="…"
data-ratio="…" data-fit="…" data-fields="…">` followed by the table's **current contents** —
the same snapshot shape a Data table block produces, data-URI images included.

The forcing requirement was that **the settings survive a save-and-reopen**. A Data table
block can afford ADR-0005's pure snapshot because it has nothing to lose: its only datum, the
path, is re-pointable in one click. A Gallery block's settings are configured work — hiding
three of nine fields, pinning four columns — and re-doing it after every reopen is the kind
of small, repeated tax that turns a feature into a nuisance.

**Consequences.**

The export carries both a snapshot and a pointer. This does **not** reopen ADR-0005's
rejection of pointers: that decision refused a pointer *instead of* contents, which left the
exported file empty of its table, and refused *inferring* a reference from an unmarked
`<table>`, which needs a guessing rule. A `data-gallery` attribute is neither. The contents
are still written in full, so the double-click promise holds — a mailed file reads as a plain
table with its images inline. And the reference is not inferred but *declared*: the file says
it was a gallery, so restoring one is reading, not guessing.

`parse.ts` restores a `<table>` carrying `data-gallery` into a live Gallery block, reading
path and settings from the attributes and discarding the snapshot rows — the live data comes
from the `.tbl`. Attributes are read **leniently**: an illegal or missing setting falls back
to its default (auto columns, poster ratio, cover fit, all fields visible) rather than
rejecting the note.
A stripped attribute — a third-party editor, an older build — degrades the block to a plain
Table block, which is exactly ADR-0005's behaviour and remains the correct reading of what is
now in the file. A table written when the `.tbl` was unreadable still carries its attributes,
so settings survive even a failed reference; the reopened block shows its missing-table state.

`data-fields` stores **column ids, not names**. `renameColumn` and `setColumnType` both keep
ids stable; names are display sugar and change on a keystroke. Ids of deleted columns linger
in the list and are filtered out at render time against the table's current columns — no
cleanup pass is needed, because a hidden field that no longer exists is simply never shown.

Attributes are written **only when non-default**, aligning with how `TableBlock` omits unset
column alignment. A default-configured gallery differs from a data-table snapshot by exactly
one attribute, and a human reading the file sees the difference without noise.

`Block` gains a sixth shape, `gallery`, with every structural dispatch arm following
(`isTextualBlock`, `createBlock`, `retypeBlock`, `cloneBlock`, `blockText`,
`blocksToHtml`) — `assertRegistryComplete` makes a missed arm a compile error.

Settings changes go through the **note's** save flow (`updateGalleryBlock` + `markDirty`),
not the table's: they mutate the note document, because that is where the block lives. The
`.tbl` is untouched by them, and stays un-dirty in the tab bar.

**Considered.**

*Pure snapshot, settings lost on reopen* — the ADR-0005 shape. Rejected on the forcing
requirement: settings are configured work, and the only thing ADR-0005's pure snapshot
protects against (a pointer rendering as nothing) is avoided here anyway, since contents are
written regardless.

*Settings stored in the `.tbl`* — the table would carry presentation state that only some
viewers use, two Notes could no longer disagree about appearance, and the file format grows a
view-config section for a concern that belongs to the note. Rejected.

*Settings recomputed each session (not persisted at all)* — rejected outright; it makes
"hidden field" a lie that resets on reopen.
