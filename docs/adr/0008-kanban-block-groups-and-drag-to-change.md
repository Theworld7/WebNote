# Kanban blocks group a Data table by one column, with cards that drag to change that column's value

A Kanban block renders a Data table as a set of **columns** — one per distinct value of a chosen
group column — with each row drawn as a sticky-note card under its column. Cards are draggable
across columns, and dropping one onto a column rewrites that row's group-column value to the
column's value. Like Gallery and Bookmark blocks, its data lives in the referenced `.tbl`
(ADR-0005); the block carries only the path plus two presentation settings: the group column id
and an ordered list of card-display column ids.

On the way out, the block is written as `<table data-kanban="…path…" data-group="…columnId…"
data-fields="…id,id,…">` followed by the table's **current contents** — the same snapshot shape
a Gallery block produces (ADR-0006), data-URI images included. `data-fields` stores **displayed**
column ids (positive selection), which is the opposite sense from Gallery's `data-fields` (hidden
ids, negative). The two never collide because they live on different block attributes and the
parser routes by `data-kanban` vs `data-gallery` first.

**Consequences.**

The snapshot-plus-pointer stance is ADR-0006's, restated for a new block rather than relitigated:
contents are written in full so the double-click promise holds, and the pointer is *declared*
(`data-kanban`), not inferred — `parse.ts` restores a `<table>` carrying it into a live Kanban
block, reads path and settings leniently, discards the snapshot rows. A stripped attribute
degrades to a plain Table block, which is ADR-0005's behaviour and remains the correct reading.

Drag-to-change-value writes the group column's **native** value, not the column-header text.
Each group carries its `value` (a `DataCellValue`: for `select` the option id, for `text` the
string, for `number` the number, for `date` the `"YYYY-MM-DD"` string, for `checkbox` the
boolean) and the drop handler does `setCell(row, groupColumnId, target.value)`. No reverse
parsing of a formatted header is needed — the value travels with the group, not its label.
The "ungrouped" column (rows whose group value is `null` / `""`) sits leftmost and its value is
`null`, so dragging into it clears the group field.

The group column is **any** column type, not just `select`. A `select` column is the natural fit
(closed set, one card per option), but `text` / `number` / `date` / `checkbox` all work: a value
is a value, and grouping by it is well-defined. Restricting to `select` would push users to add a
status column just to get a board, when the column they actually mean to group by already exists.

Card background colour is a **fixed** light tint derived from a hash of the row id — same card,
same colour, every render. It is view state, not data: it is not written to the `.tbl` (the table
has no colour field) and not written to the note's snapshot (a plain `<table>` has no per-row
background). Reopens recompose it from the id; the exported file stays a clean table. "Random per
open" was rejected: a card that changes colour every time you look at it is a jitter, not a
feature, and the exported HTML could not reproduce it.

Empty-value rows are **shown**, collected into a leftmost "ungrouped" column. Hiding them was
rejected: a board that silently drops rows whose group field is empty is a board that lies about
how many things it has, and the natural fix for an ungrouped row — drag it into a group — needs
it to be visible.

`Block` gains a ninth shape, `kanban`, with every structural dispatch arm following
(`isTextualBlock`, `createBlock`, `retypeBlock`, `cloneBlock`, `blockText`, `blocksToHtml`) —
`assertRegistryComplete` makes a missed arm a compile error. `CELL_EXCLUDED_TYPES` includes it:
a Kanban block, like the other file-referencing blocks, needs the table-picker dialog that lives
on the top-level editor, not a parallel path inside a layout cell.

Settings changes go through the **note's** save flow (`updateKanbanBlock` + `markDirty`); the
`.tbl` is untouched by them. Card-drag value changes go through the **table's** save flow
(`mutate` + `markTableDirty`): they edit the table, because the group-column value is the
table's data, not the note's. Two Notes viewing the same `.tbl` as boards see the same row values
— a drag in one moves the card in the other.

**Considered.**

*Group by `select` only* — rejected. A status column is the common case, but forcing a `select`
column to get a board makes users add one just to board an existing `text` field. Grouping by any
column's value is well-defined; the type only shapes how the value is stored and labelled.

*Card colour random per open* — rejected. A card repainting itself on every render is jitter, and
the exported snapshot cannot reproduce it. A stable id-hash tint gives the sticky-note feel without
either cost.

*Hide empty-value rows* — rejected. A board that hides its ungrouped rows hides how much work
remains uncategorised, and blocks the natural drag-to-categorise gesture for exactly the rows that
need it. Show them, leftmost, labelled "未分组".
