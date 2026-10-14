# The ledger block renders a data table as an account book

A Ledger block is the fifth reference block: it points at a `.tbl` and renders it as a
running account — signed amounts on the income / expense columns, a running-balance column,
per-section subtotals, a grand total. The data lives in the table file (ADR-0005); the block
carries only the path and the financial settings. Export follows ADR-0006: a view-shaped
snapshot (`data-ledger` pointer on a plain `<table>`) that double-clicks open as a readable
book.

The forcing requirement was that **gift ledgers, personal books and company books are the
same thing**. 礼账 records a single amount per row (all income); daily bookkeeping splits
income and expense; a company book adds running balance and per-project grouping. Three
block types would have meant three parsers, three settings menus and three export paths for
what is really one shape: a table, a pair of money columns, and a grouping. One block with
*optional* columns covers all three — a gift ledger simply leaves the expense column unset.

**Consequences.**

`Block` gains the `ledger` shape and `REFERENCE_BLOCK_TYPES` grows to five. Every dispatch
that lists reference blocks (`isTextualBlock`, `blocksToHtml`, `createBlock`, `cloneBlock`,
`blockText`, `retypeBlock`, `refPathsOf`) gains an arm; `assertRegistryComplete` holds the
compiler to it. The insert dialog (`GalleryInsertDialog`) and the block menu take one more
kind each.

The money math lives in `lib/ledger.ts` as pure functions — `sumRows`, `balanceMap`,
`ledgerSections`, the formatters. Both the editor view and `ledgerHtml` consume the same
functions; "what the editor computes is what the export shows" is a single-source guarantee,
not a convention between two implementations. The income/expense colors are exported
constants interpolated into the exported stylesheet for the same reason.

**Amounts are numbers, not a column type.** A `money` column type was considered and
rejected: formatting is presentation, a number already stores the value, and a new
`DataColumnType` would ripple through coercion, normalisation, schema checks and every
check page — for a `¥` and a thousands separator the ledger view can render. The `.tbl`
keeps plain numbers, which is also the lossless shape for Excel round-trips.

**Balance is derived, never stored.** It is Σ收入 − Σ支出 accumulated over row order (the
order of occurrence). Storing it would create a second truth that every edit must keep in
step; computing it per render costs a linear pass. Grouping changes *display* order, not
occurrence order, so a grouped row still shows its whole-book balance.

**Section subtotals ride the group title row**, not a separate subtotal row — one row per
section, income and expense inline after the name. The grand total is a real `<tfoot>`.

**Inserting presets the file.** Creating a ledger block writes `日期 / 摘要 / 收入 / 支出`
four columns and points the block's settings at the income/expense ones, so all three
scenarios start recording immediately. The preset only applies when a file is actually
created — a name collision means the user pointed at *their* table, and the block opens in
the "pick columns" hint state instead of guessing ids at it.
`resolveDataTableForNote` therefore returns `{ path, created }` and takes the initial table.

**Entries are edited in the note.** Add, edit and delete happen on the rendered account, not
one file away: a cell click edits in place (the kanban card's interaction, same
`dt.parseCellInput` — text/number/date input, select dropdown, checkbox toggle), Enter commits
and steps down to the same column of the next row, the footer's「记一笔」appends a row and puts
the caret in its first inputable cell, and the row-number gutter swaps to a ✕ on hover. Money
cells show the formatted amount and **switch back to the raw number** when editing — committing
`+5,000.00` would otherwise parse to nothing, i.e. the edit would quietly erase the entry.
Row numbers run in table order, so a grouped view still tells you which entry this is.

**The edit box floats over the cell value.** Swapping a `<button>` for an `<input>` silently
re-lays an `auto`-layout table: an input carries an intrinsic width of about twenty characters
(the `size` attribute's default), and a percentage `width` such as `w-full` degrades to `auto`
while intrinsic widths are computed — so the swapped-in box stretched the 收入 column from
126px to 220px and pushed every other column aside, once per click. The value button therefore
**stays in flow** (merely `invisible` while editing) and the input is absolutely positioned over
it with `inset-0`, so neither the column width nor the row height ever moves. `text-align` is
written out for the same family of reason: an input's computed value is the UA's `start`, so it
does not inherit the cell's `right`, and the number would hop to the left edge on click.
`ledger-edit-check` pins this by comparing the table's geometry before and while editing. The
kanban card needs none of it — its cards sit in fixed-width `w-56` columns, where the input
never takes part in column sizing.

Edits ride `useTableEntry`'s `change`: they are recorded against the note, so the `.tbl` and
the note's snapshot leave on the same save. Two consequences worth knowing: the undo stack
covers **block structure only** (a deleted row cannot be Ctrl+Z'd — discard-without-saving is
the way back), and a row added while grouped has an empty group value, so it lands in the
「未分组」section instead of disappearing.

*Superseded:* this block shipped read-only, on the grounds that totting up is the point of a
ledger and the data table editor is the better home for entry. That holds for bulk entry, but
it failed the everyday case — writing one gift down at the moment it is given. Now the editor
is one click away instead of one file away; it is still there for real bulk work.

**Considered.** *One amount column + a direction select* — rejected: sums then need a join
through the direction column, and a gift ledger's semantics (every row is income) would
still force a per-row direction value. *Signed single column* — rejected: negative-means-
expense reads fine in a report and badly during entry, where the sign is invisible until
summed. *Month grouping without a date column choice* — rejected: a table may hold several
date columns (记账日 / 发生日); guessing one is a rule that guesses.
