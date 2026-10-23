# Dark surfaces are a ladder, not a shadow

The dark appearance was built by re-taking every colour token, and that part held up: the
brand brightens instead of inverting, the selected background is *lighter* than the card
rather than darker, and the ledger pair keeps its hues while gaining lightness. What never
got a second look is the layer above the colours — which surface sits on which.

Apple's dark-mode guidance is specific here: when one dark surface sits on another, depth
is expressed with two background sets, *base* (darker, the background recedes) and
*elevated* (lighter, the foreground comes forward). Measured in this stylesheet, that ladder
was broken in the one place it matters.

`--popover` and `--card` were both `oklch(0.205 0 0)` = `#171717`, and the editor surface
*is* `bg-card`. Every menu, popover, and centred dialog opens on top of it, so the tint
difference was **1.00:1** — literally none. The hairline that could have covered for it was
turned off by `ring-0` in twenty places. What remained was `--shadow-pop`, black at 5–10%,
which over `#171717` composites to roughly `#151515`: a *darker* halo around an identically
coloured panel. In light mode the same shadow works (black on white is visible), which is
why the defect only existed after dark.

The opposite error was next door. Thirty-one floating surfaces — the inline toolbar, the
HTML source drawer, every hover-revealed pill and the table's reference chip — used
`bg-background` (`#0a0a0a`), which is **darker than the card they float above**, and only
1.04:1 from the app canvas. Floating things were recessed.

Also measured: `--muted-foreground` reached 6.91:1 on the card (guidance asks for 7:1 on
small custom text); a white-background screenshot glows at 17.9:1 on the dark card, which
the guidance asks to soften; and `prefers-reduced-transparency` was handled nowhere,
although the app blurs two scrims and one overlay chip.

## The decision

**The dark ladder is monotonic, and it is a dark-only rule.** `--popover` becomes
`oklch(0.245 0 0)` (`#202020`, 1.10:1 over the card, stopping short of `--muted` 0.269 so
hover items still read). Full ladder: canvas 0.105 → background 0.145 → card 0.205 →
popover 0.245. Light mode is deliberately left flat — white paper on white canvas has always
been held together by shadow there, and forcing a ladder would repaint the whole app for no
perceptual gain. The assertion is therefore written for dark only.

**A floating surface is `bg-popover`, and it keeps its hairline.** All thirty-one sites
moved. `ring-0` became `ring-1 ring-line/70` in the fifteen menu constants and the dialog /
popover call sites. Light mode gains a hairline it did not have; at `--color-line` (light
`#e2e2e2` at 70%) it is nearly invisible next to the existing shadow, and it is what makes
the dark menu have an edge at all.

**Shadows get a second set, behind an indirection.** `@theme` values are *inlined* into the
utilities they generate — `.shadow-pop { --tw-shadow: 0 1px 2px … }` — so overriding
`--shadow-*` inside `.dark` does nothing. `--shadow-block/-island/-pop` now point at
`var(--elev-*)`, which `:root` and `.dark` each define. Dark values are 26–46% black rather
than 4–10%: the same 5% over `#171717` produces no perceptible change, and a shadow that
cannot be seen is not an elevation cue. Shadows remain *secondary* — the colour ladder is
the primary cue, and the shadow only speaks where the ladder cannot.

**Raising the floor raises the furniture too.** `--accent` (what `focus:bg-accent` paints
menu items with) was 0.269 — 1.19:1 over the old card, but only 1.07:1 once the popover
moved to 0.245, i.e. hovering a menu item would have stopped registering. It goes to 0.30,
back to 1.20:1 over the popover. `--muted` stays at 0.269: it is a resting surface, and most
of its uses sit on the card, not inside a menu.

**Smaller items.** `--muted-foreground` goes 0.708 → 0.72 in dark (6.91 → 7.22 on the card).
Content images are dimmed 6% in dark (`dark:brightness-[0.94]` on the image block and both
gallery covers) — the guidance's own remedy for images whose white background glows.
`@custom-variant reduce-transparency` wraps the four translucent surfaces (two scrims, the
HTML block's chip, two image delete buttons); with the setting on, they go solid and drop
`backdrop-blur`.

**`theme-check` asserts the ladder behaviourally.** Five new checks: the dark ladder is
monotonic, `--popover` differs from `--card`, menu hover still clears 1.15:1 against the
popover, and — because `--shadow-*` resolves through a substituted custom property and
therefore cannot be inspected as text — a real element with `shadow-pop` is mounted into
both scopes and its computed `box-shadow` is compared. 41 assertions total.

## Consequences

- `bg-background` is a page token again. Using it on something that floats is the mistake to
  watch for in review; the correct token for that is `bg-popover`.
- Changing `--shadow-*` in `:root` or `.dark` no longer does anything — the values live in
  `--elev-*`. Both are commented; the check page fails if the indirection is removed.
- Menus and dialogs now carry a hairline in light mode too. That is a visible change, small
  but real, and it replaced an explicit `ring-0` in fifteen constants.
- The 6% image dim softens a white background; it cannot neutralise one. A screenshot is
  still the brightest thing on screen, just less so.
- Block-toolbar buttons in their "cursor is inside this block" state moved from
  `bg-background` to `bg-muted`. The old value was white on a white card in light mode,
  i.e. the state had no visible rendering there at all.

**Considered.** *Keep `--popover` equal to `--card` and rely on the hairline alone* —
rejected: 10% white over `#171717` is 1.32:1, and twenty call sites had deliberately removed
exactly that ring; the guidance asks for a colour step, not a stroke. *Make the popover
darker than the card* — rejected: it inverts the direction the guidance defines, and reads
as a hole. *Give the pills `bg-card` instead of `bg-popover`* — rejected: they would still
match the editor surface they sit on, which is the original bug one layer down. *Blanket
`.dark img { filter: brightness(.94) }`* — rejected: it also dims photographs, where the
guidance has nothing to fix and the result just looks muddy. *Handle reduced transparency by
removing every `backdrop-blur` globally* — rejected: three of the four surfaces are scoring
contrast over arbitrary images, where transparency is the point.
