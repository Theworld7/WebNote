# The code block edits in one Monaco instance, mounted on demand

A Code block is now **two states over one model**. The resting state is a single static layer:
`highlightCode` turns the runs into colored HTML and that is the whole block — no editor, no
overlay, nothing listening. Editing is a second state entered from the block's "edit" button:
the block hands a host element to Monaco, shows a small toolbar (language select, hint, done),
and gives the host back when the edit ends. **At most one Monaco instance exists in the
application at a time**; it is created on entry and disposed on exit.

Before this, the block was a contenteditable whose text was transparent with a highlighted copy
painted over it in an absolutely-positioned layer. Two layers had to agree on font, size,
leading, padding and wrapping to stay aligned; any drift showed up as doubled glyphs (the
complaint that started this). Removing the transparent layer removes the whole class of bug:
there is exactly one thing drawing text in each state.

**Why not one instance per block.** The document renders as a plain `v-for` with no
virtualization, and code blocks are not rare in real notes: 11 notes in this workspace hold
code blocks, averaging 11.6 per note, max 22. Measured on this machine (headless Chromium,
development server): a 20-block note opens in 248 ms with the static layer (5.4 ms per block,
557 DOM nodes total), while one Monaco instance costs 33 ms and 172 nodes, about 5 ms and
68 nodes each after the first. The milliseconds look tolerable; what does not is that every
instance is permanent — 22 models, 22 `automaticLayout` observers, 22 sets of keyboard/IME/
mouse listeners — and that opening any note with a code block would have to pull Monaco in
(683 kB gzip for `editor.api` plus a language worker: css 240 kB, html 192 kB, ts 1456 kB).
`lib/monaco.ts` exists precisely so the main bundle never touches Monaco; per-block editors
would repeal that. On-demand keeps "open a note" free of Monaco entirely, no matter how many
blocks the note has.

**Why create/dispose instead of one instance reparented between blocks.** Monaco does not
promise anything about a container that gets moved: layout, focus and its ResizeObserver all
need manual repair, and the parked instance needs an off-screen host with a fixed size (a
zero-sized host collapses the view). Saving the 5 ms is not worth that surface.

**Entry is a button, not a click or a double-click.** Clicking into a code block usually means
"put the caret here" or "select a word"; taking that gesture turns both into an editor launch
with a load delay on first use. Double-click is taken too — it selects a word in code. The
hover "edit" button is unambiguous, and it prefetches (`prefetchCodeEditor`) so the click is
usually served from an already-loaded module. The empty block is the exception: it enters
editing immediately, on the same reasoning as the mermaid block — an empty block must show a
visible way in.

**Blur commits, Escape cancels.** Leaving the block by clicking anywhere writes the value back
through `setBlockRuns` (one plain run; a code block carries no marks), which is the same "typing
lands in the file" the contenteditable had. `Esc` drops the edit and restores the static layer;
on an empty block `Esc` stays in the editor so there is always somewhere to type. Both are also
available as `Ctrl/⌘ + Enter` (commit) and the "done" button.

**Language is a setting of the block, not of the editor.** The block has had a `lang` field
since the beginning, but nothing could set it — it only arrived from a pasted
`<code class="language-x">`. The edit toolbar now offers a dropdown and writes through the new
`setBlockLang`, which touches `lang` only and never the runs (switching language must not commit
an in-progress draft). The value lands on disk as `language-x` on the `<code>` element, exactly
as the parser reads it, so a round trip through export is unchanged.

**Keep `data-block-type="code"` on the static layer.** Page-level CSS rewrites `pre` to
`[data-block-type="code"]` (ADR-0011), so the element that carries the block's text has to keep
that attribute; without it a user's `pre { … }` rule would stop applying in the editor while
still applying to the exported file.

**Consequences.** `lib/monaco-code.ts` owns the single instance (`openCodeEditor` /
`closeCodeEditor` / `activeCodeEditor`, height synced from `getContentHeight`, width from a
ResizeObserver that only reacts to width to avoid a content-size loop).
`components/CodeBlockView.vue` owns the two states; `BlockItem.vue` no longer renders code
blocks at all. The two states share one set of layout numbers — `px-3.5 py-2.5`, 12.5px type,
21px leading — and **the padding belongs to the host element, not to Monaco**: Monaco's
`padding` option only understands top and bottom, so relying on it leaves the text flush against
the block's left edge while the static layer indents 14px, and switching states shifts the whole
paragraph sideways. Widths handed to `editor.layout` are the host's content-box width for the
same reason. The toolbar is a **floating strip below the block** rather than a row inside it:
a row would make the editing state 28px taller than the resting state, and every entry would
push the rest of the note down.

Three Monaco quirks are worked around in one place: `minimap.enabled: false` in the
construction options does not take (an 84 px minimap still lays out, squeezing the text), so it
is disabled again via `updateOptions`; `folding` and `guides` in the construction options are
likewise ignored, so the folding gutter and the indentation rules — which the static layer does
not have — are turned off after creation; and the editor's background is made transparent so
the block does not change color between states (`editor.background` is `--background`, the
block's surface is `--muted-strong`).

**Costs accepted.** Monaco loads on first entry (about 150–250 ms locally, once per session).
The editor uses its own font metrics, so text sits slightly differently than the static layer —
the height is synced, the wrapping is not. Real keystrokes cannot be exercised in the headless
harness (Monaco 0.5x uses EditContext, not a textarea), so `design/code-edit-check.html` writes
the value through the editor API and triggers blur with a real click; the input path itself is
covered by manual use.

**Considered.** *Contenteditable with a syntax-highlighting overlay* — the status quo, rejected:
two layers that must stay pixel-identical forever, which is what broke. *CodeMirror 6 with one
instance per block* — lighter per instance, but a second editor kernel to maintain and the same
"instances grow with block count" shape. *Monaco per block* — rejected above. *Auto-detecting the
language* — rejected: a guess that is wrong colors the block wrongly, and the block already
knows its language when it came from a file.
