# Below 900px the sidebar floats over the page

The sidebar is a card in a two-column layout. Narrow the window and the old rule ran
`autoCollapsed`: under 900px the card stopped rendering and the editor took the full width. Pressing
the toggle then brought it back **into the layout**, so an 800px window lost 244px of editor to a tree
the user asked to see only briefly — and on a phone the width argument was worse than useless:
`max-width: calc(100vw - 480px)` evaluates to a *negative* number at 390px, so the docked card
collapsed to zero and the button appeared to do nothing at all.

The trigger is the touch sizes the app is now opened at. A landscape-capable webview or a phone
browser does not have room to show a file tree and a readable column side by side, and it never
will — 232px of tree plus a 480px measure is already 712 of chrome and content.

What was rejected:

- **Extending the existing sheet component.** `SheetContent` is hard-wired to `right-0`, full
  viewport height, and a `border-l` instead of corners, because the settings panel is its only
  caller. The sidebar is a floating *card* — rounded, shadowed, inset by the same 10px the rest of
  the layout uses — so reusing the sheet meant adding a `side` branch to satisfy one caller, and then
  overriding every visual decision it had made.
- **Keeping `autoCollapsed` alongside the overlay.** Two states answering one question ("is the
  sidebar on screen?"), with a rule for which one wins. The narrow case has exactly one answer: not
  until you ask for it.
- **Remembering whether the overlay was open.** It is a per-visit decision. A phone that reopens
  with a tree covering the note you were reading is worse than one that reopens on the note.
- **Letting the overlay cover the title bar.** The toggle that opens it lives there. Covering it
  turns a two-tap round trip into "hunt for the backdrop".
- **Full width at every narrow size.** Simple rule, wrong shape: a tablet in portrait at 768px would
  get a 748px tree with nothing beside it, where a 280px card leaves a readable column. The split at
  480px is where a leftover strip stops being readable and starts being decoration.

## The decision

**One breakpoint, one composable.** `useSidebarLayout` (`OVERLAY_AT = 900`) owns both semantics:
wide, `collapsed` is the user's preference and is written to `localStorage`; narrow, `open` is the
overlay and is never persisted. `hidden` is the single derived answer — `!open` when narrow,
`collapsed` when wide — and it is what the title bar's toggle reflects.

**Crossing the breakpoint resets the overlay, and only the overlay.** Coming back to a wide window
restores the remembered preference; going narrow always starts hidden. The resize listener left
`App.vue` along with the state.

**The overlay is a fixed card, not a drawer.** `fixed top-12 bottom-2.5 left-2.5`, `top-12` being
the 44px title bar plus the card area's 4px top padding, so the chrome stays visible and its toggle
stays pressable. The shadow moves from `shadow-block` to `shadow-pop`, because the card now sits
*above* content rather than beside it (ADR-0026).

**Width has two segments, and the split is a judgement about what is left over.** Above 480px it is
`min(17.5rem, 82vw)` — a 280px card with a readable column of the note still showing beside it.
Below 480px it fills the viewport minus the 10px margins the layout uses everywhere (`max-[479px]`
in CSS, not a JS branch, so it follows the viewport rather than the font scale). A phone at 390px
would otherwise show a 110px strip of blurred text that can be neither read nor tapped — the tap
lands on the backdrop and closes the overlay — so it was decoration taking space from the tree.

**Three ways out, and no others.** Tapping the backdrop, `Esc` (consumed in the root keydown before
anything else sees it), and opening a note — `App.vue` watches `activePath`. That last one is the
one that matters on a phone: tapping a row means "show me this note", not "show me this note and
also keep the tree on top of it". Note the consequence of the full-width segment: on a phone the
backdrop is down to a 10px frame, so in practice the exits are the title-bar toggle and picking a
note. That is acceptable — both are always one tap away — but it is why the overlay must never grow
to cover the title bar.

**Enter/leave are 150ms and respect `motion-reduce`.** The backdrop cross-fades; the card slides
12px and fades. There is no drag-to-dismiss and no swipe: the tree's own drag is still HTML5 DnD,
which touch does not fire, so adding gesture handling here would have been the only pointer-aware
code in the app.

## Consequences

- `autoCollapsed`, `wasNarrow`, `syncAutoCollapse` and `AUTO_COLLAPSE_AT` are gone from `App.vue`.
  The width threshold now lives in one exported constant.
- `PaneResizer` does not render below 900px — the overlay's width comes from the viewport, so there
  is nothing to drag.
- A 720px-wide desktop window now gets the overlay instead of the docked column. That is the same
  width at which the sidebar used to disappear anyway; the only change is that opening it no longer
  shrinks the editor.
- `design/sidebar-overlay-check` (19 assertions, run at both `WINDOW=390` and `WINDOW=800`) drives
  the real composable through the whole state machine — default hidden, toggle, close, narrow→wide,
  remembered preference, wide→narrow reset — and then measures the mounted card: 370px at a 390px
  viewport (full width), 280px at 800px, `shadow-pop`, and a docked card that still reads its
  `width` prop. The width assertion is written per segment, so one `WINDOW=` value pins one branch.

## Revisit if

The tree's drag ever moves to pointer events — then drag-to-dismiss on the overlay becomes cheap and
worth having. Or if a tablet in landscape needs both columns at once, which would be a third layout
(rail + column) rather than a different breakpoint.
