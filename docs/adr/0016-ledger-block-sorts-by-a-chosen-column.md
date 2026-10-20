# The ledger block sorts by a chosen column, newest first by default

A Ledger block gained two settings: a **sort column** and a **direction**. Rows are ordered by
that column before they are sectioned, so "group by month, sort by date, descending" reads as
one book from the newest entry back. The settings belong to the block, like the money columns
and the grouping — two notes can read one table in two orders.

The forcing case was a daily-expenses book: entries are typed in as they happen, so the table's
row order is *entry* order, and once the dates are not monotonic the account is unreadable.
Ordering is the view's job; the `.tbl` keeps no row order at all (a data table has no order
field, deliberately).

**Consequences.**

`LedgerBlock` gains `sortColumnId` and `sortDirection` (`"asc" | "desc"`, default `desc`). The
sorting lives in `lib/ledger.ts` as `ledgerSort` / `sortRows`, consumed by both the view and
`ledgerHtml` — the same single-source rule the money math follows.

**Blank cells sort last in both directions.** A blank is not "the smallest value", it is a row
that is not on this axis; letting it jump to the top under `desc` puts a wall of empty rows in
front of the account. Sorting is **stable**, so rows sharing a value keep their table order —
"sort by type" leaves each type's entries in entry order.

**The month sections follow the direction.** With `desc`, the most recent month is sectioned
first. Section order is a property of the block's reading direction, not of the sort column, so
there is one rule rather than a conditional. When nothing is sorted the sections stay ascending,
exactly as before — a block that never set a sort column cannot be flipped by the direction
field merely holding its default.

**Balance is untouched.** It still accumulates over the table's own row order (ADR-0009): what
the account held after a given entry does not depend on how you later chose to look at it. A
descending book therefore shows a descending balance column, which is what each entry left
behind. The row numbers, by contrast, follow the **display** order — the number is "which row am
I looking at", and Enter steps to the row visually below.

**Defaults are written, not inferred.** Creating a ledger block (with the preset table) points
the sort at the preset's date column, descending. Nothing guesses a date column for a block that
already exists: a table may hold several (`记账日` / `发生日`), and ADR-0009 already refused to
guess one for month grouping. An existing block keeps its row order until someone sets a column.

On disk the pointer grows `data-sort` (column id) and `data-sort-dir`, the latter written only
for `asc` — `desc` is the default, following the same "the default never lands in the file" rule
as `data-balance` / `data-link-shape`. A missing or unreadable `data-sort-dir` parses as `desc`;
a `data-sort` naming a column that no longer exists degrades to unsorted at render time.

**Considered.** *Sorting stored in the `.tbl`* — rejected: it is a view setting, and the table
is shared by any number of notes and blocks. *Sorting by group order instead of a column* —
rejected: it cannot express "newest first inside each month" without inventing a second ordering
layer. *Making the balance follow the sorted order* — rejected: it would make the column mean
"running total of whatever is on screen", i.e. nothing.
