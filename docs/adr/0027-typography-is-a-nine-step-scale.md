# Typography is a nine-step scale, and the font stack exists once

Apple's typography guidance asks for three things this app had drifted from: keep the number
of typefaces down, convey hierarchy with weight / size / *and* colour, and stay above the
minimum readable size. Measured against the stylesheet, the drift was concrete.

**Fifteen font sizes were in use** — 10, 10.5, 11, 11.5, 12, 12.5, 13, 14, 15, 16, 18, 20,
22, 26, 30 — of which **64 sites carried a half-pixel value**. At @1x an 11px and an 11.5px
label are indistinguishable, so the half-steps bought nothing and made every new card
invent its own number. The smallest steps were the ones that mattered: 101 sites sat at
11px or below, and at 10px a Chinese glyph has roughly half the stroke room of a Latin
lowercase — those were unreadable, not merely small.

**h4, h5 and h6 were identical**: 16px, weight 500, same colour. Three heading levels
rendered as one, because the size ladder inherited from Naive UI runs out at 16. Size alone
cannot carry hierarchy where the sizes are equal.

**The font stack existed in three places** — `style.css` `--font-sans`/`--font-mono`,
`docStyle()` in `typography.ts`, and the HTML block's sandbox document in `html-frame.ts` —
and they disagreed (`"SF Pro Text"` present only in the first; the iframe had no mono stack
at all). `lib/fonts.ts` claimed in a comment that the stack had "a single source of truth:
the `@theme` block", which was simply false. Changing it meant changing it in three places
and discovering the third by eye. All three also listed only Apple families, so on Windows
the app leaned on whatever the browser's default font happened to be.

**The measure was 800px**, which at 14px body text is ~57 Han characters per line — past the
comfortable 40–50 range, where the return sweep starts landing on the wrong line.

## The decision

**Nine steps, and no half-pixels.** `11 / 12 / 13 / 14 / 16 / 18 / 22 / 26 / 30`. Existing
values were folded into the nearest step (10, 10.5 → 11; 11.5, 12.5 → 12; 15 → 14; 20 → 22)
rather than redesigned; the smallest step rose to 11px so no Chinese label renders at 10.
One exception is deliberate: the code block stays at `12.5px`, because `monaco-code.ts` and
the static layer's `0.9em` are a matched pair whose whole purpose is that the edit state and
the rendered state break lines identically (ADR-0017). Its size is content, not UI chrome.

**Hierarchy below h3 moves to weight and colour.** h4 is 600, h5 is 600 with the foreground
at 75%, h6 is 500 in the muted colour. Three levels, three distinct treatments, no new sizes.

**The stack is a constant, referenced twice and mirrored once.** `SYSTEM_FONT_STACK` and
`MONO_FONT_STACK` live in `typography.ts`; `docStyle()` and `html-frame.ts` interpolate them.
`style.css` cannot read a TS constant, so it keeps a literal copy — and `settings-check`
asserts the computed `--font-sans` / `--font-mono` are byte-identical to the constants. That
assertion is the contract, not the comment. Windows families (`Microsoft YaHei`, `Segoe UI`,
`Cascadia Code`, `Consolas`) were added: not to change the rendering, but to turn "whatever
the browser default is" into a stated decision.

**The measure is 720px** (`DOC_MEASURE_PX`, ~51 characters), and it is the *same number* as
`CONTENT_WIDTH_PX.standard` and the exported `body { max-width: 45rem }`. The width
preference steps down to 600 / 720 / 900 to keep the ladder proportional.

## Consequences

- Settings-check owns the font-stack contract and the measure assertion; typography-check
  owns the block-level sizes and spacing. Either page going red after a stylesheet edit is
  the signal that a copy drifted.
- `headingClass()` now keys its class table by block type instead of font size, because h4 /
  h5 / h6 share a size. The size check it used to get from the table lookup is preserved as
  a substring assertion against `HEADING_FONT_SIZES`, so changing a size and forgetting the
  class still throws.
- No font-size preference was added. macOS has no Dynamic Type and this is a desktop app, so
  the guidance's scaling requirement does not currently apply — but a Ctrl +/- zoom would be
  the natural next step, and the nine-step scale is what makes it possible to do later.
