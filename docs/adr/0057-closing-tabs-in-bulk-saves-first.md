# Closing tabs in bulk saves before it closes

The tab's right-click menu was the file's menu — copy path, reveal, rename, delete — and nothing
about tabs. Closing five tabs meant five clicks on five small X's, and the one thing a tab menu is
for was missing.

**The decision.** `FileMenuItems` grows a `fromTab` flag that adds three items ahead of the file
actions: `关闭其他`, `关闭左侧`, `关闭右侧`. Same component, same file, one menu (ADR-0046) — the tree
row has no neighbours on either side, so this is the one thing the tab surface legitimately adds.
The items go first because closing tabs is what a tab's menu is opened for; the file actions follow
unchanged.

An item goes grey when there is nothing on that side, and that is a statement about the tab strip,
not a decoration: `关闭左侧` on the leftmost tab would do nothing, and a menu item that does nothing
when clicked reads as broken.

## Save, do not ask

The single close (`X`, or `requestCloseTab`) asks before dropping an unsaved note, because that is
one note and one question. Bulk close cannot ask: ten tabs would be ten dialogs, and the second one
teaches the user to click through without reading. It also cannot discard — silently dropping edits
because they were off to the right of the tab you right-clicked is the exact kind of surprise this
project refuses elsewhere (ADR-0036, ADR-0038).

So the dirty ones are **saved first, then closed**. That is the same promise autosave already makes
at every other "leaving" moment (`saveOnLeave`), applied to a batch. A note whose save fails stays
open with its tab intact and the reason in `fsError` — one failure does not abort the batch, but it
never gets closed out from under itself either.

## The anchor stays, and takes the focus back

The tab you right-clicked is the anchor: it is never in the closing set. After the batch, if the
active tab went with it, the anchor becomes active — the same stance `closeTab` takes when it falls
back to a neighbour: the editor must not end up parked on an empty document. Right-click does not
activate a tab in this app, so without this rule "close others" on a tab you were not reading would
leave you on whichever tab happened to survive.

## Consequences

- `design/context-menu-check.html` mounts two real tabs and pins: the tab menu equals the three
  items plus the file menu, each item greys out when there is no neighbour on that side, each of the
  three closes exactly its side and keeps the anchor, the active tab falls back to the anchor, and a
  dirty victim is written to the fake disk before its tab disappears.
- No new dialog, no new state: the three items are one call to `closeTabsBeside(path, side)` in
  `useWorkspace`, which is also the only place that knows what "left" means (index order).

## Revisit if

- Undo for a closed tab is wanted — then closing becomes an operation with a history entry, and the
  "save first" rule above becomes the thing that makes it cheap.
- Someone asks for "close all" or "close saved tabs": both are the same function with a different
  set, so they belong here rather than as new menu items with their own logic.
