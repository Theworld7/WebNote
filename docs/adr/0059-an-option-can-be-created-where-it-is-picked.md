# An option can be created where it is picked

## The gap

A `select` column stores an **option id** in every cell, and the option itself lives in the
column: `{ id, name }`, in the `.tbl` file. Until now the options could only be created, renamed and
deleted in one place — the column menu of the data table's own editing view. Every other surface
that shows a `select` cell could only *pick* from what was already there.

That produced a dead end in a very ordinary moment: a ledger row needs a category that does not
exist yet. The picker offers 「工作 / 生活 / 人情」, the wanted one is not among them, and the only
way out is to leave the note, open the `.tbl` file in its own tab, find the column, type the name
into a menu, and come back. The user has to know that the options of a column are edited in a
different document from the rows they are editing.

The existing code said so out loud — `DataTableBlockView` carried the comment 「选项的增删改名在数据表
编辑页，这里只负责选值 —— 引用块是「一扇窗」，不是第二个编辑入口」 — and `OptionCell`'s empty hint told
the user 「这一列还没有选项 —— 去数据表里加。」. Both were honest about the design and both sent the
user on a detour to finish a one-line job.

## The decision

**An option can be created where it is picked.** The option cell's panel carries a last row,
「＋ 新增选项」. Activating it turns that row into a text field; a name typed there and confirmed
with Enter creates the option in the column and points the cell at it. The user never leaves the
cell they were editing.

This applies to every surface that edits a `select` cell: the data table block, the ledger's rows,
the kanban cards, the gallery cards. The bookmark block edits a `select` cell inside a **form**
rather than on a card, so its native `<select>` gets a small 「＋」 button next to it instead — see
below.

Options are still *managed* in the data table's editing view. Renaming and deleting an option
stay there, because those are rarer, more destructive, and belong next to the column they change.
Creating one is a different act: it is the answer to 「I need an option called this」, and it is
asked at the cell.

## Why the picker, and not the column menu

The alternative was to give every block view the column menu the editing view has. It would have
reused an existing, proven UI and left `OptionCell`'s keyboard model untouched — but the ledger,
the kanban and the gallery have no column menu to hang it on, and inventing one per view is a
bigger change than the problem deserves. The picker, by contrast, is already the one place where
「which options exist」 is answered, at the exact moment the answer is needed.

## What it costs the option cell

`OptionCell` has one hard invariant: **the panel never holds focus**, so that Tab lands on a cell
and the list opens at once, and one Tab later moves to the next cell. The create row breaks that
invariant — the name has to be typed into a real `<input>`, because Chinese input needs one.

The break is contained:

- In the list state the panel still contains no focusable element. The create row is a `div`, like
  the option rows, and the new assertion in `design/option-cell-check.html` pins that.
- In the create state the input is the only focusable thing in the panel, and it is focused
  deliberately. Enter commits, Esc returns to the list with the focus back on the cell, and losing
  the focus commits the name — the same 「失焦提交」 rule the rest of the app follows.
- The row is reachable without a mouse: ↓ stops on it (「到底就停住」 still holds — it simply has
  one more place to stop), and Enter enters the create state.

## The bookmark block is a form, so it is a form

The bookmark block edits its rows in a modal form, and the form's `<select>` stays native: the
GLOSSARY's rule is that form fields keep the native control, because Tab-to-open is a nuisance in
something you step through rather than something you tab along.

So the bookmark block gets a small 「＋」 button beside the `<select>`. Clicking it swaps that one
field for a text field, and the name typed there goes into the form's **draft** — the option is
created when 保存 is pressed, not before, so cancelling the form creates nothing. That is the
form's own semantics applied to the option, and it is why this one surface does not use the
panel's create row.

## Consequences

- `lib/data-table.ts` grows `addOptionAndPick(table, columnId, rowId, name)`: it creates the
  option and points the cell at it in one table transform, so no intermediate state with an option
  and no value can exist, and the table is marked dirty once.
- `OptionCell` grows two props/events: `creatable` (whether the row is offered) and `create` (the
  name to hand to the parent). The component still does not touch data — writing the option into
  the column stays the caller's job, like picking a value is.
- `useCellEditing` grows `createOption`, shared by the ledger, the kanban and the gallery.
- The gallery's `select` cell changes from a free-text input to an option cell. It was the last
  surface still treating a `select` cell as text, and a name typed there that matched no option
  was stored as a value no option could ever display — the cell showed 「空」 while holding
  something. It is now a picker like everywhere else.
- `design/option-cell-check.html` grows a section for the create flow, and
  `design/data-table-check.html` grows both the pure-function case and an end-to-end one: a
  reference block creates an option, and the table in the registry really has it.
