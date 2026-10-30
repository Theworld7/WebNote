# Undo repaints the block that changed, not the whole document

Pressing Ctrl+Z in a long note used to look like a page reload. The document did come back to its
previous state, but on the way there every block was destroyed and rebuilt: content gone for a
frame, images decoding again, the caret anywhere but where it was, and the scroll position wherever
the layout happened to clamp it. In a note of sixty paragraphs the difference is visible; in one
with code blocks and embedded HTML it is a second of flashing.

**Why it worked that way.** The body of a text block is `contenteditable` and deliberately
uncontrolled — the DOM is written once on mount and the browser owns it from then on. Writing it
from data on every keystroke would reset the caret to the start of the block, so the editor never
does. Undo, however, replaces the document with an older array of blocks, and those blocks keep
their ids: the component instances are reused, the props change, and the DOM ignores them. The
workaround was to bump a counter into the `:key` of every block, so undo changed every key and Vue
obligingly remounted everything.

**The decision.** The counter still exists, but it is now passed *down* as a `repaint` prop instead
of being mixed into the key. Each text block compares `runsToHtml(runs)` with its own `innerHTML`
and writes only when they differ. One undo typically touches one block; the other ninety-nine are
not even assigned to. Keys go back to being `block.id`.

**What is kept from the old behaviour.** The forced repaint still exists — blocks whose data did not
change are skipped, not the mechanism. The caret is restored: if the block had focus, its offset is
read before the write and put back after, clamped to the new length, because the thing you undo is
usually the thing you were about to fix. And code blocks still remount: `CodeBlockView` hands its
text to Monaco at mount and never syncs later data into the open instance, so a repaint there would
leave the editor showing a stale document. That is one block, entered on purpose, and its remount is
cheap compared to the whole page.

**The bug this uncovered.** Layout cells. `snapshotOf` built history snapshots with
`cloneBlock(block, block.id)`, and `cloneBlock` re-ids every child of a layout block — it is the
"make me a copy" function, and a copy needs new ids. A snapshot is not a copy. Two consequences,
both invisible until now: the history signature could never match itself (every keystroke became its
own step, and pressing Ctrl+Z spent a step to arrive at a document that differed only in ids), and
restoring a snapshot handed every cell child a new id, so the whole cell remounted and undo of text
inside a cell simply did not apply. `snapshotBlock` is the counterpart that keeps ids; the three
snapshot sites in `useWorkspace` use it.

**Considered.**

*Repaint on every data change instead of on an explicit signal* — rejected. During typing the DOM is
the source of truth; comparing it to `runsToHtml(runs)` after each keystroke would occasionally
disagree (browser normalisation, `<br>`, whitespace) and rewrite the element under the caret.

*Do nothing and document the flash* — the flash is the whole complaint, and it is a full re-render
of content that did not change.

*Keep the remount and restore scroll and focus around it* — possible, but it restores the symptoms
of a re-render rather than avoiding it, and it does nothing for images, iframes, and Monaco being
torn down and rebuilt.
