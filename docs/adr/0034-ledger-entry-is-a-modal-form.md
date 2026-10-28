# Recording an entry is a modal form

"记一笔" used to append a row and drop the caret into its first editable cell. Recording one
transaction therefore meant tabbing across the whole row, watching the amount cell flip between
`+1,234.00` (display) and `1234` (edit), having the date cell throw a calendar at you on focus, and
doing all of it while `LedgerBlockView` freezes the row order and the section structure so the row
does not jump out from under the caret mid-entry — the machinery behind `frozenOrder` /
`frozenSections`, which exists so that *editing an existing entry* does not fly away when its date
changes.

That machinery is for the second case. A brand-new row has no old position to be consistent with,
so the inline path pays the cost of the freeze without needing it, and still asks the user to cross
the row cell by cell.

**The decision.** "记一笔" opens a modal form (`LedgerEntryDialog`). Fields are generated from the
table's columns — the same rule as `PlaylistAddDialog`: a form that only knows a fixed set of columns
can never fill a column someone added to the table. Every value is parsed by `dt.parseCellInput`, the
same parser the cell editor uses, so "valid in the form, rejected in the cell" cannot happen. The
row is written once, on submit, with all columns set in a single `change`.

Inline cell editing stays, for what it is good at: changing one field of an existing row in place.

**The keyboard model.** Tab / Shift+Tab move between fields (native focus order — no self-drawn focus
ring), Enter submits, Esc cancels, and Enter during IME composition does not submit (that Enter is
picking a candidate in a Chinese note). While a panel is open, Enter confirms the highlight instead
of submitting, and Escape closes the panel before it can close the dialog. The first field takes focus
on open, and focus returns to the "记一笔" button after a submit so the next entry does not need the
entry point found again. The first date column is prefilled with today; nothing else is, so a form
nobody touched cannot be submitted. Errors are reported per field and focus moves back to the
offending one — nothing is silently dropped (typing `1,000` into an amount is rejected out loud rather
than parsed to empty).

**Date and select fields open their panel on arrival.** Tabbing into either one expands a panel below
the field: arrow keys move the highlight, Enter confirms. The first pass of this form did the opposite
— no panel on focus, dates typed by hand, the calendar reached through a button on the right — and the
reason that was wrong is the reason `OptionCell` exists at all: the native `<select>` model is "Tab
selects the control, then Enter or Space expands it", and that model belongs to the platform, not to
the page. On a keyboard-only path a date that can only be picked by clicking a 24px button is a dead
end, and the calendar button is unreachable if the surrounding flow is Tab-driven.

The panels are **inline** — they push the fields below down and the form scrolls — rather than
floating. A `fixed` overlay inside a dialog would have to negotiate with reka's focus trap, the
scrim's `interact-outside`, and a scrolling form that leaves the panel behind; the calendar was
already inline. So both panels share one piece of state (`panelOf`), one highlight, and one set of
keys, and neither ever takes focus (their rows are not in the Tab order), which is what makes "Tab
once leaves the field and closes the panel" true for free.

Two exceptions keep it from being noisy. The automatic focus when the dialog opens expands nothing —
landing in a field is not "switching to" it, and a 250px calendar as the first thing on screen buries
the form you came to fill. And once a date has been typed by hand, Enter submits: a panel must never
overwrite typed text with the day it happens to be highlighting. Closing a panel is never a dead end
either — `↓` / `↑` on the field calls it back.

Image columns are left out of the form (there is no "typing" way to fill one) with a line pointing at
the table, and the row is still written rectangular: every column gets a key.

**Why `Dialog` and not `AlertDialog`.** The other form dialogs in the project use `AlertDialog`, but
reka's `AlertDialogContent` hard-wires `openAutoFocus` to focus its cancel element, and it does not
accept `preventDefault` on that event — it is built for "delete this?" with two choices. A form has to
decide where the first keystroke lands, and a keyboard-only flow that starts on "取消" is a trap. So
`components/ui/dialog/` was added (root / content / title / description, the same thin-wrapper shape as
`alert-dialog`), and this form uses it. Esc and outside-click are the dialog's own; outside-click is
switched back off here (`@pointer-down-outside.prevent`) because a half-filled form cleared by one
stray click is worse than a click on the scrim that does nothing.

**Consequences.** `LedgerBlockView` loses the "append + focus first cell" path and gains an
`entryOpen` flag, a submit handler that writes the row and flashes it (with a date sort the new row
can land in the middle of the table, so "the dialog closed and nothing happened" must not be a
possible reading), and a focus hand-back to the entry button.

`design/ledger-entry-check.html` is new: it mounts the real editor over OPFS, opens the form with a
click, and then fills it the way a keyboard would — value + `input` event, Enter on a field, Esc,
Enter with `isComposing` — checking field order, focus, autofocus target, disabled submit, the flash,
the focus hand-back, per-field validation, both panels (expand on arrival, arrow keys, Enter confirms,
Escape closes only the panel, `↓` brings it back), and what lands on disk (number as number, date as
`YYYY-MM-DD`, select as an option **id**). `design/ledger-edit-check.html` now drives its two "add a
row" cases through the form, because that is the only way to add one.

**Considered.**

*Keep appending and focusing the first cell* — rejected by the request that prompted this: it is one
row of entry split across N cells, and each cell brings its own editing affordances to a task that
wants none of them.

*Anchored side sheet instead of a centred dialog* — rejected: a sheet reads as a panel that stays
open, this form is one record long, and `Sheet` is already spoken for by settings.

*Native `<dialog>` + `showModal()`* — tempting (free focus trap, free Esc, free focus restore) but it
would put a second dialog implementation next to reka's, with its own focus-restore semantics to keep
in sync. The wrapper is four small files.

**Open.** The amount field keeps the cell editor's parser, so thousand separators are refused instead
of normalised. If that turns out to be the common way people type money, the fix is to normalise
before parsing — in one place, so both entries stay identical.
