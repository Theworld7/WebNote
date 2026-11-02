# A file has one menu, wherever you right-click it

Three places wanted to offer "the things you can do to this file": the `⋯` button on a tree row, a
right-click on that same row, and a right-click on the file's tab. Each was written separately. The
tab had none at all — right-clicking a tab gave you Chromium's own menu, whose only sensible entry
was "reload". The two tree entry points shared their actions by the accident of sitting in the same
component, not by construction.

The page's own context menu was also still live everywhere else in the app: on a text block, in the
editor gutter, on the toolbar. A document editor that offers "Back / Reload / Save page as…" on a
right-click is not a web page wearing a desktop costume, it is a web page.

## The decision

**The page menu is suppressed at the window.** `suppressPageContextMenu` in `lib/dom.ts` is
registered once in `App.vue`'s `onMounted` and calls `preventDefault()` on every `contextmenu` that
does not originate inside `.monaco-editor`. Monaco is exempt because its own context menu is a
feature (Go to definition, Change all occurrences), rendered in the DOM by Monaco itself — killing
the event would take that away and put nothing back. The test is `target.closest(".monaco-editor")`,
not "is this the editor pane": the pane also contains our blocks, where the menu must stay dead.

**The actions live in one component.** `FileMenuItems.vue` takes `path`, `kind`, `name` and a
`surface` of `"dropdown" | "context"`, and renders the same items in the same order either way.
`surface` picks the shell — a `DropdownMenuItem` cannot live inside a `ContextMenuContent`, the two
reka trees have separate inject contexts — and nothing else. The tree row's `⋯`, the tree row's
right-click, and the tab's right-click all render this one component, so "the tab can do something
the row cannot" is not expressible.

**The dialog targets are module-scoped.** `useTreeDialogs()` holds `createTarget` / `renameTarget` /
`deleteTarget` plus their `request*` / `close*` pairs at module scope, because the component that
*asks* (a tree row, a tab) and the component that *renders the dialog* (`AppSidebar`) are not in a
parent-child relationship. The menus only fill a target in; `AppSidebar` keeps rendering the same
three dialogs it always did, so a rename started from a tab lands in the same box, with the same
validation, as one started from the tree.

## Consequences

- `design/context-menu-check` (20 assertions): the window handler eats a plain right-click and
  leaves Monaco's alone; a tree row's right-click opens a menu with rename / delete and the
  desktop-only entries; clicking 重命名 opens the real `RenameDialog` with that file's name in it,
  and 取消 closes it; a left click still opens the file and still folds a folder; a tab's menu is
  byte-identical to the row's; Esc closes the menu.
- The rename box is an `AlertDialog` (`role="alertdialog"`), not a `Dialog` — the check page learned
  this the hard way, and so would any future test that looks for `[role="dialog"]`.
- `ContextMenuTrigger` is stacked *inside* `CollapsibleTrigger` on folder rows, both `as-child`, so
  the row element carries both behaviours: left click folds, right click opens the menu.

## Revisit if

A fourth surface appears (a search result, a heading-nav entry) — the answer is to pass it through
`FileMenuItems`, not to grow a second list. Or if Monaco ever needs the page menu suppressed too,
in which case the `.monaco-editor` exemption becomes a per-block decision rather than a global one.
