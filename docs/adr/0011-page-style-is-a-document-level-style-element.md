# Page style is a document-level `<style>`, previewed scoped

A Note's typography is fixed: every exported file carries the same `DOC_STYLE`, generated
from `lib/typography.ts` so that the editor and the file agree. That covers the common
case and blocks the uncommon one — a note that wants its own page CSS (a serif body, a
tinted background, a wider heading scale) has nowhere to put it. The `.html` file is the
canonical form of the note, so the answer has to be "write it into the file", not "add a
setting to the app".

**The page style is a second `<style>` element in `<head>`**, marked
`data-note-style`, written after the generated one (now marked `data-note-base`). Order is
the mechanism: equal-specificity user rules win by coming later. Two elements rather than
one because the generated block has to stay regenerable — merging them would mean
stripping the base out by string comparison on every parse, and the round-trip invariant
would then rest on that comparison.

**It is not a Block.** The alternative — a `style` block type — would put page-level CSS
in a flat list of content blocks, where every consumer (drag, menus, insert-at, layout
cells, cell backspace) would need a special case for "this block is not content". It is
one string per Note, so it lives beside the block list: `styles[path]` next to
`documents[path]` in `useWorkspace`, with exactly the same lifecycle — read together,
saved together, dropped together, renamed together. It also stays out of the undo stack:
that history stores block-list snapshots, and a second parallel stack for one string costs
more than it protects.

**Parsing is deliberately looser than the writer.** A `<style>` in `<head>` without the
marker is adopted as the page style, because hand-editing the file is the point of a
plain-HTML note, and silently dropping what someone typed is the one failure mode worth
spending code on. The generated base is skipped by its marker, and — for files written
before the marker existed — by comparing the element's text with the current `docStyle()`,
ignoring the boundary newlines the writer adds around the content. That normalization is not
cosmetic: without it the comparison can never match, and *every* pre-marker note sprouts a page
style made of its own base typography — the whole measure (`body { padding: 3rem }`) then lands
on the content column and inside every HTML block. A page style that *is* the base typography
is read back as empty for the same reason, so a file damaged that way heals on the next save.
Only `<head>` is read: a `<style>` in the body belongs to an HTML block's verbatim source, and
adopting it would store the same CSS twice.

**The editor previews it, scoped to the content column.** An unscoped injection would
repaint the sidebar and every dialog, since the user writes page-wide selectors. Before
injection the CSS is rewritten — via the browser's own CSSOM, not a hand-written parser —
so that `html` / `body` / `:root` map onto the content column (`[data-doc]`) and everything
else is nested under it. `:where()` is deliberately *not* used for the prefix: the column's
headings and paragraphs carry Tailwind utility classes at `0,1,0`, and a de-weighted user
rule at `0,0,1` would lose to them — producing the exact "works in the file, invisible in
the editor" split this preview exists to prevent. A plain descendant prefix lands at
`0,1,1`, matching the cascade order on the export side.

**A note's two appearances resolve against the app, not the OS.** A note that adapts —
`color-scheme: light dark`, `@media (prefers-color-scheme: dark)` — is asking whoever opens it,
and in the editor that reader is the app. Scoped as written, the declaration handed the
column's used colour scheme back to the operating system: with Windows in light mode and the
app switched to dark, `body { background: Canvas }` painted a white page underneath the app's
light text (the reported bug: dark window, white note, unreadable). The rewrite now collapses
a both-schemes `color-scheme` onto the app's current appearance and evaluates
`prefers-color-scheme` terms against it — in place, so
`(prefers-color-scheme: dark) and (min-width: 600px)` keeps its width term, and a false branch
disappears whole. A pinned `color-scheme: light` / `dark` / `normal` is left alone: the author
said which side they want, and a hard-coded light card has every right to stay light in a dark
window. Because the appearance is now a dependency of the preview, switching it re-derives the
same page style — see ADR-0014 for what "the app's appearance" means. An HTML block's frame is not rewritten
this way — it is a document of its own, with no column to scope a media query to — but the same
two forms are resolved against the same appearance there too, by `pinScheme` inside
`buildHtmlFrameDoc` (ADR-0013).

**Consequences.** `@import` is dropped from the preview (it would pull in an unlimited
sheet), `@layer` / `@container` bodies are not rewritten, and `@font-face` / `@keyframes` /
`@property` pass through untouched — they register names rather than styling selectors, so
they cannot leak. The preview is therefore *approximately* WYSIWYG, and the file is always
the truth. A page style that fails to parse costs the preview, never the saved CSS: the
drawer commits the user's text without re-serializing it (compacted to one line — see
ADR-0012 — but never re-written by the CSSOM). HTML blocks are a document of their own and
therefore do not see the scoped preview; their frame is handed the page CSS unscoped instead
(ADR-0013).

**Considered.** *A `style` block type* — rejected above. *Appending the user's CSS to the
generated `<style>`* — one tag instead of two, but the base would stop being regenerable.
*Injecting the page CSS unscoped and letting users namespace their own selectors* —
that makes page style a footgun in a tool whose editor chrome is all `<div>`s and `<p>`s.
*A `<style>` inside the body instead of the head* — the file's own `<head>` is where a
person would look for it, and it keeps it out of the body's verbatim HTML-block space.
