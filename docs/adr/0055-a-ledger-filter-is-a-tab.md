# A ledger filter is a tab

ADR-0054 made a filter narrow the book: the rows that pass become *the* book, with their own totals,
their own balances and their own row numbers. That stance stays. What it got wrong is the plural —
it left the block with exactly **one** filter list, so asking "what did I spend on meals" and "what
did I spend on taxis" were two questions you could not hold at the same time. You picked a category,
read the numbers, cleared it, picked the next one, and lost the first answer on the way.

The obvious fix — remember the last few filter lists in a dropdown — still makes the two questions
sequential. Looking at one book at a time is fine; **having** two books at a time is the point.

**The decision.** `LedgerBlock.views` is a list of `{ id, name, filters }`, one entry per tab, and
`viewId` says which one is showing. `全部` is not an entry: it is the first tab the view always draws,
and its data is the whole table. A tab's `filters` is still the ADR-0054 list — one group of `AND`
conditions, compared on `valueText` — so nothing about *how* a filter matches changed, only how many
of them a block may hold.

This is why the granularity is **a group per tab** rather than a condition per tab. "Type = 餐费 and
account = 招行" is the dining budget of one card; making each condition its own tab would have taken
the one compound question ADR-0054 argued for and broken it into two tabs that cannot be combined.
Users who want that shape get it for free: add one condition to a fresh tab and stop there.

## No tabs until there is something to switch between

A block with no views draws no tab strip at all — it is one book, and a lone `全部` button would be a
control that does nothing. The strip appears the moment a view exists, and from then on `全部` is
always its first tab: it is the only way out of a filter, so it cannot be deleted, cannot be renamed,
and does not vanish when a filter matches zero rows.

Each tab carries its own row count (`全部 40`, `餐费 12`). ADR-0054 put `12 / 40 行` in a
sentence above the table for the same reason — a total that quietly means "of the rows you can see"
gets read as the whole book. Under tabs the count belongs on the tab: it also tells you which tab is
empty before you click it. The old sentence is gone; there was nothing left for it to say.

## A tab is named by its conditions, unless you name it

`name` defaults to the empty string and the label is derived from the values alone: `餐费`, or
`餐费 · 空` for two conditions. The column name is deliberately left out — it is already on screen in
the two selects that set the condition, and prefixing it doubles the width of every tab for a word
the reader already has. Editing a condition edits the label, and there is no second string to fall
out of sync with the first. A name the user typed takes over, and clearing the field goes back to the
derived label — that is what "undo the rename" should mean.

## Where the settings menu edits

The tabs are the only selector. The settings menu edits **the tab that is currently selected** and
does not offer a second dropdown for choosing one: two selectors for "which book am I changing" is
one too many, and the menu is already tall. So the menu's section header names the tab it is editing
(`筛选 · 餐费`, or `筛选 · 全部`), `添加条件` appends to that group, `新建页签` always creates
a new one and selects it, and `删除页签` appears only while a view is selected.

`新建页签` is its own button rather than "add a condition while standing on 全部", even though that
would have been fewer controls. Standing on 全部 the menu has no conditions to show, so one button
would have to mean two things depending on where you are — the kind of ambiguity that makes people
press it twice.

## Self-healing, same as everywhere else

A deleted column drops its condition (ADR-0054). A tab whose conditions are **all** gone is not drawn
on the strip: at that moment it shows the whole book, and a button labelled `餐费` that displays every
row is a lie. The view stays in the block, so the menu can still be used to fix or delete it — pruning
happens at render, not in the data.

`viewId` pointing at a tab that is gone (deleted, or rendered away by the rule above) falls back to
`全部` without rewriting the block, the same stance as a deleted sort or income column.

## A tab is a view, the tabs are content

Switching tabs changes what the block shows, not what the note says, so it does **not** mark the note
dirty: no dot on the tab, and closing the tab does not ask to save because you glanced at another
small book. This follows ADR-0005's split — view state is not data — and the playlist block's "switch
which table I'm looking at" (`setPlaylistActive`).

So `viewId` is written by `setLedgerView`, which touches the block without `markDirty`, while the tab
list itself (which tabs there are, what conditions, what name) goes through `updateBlockSettings` and
is content.

The selection still lives on the block: when the note is saved for some other reason, `data-view` goes
along and the next open is on the same tab. Selecting a tab and immediately closing the tab, with no
other edit, reopens on the tab that was last written — the cost of not persisting a view action, not a
missing write.

The undo stack treats it like the playlist's current table (`ViewState` in `useWorkspace`): blanked
when comparing snapshots, so a pure switch is not a step, and re-applied after a restore, so undoing
an unrelated edit does not drag the strip back to whichever tab was selected when that step was
recorded.

## On disk

`data-views` holds the tabs, `data-view` the selected one. Both are JSON in an attribute, the same
trick as `data-filters` was, with short keys because the attribute lands in the source of every
exported note:

```html
data-views="[{&quot;i&quot;:&quot;v1&quot;,&quot;n&quot;:&quot;吃饭&quot;,&quot;c&quot;:[{&quot;column&quot;:&quot;c2&quot;,&quot;value&quot;:&quot;餐费&quot;}]}]"
data-view="v1"
```

`n` is written only when a name was typed. `data-view` is written only when it is not `全部`. Empty
list = both attributes absent.

An old file carries one `data-filters` list; parsing it produces one view, so a note written before
this ADR opens with exactly one extra tab rather than losing its filter. The next save writes
`data-views` and drops `data-filters`.

Parsing is tolerant as usual: bad JSON, a non-array, or an entry without an `i` is skipped (without an
identity there is nothing for `viewId` to point at); a missing `c` becomes an empty list, which is a
tab that shows the whole book and is therefore not drawn.

The export snapshot contains **the selected tab's rows**, with totals and balances recomputed from
them — ADR-0054's rule, applied to whichever book you were reading when you exported. Switching tabs
and exporting again gives the other book. The empty case says `当前页签没有匹配的行`.

## Consequences

- `design/ledger-filter-check.html` mounts the real editor and pins: no strip without views, a new tab
  appearing selected, the cascade, the per-tab counts, switching between books (rows, totals,
  balances), the toast for a hidden entry, renaming, a second tab, deleting back to `全部`, switching
  not dirtying the note, and undo not dragging the strip back.
- `design/ledger-check.html` pins the tab label / pruning rules, the JSON round trip, the tolerant
  parse and the `data-filters` migration.
- Rebinding a ledger to another table drops every view: their conditions are the old table's column
  ids, and a tab that cannot match anything is not worth keeping.

## Revisit if

- Tabs are wanted on the gallery or kanban blocks — then a view is a shared shape with one
  implementation rather than a ledger-only concept.
- Someone asks for OR, or for a tab that is "everything except this". That is a condition language,
  and ADR-0054's revisit note still applies to it.
