# Tabs live in their own row

**Superseded in part by [ADR-0033](0033-tabs-live-in-the-document-card.md)**: the strip moved again,
into the edit card's first row. The reasoning below about the drag surface still holds and is why
tabs are not allowed back into the header; the placement it settled on is history.

ADR-0024 merged every piece of chrome into one 44px header and deleted the status bar to buy
38px of note. One of the things it merged was the tab strip, on the reasoning that a strip
sizing to its content would leave a `flex-1` remainder behind it, and that remainder would be
the drag surface. Tauri's rule was quoted in that ADR and is quoted again here: a drag region
applies only to the element that carries `data-tauri-drag-region`. Tabs are buttons. They do
not carry it.

The consequence, once a document was actually open, is that the middle of the title bar — the
band a user reaches for without looking — was covered by tab buttons. The drag surface that
remained was whatever the strip did not eat, and with enough tabs open that floor is `min-w-4`,
sixteen pixels. The window could still be moved from the few hundred pixels to the right of the
last tab, or not at all on a narrow window. That is not a polish issue: an undecorated window
with no reliable drag surface is a window you cannot place.

**The decision.** The tab strip moves out of the header into its own 36px row directly beneath
it. The header keeps the brand, the three global actions, undo/redo, a full-width drag surface,
the character count, the page-style entry and the window buttons. The tab row holds the tabs
and, after them, its own drag surface. Both rows carry `data-tauri-drag-region`.

The row is rendered only when there are tabs, so the no-document state still shows 44px of
chrome rather than 44px plus an empty band.

**Why not shrink the tabs instead** (cap the strip at, say, 60% and keep the rest as drag
surface): it preserves the one-row budget, but it makes "how many tabs fit" a function of how
much room the other end of the bar happens to want, and the answer changes when the character
count grows past its cell or a dirty tab grows a save icon. Tabs would also be permanently
capped at a fraction of the window no matter how many are open, which is the opposite of what a
strip that scrolls is for.

**Why not make the strip's own background draggable**: setting the attribute on the scroll
container does make its padding drag, and tabs inside it still click. But the empty space in a
strip is proportional to *nothing* — as soon as the tabs overflow, the background is gone, so
the window stops being draggable exactly when the user has the most work open. A drag surface
whose width depends on how many documents you have open is not a drag surface.

**Consequences.** Chrome goes from 48px to 84px above the editor card (44 + 36 + the existing
4px gap). ADR-0024's gain is partly given back, and that is the point of recording this: the
38px were bought with the one affordance a frameless window cannot do without.

`TitleBar.vue` loses the divider that separated the action cluster from the tab zone — with the
tabs gone, the divider separated the actions from a stretch of empty drag surface.
`design/chrome-check.html` stops asserting that the strip is centred 8px inside the header and
starts asserting the things that would silently rot: the strip is not a descendant of the
header, the row sits flush under the header at 36px, the strip's left edge lines up with the
brand's, and the header's drag surface keeps its width when twelve tabs are open.

**Considered.**

*Move the character count and page-style entry down into the tab row, leaving the header as
brand + actions + window buttons* — rejected for now: it is a second change riding on this one,
and the count belongs beside the page-style entry whether or not tabs exist (both disappear for
Markdown, the tab row does not).

**Not addressed.** On macOS the window buttons still sit top-right, drawn by us, because
`decorations: false` is not platform-conditional. That is ADR-0024's open item and it is still
open.
