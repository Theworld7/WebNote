# Syntax colors are our tokens, not an imported theme

The static layer of a code block is colored by highlight.js. It used to import
`highlight.js/styles/github.css` — **one** palette, light only — while the block's background is
`--color-muted-strong`, which flips with the appearance. In dark that meant GitHub's light colors
sitting on `oklch(0.33) ≈ #353535`: strings `#032f62` at 1.08, constants `#005cc5` at 1.95,
entities `#6f42c1` at 1.88. The colors are now declared as `--color-code-*` tokens with a `.dark`
branch, the same way `--color-canvas` / `--color-line` are handled.

**The unstyled tokens were the ones that disappeared.** highlight.js leaves `char.escape_`,
`link`, `params`, `property`, `punctuation` and `tag` deliberately uncolored, so they inherit the
block's own text color — and that was hardcoded `text-[oklch(0.3_0_0)]` in two components
(`CodeBlockView`, and the mermaid source box, which shares the same background). Against a dark
block that is 1.20:1. That is why the screenshot shows `transparent`, `15px`, `deepPink`,
`top left` and `no-repeat` as grey-on-grey while `linear-gradient` was merely dim: only the
unlabeled words inherit, and the labeled ones at least had `#e36209` (3.51). The body color is now
`--color-code-foreground` — the same token the syntax palette's `subst` / `emphasis` / `strong`
point at, so "unlabeled text" and "text we colored as default" cannot drift apart again.

**Why the values were copied in instead of imported.** highlight.js ships themes as global
`.hljs` rules with one palette each; importing both `github.css` and `github-dark.css` makes the
later one win everywhere, and neither can be scoped to `.dark` (an `@import` cannot carry a
selector). Copying keeps the source of truth honest: the light values are github.css verbatim, the
dark values are github-dark.css verbatim except two entries, both noted in `style.css`.

**Two dark values deviate, because our floor is lighter than GitHub's.** github-dark is tuned for
`#0d1117`; our block sits at `#353535`, 6.5× the luminance. Against that background its `comment`
`#8b949e` is 3.99 and its `section` `#1f6feb` is 2.65. Comment was lifted to `#96a0ab` (4.62) —
comments are still prose and should not be the hardest thing in the block to read — and `section`
took `#79c0ff`, the dark counterpart of what the light theme already does (it maps `section` to
the same blue as `constant`).

**The light palette is deliberately untouched.** Four of GitHub's light values sit below 4.5
(`variable` 2.85, `keyword` 3.73, `tag` 3.78, `comment` 3.93). They are the theme's own choices,
light mode was not the report, and re-tinting it would change how every existing note looks. The
self-check therefore guards what this decision actually changes: dark ≥ 4.5 for the body and for
every token class present, dark no worse than light token-by-token, and light held at its existing
floor of 2.8 — a documented number, not a silent one.

**The theme file's layout rules are dropped on purpose.** `pre code.hljs { display: block;
padding: 1em }` needs the root element to carry the `hljs` class, but `highlightCode` emits only
the inner `<span class="hljs-*">` — the container is our own `[data-block-type="code"]`. The same
is true of `.hljs { color; background }`, which never applied: the block's floor has always been
`--color-muted-strong`. That accident is exactly why a light-only theme looked fine in light mode
and why nobody noticed the missing dark half.

**Considered.** *Import github-dark.css and scope it with a PostCSS step* — a build plugin to
rewrite two vendored stylesheets, and it still needs the two color lifts, so the "no local
values" purity does not survive contact anyway. *A hand-picked palette* — syntax hues are a
convention readers already know; inventing them buys nothing. *Making the dark block floor
`#0d1117` to match the theme* — `--color-muted-strong` is shared with the mermaid box, selection
cards and the toolbar, and a near-black block would detach from the card it sits in. *Leaving the
import and only fixing the body text color* — the tokens stay at 1.1–2.0, which is the larger
half of the bug.

**Consequences.** `src/style.css` owns the palette (`--color-code-*`, light in `@theme`, dark in
`.dark`) and one rule per GitHub role; `lib/highlight.ts` imports no theme file at all. Section 十
of `design/code-edit-check.html` measures the contrast of the body color and of every token class
in both appearances, and `?theme=dark` leaves the page dark for eyeballing. Not addressed:
Monaco still colors the edit state with `vs` / `vs-dark` (ADR-0017 leaves that to VS Code), so the
two states were never color-identical and still are not.
