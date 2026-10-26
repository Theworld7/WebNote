# Marquee selection picks whole blocks, and only the text-shaped ones

Every block operation so far addressed **one** block: the handle menu, `/` on an empty line, the
`+` menu, drag. The one gesture that spans several blocks, `lib/crossselect`, deliberately
selects something else — **runs**: an anchor and a focus point, each carrying a character offset
inside a block. That model can copy seven paragraphs and delete them, and it cannot answer the
question "make these seven rows H2", because it never holds a row.

Batch conversion and batch delete therefore need a second kind of selection — a **set of block
ids**. The desktop's rubber band is the gesture users already know for "these ones, together",
so the design question is not *what* the band does, it is where it may start.

## The decision

**A band starts only outside every block row.** Press inside a row and you are selecting text;
press in the left gutter, in the 16px between two rows, or in the right margin, and you are
selecting blocks. This is the entire split, and it is chosen because of what a row contains: on
a text block the editable body covers nearly every pixel of the row, so any other rule (a
modifier key, a long-press, a threshold on distance) would have to be remembered rather than
inferred. `crossselect` keeps its own press-inside-a-row path untouched.

**The hit test is vertical only.** A row spans the whole content column, and the band can only
begin in empty space, so its horizontal extent carries no intent — dragging straight down the
right margin means the same thing as dragging down the middle. Requiring 2D overlap (the way
desktop icons do, where icons are separated horizontally) would make that gesture select nothing.

**Only the ten text-shaped types can be selected**: the menu registry's 基础 and 列表 groups —
`text`, `h1`–`h6`, `todo`, `ul`, `ol`. The list is derived from the registry's `group` field
(`BATCH_RETYPE_TYPES`), not written out a second time. Everything else is **skipped**: a band that
sweeps across an image, a table or a layout block leaves it unselected and untouched, and the
rows on either side are still picked up. Batch conversion is per block and "per block" only means
something when the target shape can hold each block's own runs; converting a batch to an image
block would be batch deletion wearing another name.

**Conversion is per block, never a merge.** N blocks in, N blocks out, each keeping its runs and
its depth. Merging would turn seven paragraphs into one list item, which is not what "select
these and make them a list" says.

**Conversion replaces the blocks (ADR-0015), so the selection is rebuilt from the returned ids.**
`retypeBlocks` hands back the new ids in the order they were asked for; the bar reassigns the
selection to them and re-measures the highlight. Without that step a conversion scatters the
selection — every id it held now belongs to a block that no longer exists.

**Deleting the selection deletes the batch**, and refills one empty text block if that empties the
document — the same rule a single-block delete follows. No confirmation: Ctrl+Z is one step back,
and a batch delete that asks "are you sure" is a batch delete nobody uses.

**The band paints the selection colour at 12%** (`.block-select-band`), and the selected rows
reuse `.cross-selection-rect` — "selected" is one idea in this UI (ADR-0025), so the two gestures
do not wear two colours.

## Consequences

- `mousedown` routing on the document now has three owners, in this order: the floating bar
  (return immediately — pressing a button there must not clear the selection it belongs to), a
  drag handle (block drag), a block row (text selection), anything else (band). The order matters:
  the bar lives inside the document container, so it would otherwise be the "empty space" case.
- The band's origin is stored in **document** coordinates, not viewport ones. Auto-scrolling
  while dragging moves the content under a stationary pointer; a viewport origin would drag the
  band's top edge along with it.
- The bar's 「转为…」 menu is controlled (`:open`), not internal. Picking an item re-renders the
  bar — the blocks are new, the highlight is re-measured — and the menu must close as part of the
  action rather than race that render.
- Layout cells are out of scope, exactly as they are for `crossselect`: a cell's world is its own
  container (ADR-0007), and a band started inside one has no top-level meaning.
- `design/block-select-check.html` drives the real gesture: it drags a band over a seeded document
  that includes an image and a divider, asserts the six text-shaped rows are picked and the other
  two are not, converts the batch, and checks the selection survived the id change.
