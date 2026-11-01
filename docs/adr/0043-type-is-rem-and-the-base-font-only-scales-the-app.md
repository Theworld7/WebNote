# Font sizes are rem, and the base font only scales the app

The last item on the optimisation list was two requests written as one: *use rem for type* and
*let the base font size be changed in settings*. Neither is interesting alone. Together they force
a decision about what "the app got bigger" means, because a note is both UI and document.

**The state it started from was half-rem, which is the worst of both.** Body text was `text-sm`
(0.875rem) and every gap, padding and icon was already rem, because that is what Tailwind emits —
so changing the root font size would have grown the paragraphs, the spacing and the toolbars, and
left every label, tab, menu item and table cell frozen at 11/12/13px. 362 hard-coded `text-[Npx]`
literals across 51 files, and 87 of them were the 11px step. Turning the knob in that state would
have looked broken rather than small.

## The decision

**The nine-step scale becomes nine theme tokens, in rem.** `--text-11` … `--text-30`, one per step
of ADR-0027, value `0.6875rem` … `1.875rem`. The names keep the old px number because it is the step's
*name*, not its unit — `text-12` reads as "the 12 step" and the actual value lives in one place.
Every literal was replaced mechanically (`text-[13px]` → `text-13`); one stray 10px folded into
the 11 step, which is what ADR-0027 already said the floor should be.

**Geometry that is derived from type becomes rem too.** `MARKER_TOP`, `CHECKBOX_TOP`, list indent,
heading margins, the block handle's `--tools-top`. These are numbers computed from a font size; if
the font scales and they do not, the list bullet floats above the line box at 18px. `remOf()` does
the division in one place (`0.8px → 0.05rem`, identical at the default root), and
`BASE_FONT_REFERENCE_PX` names the 16 that all of it assumes.

**The base font is four steps: 14 / 16 / 18 / 20.** Selecting a step sets `html { font-size }`;
selecting 16 removes the inline style instead of writing `16px`, so "never touched" and "chose the
standard" stay indistinguishable in the DOM — the same stance as `data-corners`.

**Two layers do not follow the preference, on purpose.**

- *The exported file.* It is a snapshot for someone else, opened by a browser we know nothing
  about. Its type stays in px (and its measure in `45rem` against a browser default of 16). Letting
  a setting in my app change how the file looks on their machine is the wrong kind of magic. At the
  default step the promise from ADR-0027 — *editor and export look the same* — still holds exactly;
  at 18 or 20 it does not, and that is the user's own doing, visible the moment they open the file.
- *The measure.* 720px is a decision about how many Han characters fit on a line (ADR-0027). Scaling
  the column alongside the type would silently keep the count fixed and hide the cost of a bigger
  step. At 20 the line holds ~36 characters instead of 51; the "content width" preference is right
  there for anyone who wants it wider.

**Two embedded documents get the number handed to them.** The HTML block's sandbox iframe and the
code block's Monaco instance are separate documents/engines: neither can read the parent's root
font size. `buildHtmlFrameDoc` now takes `baseFontPx` and writes `html { font-size: Npx }` with the
body in rem, so the block's own type scales with everything around it (and the iframe reloads when
the step changes — it is already keyed on the appearance for the same reason). `openCodeEditor`
takes the same number and scales font size, line height and the padding it uses for layout, so
"static layer and editor break lines identically" survives a non-default step.

## The trap worth remembering

`cn()` merges classes with tailwind-merge, and tailwind-merge only knows Tailwind's own font-size
scale. `text-30` is not in it, so it was classified as a **text colour** — same group as
`text-foreground/90` — and dropped during the merge. Every heading fell back to body size, silently,
with no build error: the class was on the string, the string was on the element, the CSS rule
existed. The old `text-[30px]` had survived because the unit made it unambiguous.

The fix is a `classGroups` entry in `lib/utils.ts` naming the nine steps. Any future custom size
scale needs the same registration; a test page asserting `getComputedStyle` would have caught it,
and one now does (`settings-check` measures `text-11` / `text-12` / `text-sm` at 16 and at 18).

## Consequences

- ADR-0027's "editor and export are identical" is now conditional on the default step. The check
  page still measures both at the default, which is the case that has to stay exact.
- `settings-check` gained a section that flips the step and measures real computed sizes, not the
  stored value: 15 assertions including "回到 16 时内联样式被删掉".
- `html-check` had a latent race — the first height report can arrive before layout and reads 0, and
  the page resolved on the first message. It now takes the last report inside a 400ms window. That
  failure was there before this change (the old document reproduces it), it just had not been hit.
