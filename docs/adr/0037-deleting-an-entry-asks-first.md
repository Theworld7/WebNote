# Deleting an entry asks first

[ADR-0035](0035-an-entry-is-an-inline-draft-row.md) removed the entry form and left the ✕ in the row
number cell as the only way to delete a row. It also made the *blank* draft row delete itself on
release, so that a mis-click on a button that only appears on hover leaves nothing behind.

That rule covers the accident it was written for and no other. A row with something in it is a real
record: the ✕ sits in the 28px cell immediately left of the amount, it is invisible until the cursor
is somewhere over the row, and it appears exactly while the cursor is travelling toward the figures.
There is no undo — the editor's Ctrl+Z walks the document, and a table row is not in that history
(`useTableEntry.change` writes straight through `tables.mutate`). One click on a hover-revealed
target, and a transaction is gone with no way back and nothing to say it happened.

**The decision.** A non-blank row asks. `AlertDialog`, same wrapper, same 300px card and same two
buttons as `BookmarkBlockView`'s delete confirmation — that block already had this problem (a
bookmark row is also a table row, and the table is also shared), and solved it the same way; a second
visual language for "are you sure" would be the only thing new here.

**A blank row does not ask.** `isBlankRow` is already the "this record is nothing" predicate that
`releaseDraft` uses, and asking "delete an empty row?" right after the person has decided it is empty
is a step with no decision in it. So the ✕ deletes blank rows directly, which is exactly the case
`design/ledger-entry-check.html`'s `delete-draft` step covers — that step now doubles as the
assertion that the confirmation does not fire there.

**What the dialog says.** A ledger row has no name field, so "delete this row?" is unanswerable — the
person has to count rows in their head to know which one the box means. The summary is the first two
non-empty cells joined by `·` (usually the date and the item), with number cells rendered through
`formatYuan` — a bare `5000` does not read as money, and money is the field that identifies the
transaction when there is no date; image cells are skipped, since `[图片]` points at nothing. The
description repeats the fact that matters: the table belongs to the data layer, not to this note, so
any other note quoting it loses the row too.

The cell editor is closed before the box opens (`requestDelete` clears `editing`), for the reason
`removeEntry` already cleared it: an input left open would go on representing a row that is about to
disappear, and its blur would commit a value into a row the person has already decided to delete.

**The same box on the other surface.** `DataTableEditor` has the same ✕, the same `aria-label`, and
the same absence of undo, so it asks too — leaving it out would have meant one table row being
deletable without a word and the same row being guarded when reached through a quote. The blank-row
rule carries over unchanged: its trailing 「新记录」row is added empty, so adding one and changing your
mind deletes straight through. `isBlankRow` — the predicate ADR-0035 wrote for the draft row — moved
to `lib/data-table` so both surfaces ask "is this record nothing?" with one answer; the ledger keeps a
one-line wrapper that closes over its current columns.

**Consequences.** `LedgerBlockView` splits `removeEntry` into `requestDelete` (decide) and
`removeEntry` (do), and gains `deletingId` / `deletingSummary`; `DataTableEditor` gains the same
three. `design/ledger-edit-check.html` replaces its single "✕ removes the row" assertion with six:
the box appears, it names the row, it carries both buttons, cancel keeps the row, cancel closes the
box, confirm removes it. `design/data-table-check.html` adds the same set plus the blank-row case
(a 「新记录」row deletes without a dialog).

**Considered.**

*Keep deleting straight through* — the state this ADR exists to change.

*Delete immediately, then offer an undo toast* — the better interaction, and not available: there is
no table-level undo stack to point the toast at, and inventing one is a much larger decision than
this one. A confirmation is what a system without undo can honestly offer.

*Guard 「删除本列」 in the column menu as well* — not done. Dropping a column is worse than dropping a
row (it takes every cell under it, and the data is gone the same way), but the column menu is a
deliberate two-step — open the header menu, pick an item labelled 删除本列 — and it is the only entry
that reads as destructive in that surface. A row's ✕ is one hover away from the data it deletes;
a column's deletion is three deliberate clicks. If this should be guarded too, it is a third
`deletingColumnId` and its own assertions.
