# Corners are one scale with four stops, not a radius per component

The app had three unrelated answers to "how round is a corner". shadcn's four steps, all derived
from a single `--radius: 0.625rem`: `sm` −4px, `md` −2px, `lg` +0, `xl` +4px. Two hand-written
constants for the two shapes that are not controls: `--radius-block: 18px` (dialogs and cards) and
`--radius-island: 14px` (menus and popovers). And Tailwind's bare `rounded`, which is `.25rem` — a
literal — used in sixty-odd places for inputs and menu items. Any one of them could be changed and
the other two would not follow.

**Why a setting forced the issue.** "Adjust the interface corner radius" is a preference users ask
for right after font size, and it is the kind of preference that only makes sense globally: a dialog
with 26px corners over inputs with 4px corners is not "large radius", it is a broken theme. So the
seven numbers had to become one scale before there was anything to put a knob on.

**What did not work.** Turning `--radius`. `rounded-lg` does read `var(--radius)` — but `rounded-md`
had `calc(var(--radius) - 2px)` *inlined into the utility* by `@theme inline`, so changing `--radius`
moved two of four steps and left the other two where they were. And `rounded` was not on the scale at
all: `.rounded{border-radius:.25rem}` in the build output, no variable involved. A knob that moves
four of seven corners is worse than no knob.

**The decision.** One table of seven values (`--rad-sm` … `--rad-control`) under `:root`, and one
attribute to pick a row: `:root[data-corners="small"|"medium"|"large"|"square"]`. The four Tailwind
steps and the three hand-written ones all point at that table through `@theme` (`--radius-md:
var(--rad-md)`), the same indirection the shadows already use for `--elev-*` and for the same reason —
a `@theme` value can be inlined into the utility, a `var()` cannot. Neither the utilities nor the
components changed; `rounded-island` still says `rounded-island`.

The bare `rounded` is caught by one override in `@layer utilities`. Sixty-odd call sites was the
alternative; one line that wins on source order is smaller than the diff of rewriting them, and it
also covers the sixtieth call site somebody adds next week.

**The default writes no attribute.** `medium` is not `data-corners="medium"`, it is the absence of the
attribute — `:root` holds those seven numbers. "Never set" and "explicitly chose the default" should
not be distinguishable in the DOM, and a state that cannot be written cannot drift.

**Square zeroes each value rather than scaling the table by zero.** A scale factor looks tempting
until the first stop: `0 × anything` is 0, and there is no way back up. The four rows are written out.

**What stays off the scale.** The table's inner arc (`rounded-[7px]`, `TABLE_RADIUS − 1px`) and the
tab strip's top corners (`rounded-t`). The first is geometry the exported file has to match pixel for
pixel — the static page's CSS is generated from `lib/typography.ts`, and no editor preference may
change what a note looks like when someone else opens it. The second is a seam against the content
area; rounding it with the rest opens a gap at every tab.

**Considered.** A slider or a free pixel input: rejected because every stop in the table is chosen by
eye against the components that use it, and a user-typed `13px` would move `--rad-md` below
`--rad-sm` and turn the hierarchy inside out. Scaling the existing `--radius` by a factor instead of
tabulating: rejected for the zero case above. Keeping each component's radius independent and
letting the setting multiply them: rejected because the result is not a scale, it is seven
independent preferences wearing one label.
