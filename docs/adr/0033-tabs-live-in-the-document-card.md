# Tabs live in the document card

ADR-0029 gave the tab strip a 36px row of its own beneath the header, because tabs cannot carry
`data-tauri-drag-region` and a strip sitting in the middle of the header eats the one surface that
moves the window. ADR-0024 had already rejected the alternative we are now taking — *put the chrome
inside the content area* — on two grounds: tabs would slide sideways when the sidebar collapses or
the splitter moves, and the window's identity should not travel with a pane.

Both objections were about the **draggable, window-level** part of the chrome. Tabs are neither.
A tab names a document, and the document is what lives in the card.

**The decision.** The tab strip becomes the edit card's first row. `EditorTabBar` renders inside
`EditorSurface`, above the error / busy bars and above the body, only when there are tabs. The
header keeps brand, global actions, undo/redo, the drag surface, count, page-style entry and the
window buttons. Chrome is one 44px row again, and the tab row's 36px no longer exists above the
card — the strip's height now lives inside the card, where the document is.

The row is `h-9` with the 28px chips vertically centred, 10px in from the card's left edge
(`px-2.5`, the same inset the tree rows use), so the first chip clears the card's 18px corner.
`EditorTabBar`'s overflow gradients switched from `canvas` to `card`: the strip now sits on the
card, and a mask tinted for the canvas would draw a grey smear across white.

**Why the two ADR-0024 objections do not apply.**

*Sliding with the pane* — accepted, explicitly. A tab strip inside the card moves by 244px when the
sidebar collapses. That is the behaviour of every tabbed editor whose tabs belong to the document,
and it is the point: the strip is now aligned with what it names. The objection was written when the
same row also held the drag surface, where sliding would have been a window-chrome bug.

*Identity should not move* — still true, and still honoured: brand, global actions, count,
page-style entry and window buttons all stay in the header, whose left edge no longer depends on
the sidebar (ADR-0024's own fix). What moves now is only the list of open documents.

The drag surface gets strictly better than ADR-0029 left it. The strip used to be a sibling row
carrying its own drag filler; now the header's middle stretch is the only drag surface there is,
and its width is decided by brand + actions on the left and count + page style + window buttons on
the right — never by how many tabs are open.

**Consequences.** Chrome above the editor card goes 80px → 44px (the card's own 4px top inset
remains part of the content row, so the card starts 48px down instead of 84px). `TitleBar.vue` loses
the tab row, the `tabs` import and the `data-tauri-drag-region` filler that only existed to give the
strip somewhere to end; its header comment shrinks to one row. `EditorSurface.vue` gains `tabs` and
the row. Empty state is unchanged: no tabs, no row, `EditorHome` starts at the card's top.

`design/chrome-check.html` drops the nine assertions about where the strip sat relative to the
header (row height, flush under the header, its own drag region, brand alignment, invariance when
twelve tabs are open) and keeps the four that still describe the header, plus two that pin the
split: the header contains no tab buttons, and no scrolling strip can be found inside it.

`design/tab-housing-check.html` is new, because the strip's placement is no longer something
`chrome-check` can see: it mounts the real `TitleBar` and `EditorSurface` in the app's two shells and
pins the row's parent (the card), its position (first child), its height, the 4px above and below the
chips, the 10px inset, the 44px + 4px chrome budget, and that twelve tabs overflow inside the card
instead of widening it.

**Considered.**

*Keep the row, only narrow it to the editor width* (option B in the review) — rejected: it spends a
second 36px band on chrome that the card can host for free, and the band would still need its own
drag filler on the left, which the header no longer has room to be.

*Leave the strip where ADR-0029 put it* — rejected by the request that prompted this: once tabs are
the only thing in that row, the row is a whole chrome band for one list.

*Put the strip inside the card but re-add a drag region to its empty right half* — rejected: a
drag surface whose width tracks the number of open documents is exactly what ADR-0029 argued
against, and the card is content, not chrome.

**Open.** The card's first row is flush with the body below it — no divider. If content sliding under
the row ever shows through, the fix belongs in the editor's scroll container, not in a border here.
