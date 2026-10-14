# The theme colour is the icon's background colour

The interface was monochrome. `--primary` was a near-black, `--ring` a neutral grey, and
the one blue in the app — the selection family, a desaturated indigo
(`oklch(0.44 0.13 255)`) — had no relation to anything. Meanwhile the app icon has always
had a brand colour: a blue gradient, `#2A69F0 → #1D4FD8 → #10308F`. An app whose icon is
blue and whose buttons are black is two products wearing one window.

The theme colour is therefore the icon's background colour. `--color-brand` is the **single
definition**, and everything that expresses "this is the app's colour" points at it:
`--primary` (default buttons, checked checkboxes), `--ring` (focus rings, and the base
layer's global `outline-ring/50`), `--color-selection-foreground` (the active tab / selected
tree row), and the `--sidebar-*` contract variables. Changing the brand means changing one
line.

The **mid stop** of the gradient (`#1D4FD8`, the 46% offset) is the one that becomes the
colour, because that is where the eye reads "the icon's blue": the start is a highlight and
the end is a shadow, and each only reads correctly *because* the mid tone sits behind it.
Flattened into a UI fill, the bright stop loses its relationship to the icon and drops
white-on-blue to 4.80:1; the deep stop is heavy enough that it stops reading as the icon's
blue at all. The mid stop carries 6.64:1 with pure white.

**Consequences.**

The icon tokens are now an input to the stylesheet — but by **mirroring, not reading**: CSS
cannot open a JSON file, and adding a build step that generates one custom property would
cost more than it saves. `design/theme-check.html` compares the resolved `--color-brand`
against `themes.light.bg` channel by channel, so a re-coloured icon fails a check page
instead of silently leaving the UI behind. If the icon palette ever starts changing often,
generating the token from `icon.tokens.json` becomes worth revisiting.

**Dark appearance takes the icon's dark variant**, not a lightened copy of the light one:
`themes.dark.glow` (`#5E93FF`) becomes `--color-brand`, and the selection text takes
`themes.dark.glyph[1]` (`#BBD4FF`). The second is a deliberate exception to "one blue":
`#5E93FF` on the dark selection chip measures 4.18:1 — under the text threshold — while
`#BBD4FF` measures 8.84:1, and it is already the icon's own "text on the dark background"
colour, so the exception is taken from the same source rather than invented.

**`var()` chains need re-declaring per theme.** A custom property declared on `:root` is
substituted *where it is declared*, not where it is used, so a `.dark` override of
`--color-brand` would never reach a `--color-selection-foreground: var(--color-brand)`
declared only at `:root`. Dark re-declares its consumers, and `theme-check` pins this by
mutating `--color-brand` at runtime and asserting that all four consumers follow.

**Colour marks state, not surfaces.** Surfaces stay neutral — `--accent`, `--muted`,
`--color-line`, the canvas — and the semantic colours stay where they are: the highlight is
still yellow (chosen, per the comment in `style.css`, precisely so that a persistent mark
never reads as a transient selection), the dirty dot is still orange, `--destructive` is
still red, and the ledger's income/expense red and green are untouched. The check page
asserts that the highlight, dirty and destructive colours have not drifted towards the
brand hue, so "make it themed" cannot quietly swallow the vocabulary that means something
else.

**Contrast is a gate, not an opinion.** Primary-button text on the brand, and selection text
on the selection chip, are asserted at ≥ 4.5:1 in both appearances (measured: 6.36 / 5.82
light, 6.06 / 8.84 dark). The dark selection chip is also asserted to be *lighter* than the
card — in a dark appearance "selected" has to be brighter, and darkening it would sink it
into the surface.

**Considered.** *Painting the brand onto more of the UI* — a solid blue selection chip, blue
panel headers, a tinted canvas: rejected. The app is a place to read and write; an accent
that competes with the content stops being a signal. *Taking the bright or deep gradient
stop as the theme colour* — rejected above. *A `prefers-color-scheme` switch for the brand*
— no: the app's appearance is its own setting, and the brand follows that, not the OS.
