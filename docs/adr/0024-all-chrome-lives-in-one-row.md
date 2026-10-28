# All chrome lives in one row

**Partly superseded by [ADR-0029](0029-tabs-live-in-their-own-row.md)**: the tab strip moved back
out into its own row, because tabs cannot carry the drag region and the strip was eating the
middle of the header. The rest of this decision — status bar deleted, brand in the header,
fixed-width count, window buttons at top-right — still holds.

The window has no system decoration (`decorations: false`), so everything a title bar normally
gives you is hand-drawn. Until now that meant **three** horizontal bands stacked before any
content appeared: a 36px title bar (brand was elsewhere, so it held only three action buttons),
a 36px floating island for tabs, and a 10px gap between them — 86px of chrome before the first
line of a note. At the other end of the window, a 32px status bar carried the breadcrumb, the
character count, and the only entry to page styles.

Both ends were wrong for the same reason: the middle of the window is where a note lives, and
Apple's layout guidance is explicit that controls and key information do not belong at the
bottom — users move windows down, and the bottom edge gets clipped by the screen edge. A
breadcrumb that says *which file this is* and a doorway that rewrites the whole document's CSS
were both sitting in the most clip-prone 32 pixels of the window.

**The decision.** One 44px header, spanning the full width, holding — left to right — the brand
name, the three global actions (collapse sidebar / appearance / settings), a divider, the open
tabs, a stretch of drag surface, then the document's breadcrumb, its character count, the page
style entry, and finally the window buttons. The status bar is deleted, not shrunk.

**Why the brand moved out of the sidebar.** It names the window (it is the `productName`), not
the sidebar. Keeping it in the sidebar meant the chrome's left edge shifted by 40px every time
the sidebar collapsed, dragging every tab with it. In the header it is stable, and the sidebar
gains the 42px its tree wanted.

**Why the count is fixed-width.** It changes on every keystroke. In a flex row, a value that
changes width pushes everything to its right — the page-style button and the window buttons
would drift while you type. `w-[52px]` plus `tabular-nums` keeps the change inside its own cell.

**Why the tab strip is not `flex-1`.** It sizes to its content and scrolls when it overflows;
the `flex-1` remainder after it is the drag surface. If the strip took all the slack, a window
with one tab would have nowhere to grab — Tauri's drag region only applies to the element that
carries the attribute, and neither tabs nor buttons carry it.

**Consequences.**

`EditorStatusBar.vue` is gone. Its three occupants split: breadcrumb and count into the header,
page styles into `PageStyleButton.vue` — a new component because the button moved but the drawer
did not. The drawer still teleports into `data-editor-surface` (it is half the *editor*, not
half the window), so the component owns both ends of that contract in one place instead of
two. `design/page-style-check.html` mounts that component rather than a stand-in.

`TitleBar.vue` now reads the workspace (tabs, active tab, breadcrumb, character count) and
renders `EditorTabBar` as a fragment rather than a floating card. `EditorTabBar` lost its
`rounded-island` shell and `p-1`; its regression page (`design/tab-check.html`) accordingly
stopped asserting "strip sits 4px inside the island" and now asserts the strip is flush with
its own root — the shell belongs to the chrome now.

`design/chrome-check.html` is new. It pins the things that would silently rot: one header, 44px
tall, brand before actions, tabs vertically centred at 8px, breadcrumb present only when a tab
is active, count cell 52px wide.

Vertical budget: 86px → 48px from window top to the editor card, a gain of 38px of note.

**Considered.**

*Keep the tab island under the title bar* (the previous arrangement) — rejected: it spends the
window's most valuable band on a second chrome layer, and the page-style entry had no home
upstairs anyway.

*Put the chrome inside the content area* (tabs pinned above the editor card, as the old island
was) — rejected: tabs would slide sideways whenever the sidebar collapses or the splitter is
dragged. The window's identity should not move when a pane resizes.

*Leave the brand in the sidebar* — rejected above: it makes the left edge of the chrome
dependent on a pane's state.

*Keep a slimmed 28px status bar for the character count alone* — rejected: a strip that exists
to show one number is a second chrome layer by another name, and the number is the one thing in
that bar nobody needs. Fixed-width in the header costs zero layout.

*Per-platform window buttons on macOS* (traffic lights at top-left) — **not addressed here**:
`decorations: false` plus a single fixed arrangement still puts Windows-style buttons at
top-right on macOS. That is a platform-identity bug, not a chrome-consolidation one, and it
needs its own decision about whether to keep drawing them or hand the frame back to the system
on macOS.
