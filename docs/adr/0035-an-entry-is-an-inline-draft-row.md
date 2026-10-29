# Recording an entry is an inline draft row

[ADR-0034](0034-ledger-entry-is-a-modal-form.md) made "记一笔" a modal form, on the argument that a
new record and an edit of an old one want different things: an edit is one field in place, a new
record is a whole row, and the inline path made you cross that row cell by cell while
`LedgerBlockView` froze the order underneath you.

That argument holds. What it got wrong is the cost of the alternative: the form is a second way to
edit the same table — its own fields, its own parser call sites, its own panels, its own validation
messages, its own dialog wrapper — and it still ends by writing a row that then behaves like every
other row. A ledger is recorded in bursts ("just rang up three sales"), and a modal interrupts the
table each time.

**The decision.** "记一笔" inserts an **empty row pinned to the top of the list** and puts the caret
in it. It is the ordinary cell editor — same parser, same commit path, same option cell, same
calendar panel, same balance and totals — with one difference: it takes no part in the sort until
you stop editing it.

The row is appended to the **data** (`dt.addRow` at the end) while being pinned at the **top of the
display**. Those are not in conflict: the balance column is computed over the raw row order
(`balanceMap`), which is the order things happened in, so a new row inserted at index 0 would become
"the first transaction" and move every balance under it. Appending keeps it the last thing that
happened; the pin is a display decision, expressed as its own untitled section
(`DRAFT_SECTION_KEY`) in front of the grouped ones — the row has no date yet, so it belongs to no
month section anyway.

**Release.** Focus leaving the **row** ends it — not focus leaving the input cell. The row holds
cells with no editing state (select, checkbox): Tab into one of them clears `editing` while the
person is still filling this record, and releasing there sends the row out from under the cursor and
takes the focus with it (moving a `<tr>` blurs whatever is focused inside). Two triggers say it
instead. A cell editor starting **in another row** releases from the `editing` watch — before the
render, so the row is already sorted by the time the caret lands. And a `focusout` on the draft row
catches what `editing` cannot see: leaving from a select or checkbox cell, where `editing` is
already empty and will not change again. That `focusout` decides on `setTimeout(0)` rather than
`relatedTarget`, because removing the old input on Enter-to-next-cell fires a `focusout` with an
empty `relatedTarget` while the element is still connected — only "where is focus now" separates
"moved within the row" from "left".

The section disappears, the row falls into the sort, and it flashes. That flash is not decoration —
the row physically leaves the top and reappears wherever its date puts it (an empty date sorts
last), and without it "the row I just filled is gone" is a reasonable reading of what you see.

A row nobody filled is **deleted** on release, not kept: an accidental click on a button that
reveals itself on hover should not leave an empty record in the ledger. This is why the first date
column is *not* prefilled with today (0034 did prefill it): a row carrying a date is not blank, so it
would survive the release, and "empty" would stop meaning anything. Inline, the calendar is one
click or one `↓` away on that cell regardless.

**Enter fills rightwards inside a draft row.** Everywhere else Enter means "commit and go down the
same column", which is how a column of amounts gets entered fastest. A record being typed for the
first time is horizontal, so in the draft row Enter moves to the next input column and, from the
last one, finishes the entry (exit → release → sort). Tab still does the same thing on every row,
draft or not.

**Consequences.** `LedgerEntryDialog.vue` is gone, and with it `components/ui/dialog/` — that
wrapper was added for this form and for nothing else (0034's `AlertDialog` argument), so it goes too
rather than sitting unused. `LedgerBlockView` gains `draftRowId` (the pin), `releaseDraft` (delete
if blank, flash if kept, drop the freeze), a draft-aware Enter and `onRowFocusOut` (the release
`editing` cannot see). `design/ledger-entry-check.html` is rewritten for the new flow — the row
lands at the top, Enter walks rightwards and skips the select cell, the row stays on top while being
filled even though its date is older than the existing one, and it drops into date order once the
last cell is committed. It also holds the two release cases that used to be misjudged: Tab into the
select cell of the same row neither moves the row nor loses focus, and leaving mid-entry for another
entry's cell sorts the new row immediately (into its month section, not a trailing one),
`design/ledger-edit-check.html` adds its rows through the same inline path instead of the form.

There is **one draft at a time**: a second "记一笔" releases the first (blank ones are deleted), and
deleting the draft row with its ✕ drops the freeze along with the pin — a pin without a row would
leave the table sorted against a snapshot of a table that no longer exists.

**Considered.**

*Keep the form* — rejected by the request that prompted this, and by the observation above: two
editing surfaces for one table drift.

*Pin the draft until the whole editing session ends, not until focus leaves the row* — rejected: the
request is "sort it once this entry is done", and staying on top while you go on to edit an old
entry is the sort of state that later reads as a bug.

*Insert the row at index 0 of the table so data and display agree* — rejected: it rewrites the
balance of every row below it.

*Cancel with Esc* — not added. The empty-row rule already covers the accident it would protect
against, and Esc on a date cell already has a job (closing the calendar).

**Released rows and the freeze.** The freeze exists so an edit in progress does not move; a release
that left it standing would put the row at the bottom of the frozen table, inside the untitled
section that catches rows outside the snapshot, until the next release sorted everything. So
`releaseDraft` drops the snapshot together with the pin, and the watch that is entering the next cell
re-takes it from the current order — one line of ordering, no separate path. The tag-along section
stays as pure defence: with the pin and the snapshot now released together, nothing adds a row to a
frozen table.
