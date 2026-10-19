# The HTML block frame carries the page style

In the exported file an HTML block is not special: its source is inlined into the note's
`<body>`, so a class declared in the page style (`.bg-demo-block`) styles it like any other
element. In the editor the same block renders in a sandboxed iframe with its own document —
the page style lives in the parent document, so every class the user relies on is invisible
until they export. That is the wrong direction for a preview: the editor is where the HTML
block is written.

**`buildHtmlFrameDoc(source, pageStyle)` writes the page CSS into the frame's `<head>`,**
after the frame's base reset and marked `data-note-style`. Order is the mechanism again: the
frame's reset stands in for `DOC_STYLE`, the user's rules come later, so `body { font-family }`
overrides the reset exactly as it overrides the generated base in the file. `HtmlBlockView`
passes the active note's page style, so the frame is always the same document the export
describes.

**The raw CSS goes in, not `scopeCss`.** The scoped rewrite exists to keep page-wide selectors
from repainting the app chrome, and its prefix is `[data-doc]` — an element that does not exist
inside the frame. Inside the frame `:root` / `body` mean "this document", which is what they
mean in the exported file; prefixing them would make the frame *less* faithful, not safer.
The frame is already the isolation boundary.

**The box model is the one exception.** What the page style says about the page's *geometry* —
`padding: 3rem 1.5rem`, `max-width: 46rem`, `margin: 0 auto` — is the note's measure, and in the
editor that measure belongs to the content column, not to each block. Sending it into the frame
insets the block a second time: a stylesheet with `body { padding: 3rem }` shrinks every HTML
block by 3rem, which is a bug the user sees, not a preview convention. So the injection carries
a follow-up rule that forces `margin: 0`, `padding: 0`, `max-width: none`, `width: auto` and
`min-height: 0` on `html` / `body`, `!important` because a user rule can outrank it by
specificity. (`min-height` is not cosmetic either: `body { min-height: 100vh }` ties the body to
the frame's viewport, and the frame grows to the body height it is told about — the height probe
would feed itself.) Typography, colour and background stay: those *are* the page's look and they
read the same inside a block as they do in the file.

**Through `srcdoc`, not a message channel.** The block's iframe runs with `allow-scripts` and
without `allow-same-origin`, so the parent cannot reach into the child document — `contentDocument`
is `null`. Injecting through `srcdoc` is the only channel that needs no cooperation from the
block's own scripts. The cost is that a page-style commit rebuilds the document, so every HTML
block on screen reloads and its scripts re-run. That is accepted: style commits happen when the
drawer closes, not per keystroke, and "the CSS changed, the frame re-rendered" is a coherent
thing for the user to see.

**Consequences.** A page style that sets `body { background }` now paints that background inside
each HTML block as well as on the content column — identical for a flat colour, visibly offset
for a gradient or a background image. The preview stays approximate (ADR-0011), and the file
remains the truth. An empty page style writes no tag at all, so a note without one produces
byte-for-byte the document it produced before this existed. `@import` is *not* stripped here,
unlike in the scoped preview: inside the frame the imported sheet applies to the whole (small)
document, which is the same thing it does in the export.

**Considered.** *Posting the CSS in from the parent and applying it in the probe script* — no
reload, but it adds a second protocol to the frame and still needs the parent to notice style
changes; the reload it avoids is not one the user sees as a cost. *Stripping `html` / `body`
rules before injecting* — kills the main reason to inject at all (`body { font-family }` on the
block's text), and special-cases the cascade the export does not special-case. *Injecting the
scoped CSS* — cannot match: the frame has no `[data-doc]`. *A separate "styles" field on the
HTML block* — would fork page style into two places for one document.
