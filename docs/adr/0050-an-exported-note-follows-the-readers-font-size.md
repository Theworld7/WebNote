# An exported note follows the reader's font size

A note file is the one artefact that leaves the app. Everything else is rendered by us, on our
terms, with our stylesheet; a `.html` on disk is opened by a browser we have never seen, on a
machine we cannot inspect, at a text size we did not choose. ADR-0043 accepted that by keeping the
export's type in px: *"it is a snapshot for someone else… letting a setting in my app change how the
file looks on their machine is the wrong kind of magic."* The reasoning was right; the conclusion
covered too much.

Two things were wrong with px, and they are not the same problem.

**On a phone the note was 14px.** Not "small relative to the window" — literally 14 CSS pixels,
because that is what `font: 14px/1.6` computes to and the viewport meta already does its job
(`width=device-width, initial-scale=1`). The 720px measure that 14px was chosen for (ADR-0027) is
not even reached: on a 390pt screen the column is 342pt wide and every line is a short, narrow
column of small characters.

**And px ignores the reader entirely.** Someone who has raised their browser's default text size —
the standard accessibility answer, and the only knob a low-vision reader has — saw a note rendered
exactly as if they had not.

## The decision

**Every `font-size` in `DOC_STYLE` is rem.** Thirty-four hard-coded card sizes, the body, and the
six headings (all derived through `remOf`). At the default 16px root this is pixel-identical to what
was there before — `typography-check`'s entire export section passes unchanged, which is the point:
the change is invisible until a reader has actually set a preference. Two absolute line heights
(`17px` / `14px` on the bookmark card) moved too, or the new sizes would have inherited a leading
meant for the old ones.

**`html { font-size }` is deliberately absent.** Writing `16px` there would have locked the rem
scale back to pixels and bought nothing; writing a percentage would have made the export follow
*our* preference through a side door. Leaving it unset is the whole feature: the root falls back to
whatever the browser is configured for, and the note quietly honours it.

**The narrow branch sets sizes, not the root.** One line — `@media (max-width: 640px) { html {
font-size: 114.2857% } }` — would scale the entire sheet, and it is the obvious move given everything
above. It is also wrong: every other rem in the file scales with it, so the `3rem / 1.5rem / 6rem`
body padding grows to 55/27/110 at a moment when it should shrink, and the empty-layout `min-height`
and `min-width` grow with it. The narrow block therefore writes `body { font-size: 1rem }` and six
heading sizes, and leaves the geometry's rem baseline at 16px so a padding value still reads as the
pixel number it was chosen as.

**The narrow sizes are the whole scale at 16/14, not just the body.** Body text alone would have
been the smaller change and the worse one: h4–h6 are 16px on the desktop, deliberately only 2px above
the 14px body (ADR-0027), so raising the body to 16 makes four levels of heading exactly body-sized
and deletes the hierarchy. 30/22/18/16 becomes 34/25/21/18 and every ratio survives.

**Three grids stop pretending to be multi-column.** Layout blocks drop to one column, bookmark
grids to at most two, and the subscription summary flips from `grid-auto-flow: column` to a 2×2 —
at 342pt of usable width, four columns is 76pt each, which is a vertical stack of single characters
rather than a card. The summary's vertical divider is drawn by `::before` on every stat, so the two
left-hand cells get their divider suppressed; otherwise the 2×2 shows a double rule against the
frame edge.

**Not done: tables.** A multi-column ledger or table snapshot is still squeezed into 342pt, because
making it scroll needs either a wrapper element in the serialised HTML (which would have to survive
the parse round-trip) or `display: block` on `<table>` (which fights the exported frame radius). That
is a separate decision with a real cost, and it is not what "the text is small" was asking about.

## Consequences

- ADR-0043's *"its type stays in px"* is superseded. Its actual constraint — the app's base-font
  preference must not leak into the file — still holds: `DOC_STYLE` reads no settings, and the rem
  root belongs to the reader, not to us.
- ADR-0027's "editor and export look the same" is now conditional on the reader's default being
  16px, exactly as ADR-0043 already made it conditional on the app's step being the standard one.
  Both defaults are the case the check page measures.
- `typography-check` grew a narrow section (390px iframe: body 16, h1 34, h2 25, h3 21, h4 18 and
  not equal to the body, padding 24/16/48) and a root-size section on the desktop frame (set the
  iframe's root to 20px, expect 17.5 and 27.5) — 73 assertions total. The root-size pair is the only
  assertion that can tell rem from px; without it the conversion is unprovable.
- Existing notes do not change. The stylesheet is embedded in each file, so a note carries whatever
  `DOC_STYLE` was current when it was last saved, and picks up the new one on its next save or on a
  batch export.

## Revisit if

The export ever gets a wrapper element budget (then tables scroll properly), or if a reader-visible
"compact / comfortable" toggle is wanted in-app — that would be a per-file decision and belongs in
the document, not in the reader's browser.
