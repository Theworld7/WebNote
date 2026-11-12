# A ledger filter narrows the book, not the view

ADR-0009 fixed the ledger's reading order: balances accumulate along **the table's own row order**, because
"how much was left after this entry" has nothing to do with how you happen to be looking at the table.
Sorting only changes the display order, and the balance column keeps telling the truth.

A filter is a different question. "Show me only the 餐费 entries" is not a way of looking at the whole
book — it is **a smaller book**. Its total is the 餐费 total. Its balance starts from the first 餐费 entry
and ends at what 餐费 has cost so far. So this ADR adds a filter to the ledger and states the one thing
ADR-0009 could not: what a filter does to the totals.

## What a filter is

`LedgerBlock.filters` is a list of `{ columnId, value }`, and **every** condition has to hold (AND). Empty
or absent = no filter, and nothing is written to disk.

The comparison happens on the **display text** (`valueText`), not the raw value — the same rule the stat
block already uses for its filter. `餐费` matches a select option by its name, `✓` matches a checked box,
`String(number)` matches a number. What the user picked is what gets compared; there is no second idea of
equality to drift from the first one.

Several conditions rather than one because the useful questions are compound: 类型 = 餐费 **and** 账户 =
招行 is what "the dining budget for this card" means. One condition would have forced people to fake a
combined column.

## The value is picked, never typed

The settings menu offers two selects per condition: the column, then **the values that column has actually
been given** (`columnValues`, de-duplicated, in first-appearance order). Picking a different column clears
the value — the cascade is just that, the second select is recomputed from the first.

Typing the value by hand (what the stat block does) was rejected here: a typo silently produces an empty
table, and an empty table is indistinguishable from "this account has no entries". A ledger is read for its
numbers, so a filter that quietly shows nothing is worse than one that is slightly harder to set.

The current value is kept in the option list even when the data no longer contains it, so a condition never
renders as a blank select after rows are edited.

## Totals, balance and sections follow the filter

`filterRowsByValues` narrows the rows first; sorting, sectioning, per-section subtotals, the bottom totals,
the balance column and the row numbers all run on the narrowed list. The filter bar above the table states
the condition and `12 / 40 行`, because a total that silently means "of the rows you can see" would
otherwise be read as the whole book.

A deleted column **drops its condition** and the rest stay — the same self-healing stance as a deleted
income or sort column. Keeping a condition whose column is gone would empty the book; that is not a state
anyone asked for.

## Writing an entry that the filter hides

`记一笔` still works with a filter on. The draft row is visible while it is being filled (it always sits in
its own first section), but on release it lands where the sort puts it — and if it does not match the
filter, it disappears. The row **is** written to the `.tbl`; only the view drops it. So the release says
`已记入，但当前筛选看不到这一笔`, once, rather than letting people conclude the entry was lost.

Rejected: disabling `记一笔` while a filter is active. Cleaner in code, but it refuses the actual intent —
people filter to a category **in order to** add more of it.

## On disk

`data-filters` on the ledger container: a JSON array of `{ column, value }`, the same trick as the playlist
block's `data-sources` (JSON escapes itself; `escapeHtml` turns the quotes into `&quot;`). Short keys
because the attribute lands in the source of every exported note. Empty list = attribute absent.

The export snapshot contains **the filtered rows only**, with totals and balances recomputed from them —
a static file that showed the full table under a filtered total would disagree with the editor. When the
filter matches nothing, the snapshot says `当前筛选没有匹配的行` instead of shipping an empty table body.

Parsing is tolerant in the usual way: not JSON, not an array, or an item without a `column` is skipped; a
missing `value` becomes `""`, which is a legitimate condition ("this column is empty").

## Consequences

- `design/ledger-filter-check.html` mounts the real editor and pins: the cascade, `12 / 40 行`, totals and
  balances following the filter, the toast for a hidden entry, and clearing back to the full book.
- `design/ledger-check.html` pins the pure functions, the JSON round trip and the tolerant parse.
- The settings menu got wider (`15.5rem`) to hold a column and a value side by side.

## Revisit if

- Someone wants OR, or comparisons other than equality (greater than, contains). That is a condition
  language, and it should be designed as one rather than bolted onto `{ columnId, value }`.
- The same filter list is wanted on the gallery or kanban blocks — then `filters` belongs in a shared shape
  with one implementation, not three.
