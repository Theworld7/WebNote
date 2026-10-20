# Focus after a block lands belongs to the block

Two mouse gestures ended with the caret nowhere: picking a type from the `+` menu, and typing `/`
in an empty block and picking a type from the menu that opens. In both cases the user had to click
the new block before they could type. Three separate causes, all of them about *who owns focus
after the menu closes*.

**A retype is a new block, so its id changes.** `retypeBlock()` builds a fresh block
(`createTextualBlock` / `createBlock` generate their own id), and `BlockItem` is keyed by
`${restoreTick}:${block.id}` — so a retype remounts the block. `handleRetype` used to call
`focusBlockById(id)` with the *old* id and found nothing. `changeBlockType()` now returns the id of
the block it produced and both call sites (`BlockEditor`, `LayoutBlockView`) focus that. The rule
reads: whoever changes a block's type must take the id from the operation, never reuse the input.

**A menu action hands focus over; the close callback must not take it back.** `BlockItem` used to
re-focus its own body whenever its menu closed, which for an insert meant the caret went back to
the *old* block right after `BlockEditor` had put it in the new one. The four action emits
(insert-before / insert-after / retype / remove) now set the same `yieldFocus` flag the keyboard
paths already used, so the close callback stays out of the way. Closing without an action (Esc, or
a click outside) still returns the caret to the block that owns the menu.

**While the menu is up, focus is a promise, not a call.** The menu is a popover: its items unmount
only when it closes, and anything focused earlier is dropped to `<body>` at that moment. So
`requestEditableFocus()` does not focus while a menu content is in the DOM — it records the
request, and the menu's `close-auto-focus` handler (`flushPendingEditableFocus`) performs it. The
same handler calls `preventDefault()`, because the library's own behaviour is to hand focus back to
the 24px trigger button, which is exactly the "now click the block again" symptom. The pending
request is one per module, which is enough: one menu can be open at a time.

`design/focus-check.html` drives the real editor for all four shapes — `+` insert, `/` convert,
`转为…` submenu, Esc close — and asserts both the active block id and that a caret really sits
inside its editable body. "Focused" alone is not enough: `document.activeElement` can still be the
body while the selection has been thrown away.
