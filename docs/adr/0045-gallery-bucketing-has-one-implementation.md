# Gallery bucketing has one implementation

The gallery block renders rows as cards, and the export writes a static snapshot of what it renders.
Both needed the same grouping rule — *empty values never aggregate, a one-row group lays out flat, a
≥2-row group folds into a stacked card, and an expanded group lays out flat again* — and both carried
their own copy: `buildUnits` in `GalleryBlockView.vue`, `galleryUnits` in `lib/html/serialize.ts`,
thirty-odd lines that matched statement for statement. `design/gallery-check` did not cover the
grouped case at all, so nothing would have noticed the day they diverged.

**They had already diverged, quietly.** The export drew `unit.lead` when a unit was flat; the editor
drew `v-for row in unit.rows`. Identical output only because the export never passes an expansion
predicate — every multi-row unit is stacked, and a flat unit is by definition one row. The bug was
one call away: pass "expanded" through and the export starts dropping rows.

## The decision

**`lib/gallery.ts` owns the unit split.** `galleryUnits(rows, column, isExpanded?)` — the predicate
is injected, so the editor passes its expanded set and the export passes nothing (a static file has
no "expand"; everything folds). The flat branch now emits one card per row on both sides, which
makes the two implementations agree by construction rather than by coincidence.

**Sectioning stays where it is, on each side.** `gallerySections` in the export and the `sections`
computed in the view both sit on `dt.groupRows` — already one implementation — but they differ in
where their inputs come from: the view reads a live `expanded` set and its tool bar, the export reads
`block.groupOrder` from the block's settings. Folding them together would mean one function with both
sides' parameters and neither side's context. The seam is: *how rows become units* is shared, *how
units become sections* is not.

## Consequences

- `design/gallery-check` gained a sixth section (7 assertions): three sections from one table, only
  the ≥2-row group folded, three cards total, the stacked card's lead is the group's first row,
  same-field grouping degrading to flat, empty values not aggregating, and "expanding changes
  `stacked` but not the grouping".
- Reverting `galleryUnits` to always `stacked: false` fails four of them.
- The export's `GalleryUnit` interface is now imported from `lib/gallery` instead of restated.

## Revisit if

The export gains an "expanded" setting of its own (then the predicate becomes a block setting rather
than a caller argument), or a third renderer of the same rows appears — a print view, a feed export.
