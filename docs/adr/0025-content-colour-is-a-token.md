# Content colour is a token, and every surface has two appearances

The brand had one source of truth and a contrast gate (ADR-0010). Everything a **user can
write into the document** had neither.

The nine inline text colours were Notion's light-theme values, hard-coded hex, applied as
`style="color: #787774"` and used unchanged in a dark window. Measured: yellow 2.75:1 and
orange 3.28:1 on white; the same nine on the dark card (`#171717`) sat at 3.98–4.20:1. The
ledger's income red and expense green were a single pair for both appearances — 7.07 and
6.21:1 on white, **2.80 and 3.19:1** in the dark window, which is not "a bit low", it is
the amount being erased. Subscription status colours were six bare hex values inside a
component, invisible to every check page.

Apple's colour guidance asks for two things this broke: every colour coordinated across
light and dark, and no colour that makes content hard to read. It also asks that one colour
not stand for different things — and `--color-selection` was doing three jobs at once:
"this is selected" (tabs, tree rows, option cells), "this is a tinted surface" (callout,
bookmark icon, chat bubble, trial badge) and "this just changed" (the ledger's flash row).

## The decision

**Three new token groups, all with a `.dark` counterpart.** `--color-tint` /
`--color-tint-foreground` for tinted surfaces, `--color-ledger-income` /
`--color-ledger-expense`, and `--color-status-ok(-foreground)` / `--color-status-warn(-foreground)`.
The subscription colours move out of the component and into the stylesheet, which is what
makes them assertable at all.

**`--color-selection` means selected, nothing else.** The five decorative consumers move to
`tint`. The callout keeps the export side's palette (`--accent-bg: #eef2ff` /
`--accent-fg: #313d6b`, dark `#232a45` / `#c3ccff`) instead of a second, near-identical
blue — "what you see in the editor is what you get on double-click" is a rule this codebase
already holds elsewhere.

**The inline palette is re-derived, not re-picked.** Hue stays Notion's, lightness moves
until each entry clears 4.6:1 on white (light) and 4.6:1 on the dark card. That is why
"yellow" is now `#9e6b02` — a yellow that survives as body text *has* to be that dark.
`TEXT_COLORS[].value` is the light value and the on-disk value; `TEXT_COLORS[].dark` feeds
the two generated consumers.

**The on-disk span gains `data-run-color`.** An inline `style` beats any stylesheet rule,
so re-colouring for dark needs an `!important` selector, and that selector needs something
to match on that is not "parse the hex back out". The attribute is the slot index (1–9).
The cost is one extra attribute on coloured spans only; default-coloured text is unchanged.

**Old values migrate on read.** `TEXT_COLOR_ALIASES` folds the previous nine hex values
into the new ones while parsing, so a note written before this change loses nothing and is
rewritten to the current palette on its next save. The alias table only grows — deleting an
entry silently drops colour from every note that still carries it.

**High contrast is a value set, not a media query.** `--hc-*` lives on `:root` / `.dark`
and `@media (prefers-contrast: more)` only forwards it into `--foreground`,
`--muted-foreground`, `--border` and `--color-line`. That split exists so
`theme-check` can read the values and assert them under ordinary conditions; a literal
inside a media query cannot be measured. `@media (forced-colors: active)` adds structural
cues instead of colour ones — `mark` takes the system `Highlight`, the callout and every
`bg-selection` surface get an inner outline, and the drag-selection overlay is dropped
(mixing modes do not survive forced colours, and it would otherwise cover the text).

**`theme-check` grew a content-colour matrix.** Nine inline colours × two appearances, the
ledger pair × two, three surface pairs × two, plus "the CSS mirror equals the palette
source" and "high contrast is stricter than the default". 36 assertions total.

## Consequences

- Adding a text colour means touching `TEXT_COLORS` only; `style.css` mirrors it and the
  check page fails if the mirror drifts. Export rules are generated from the same array.
- `forced-colors` support is bound to the Tailwind class name `bg-selection`. Renaming that
  utility silently loses the outline — the comment in `style.css` says so.
- Kanban sticky notes stay light paper in both appearances on purpose: paper is paper, black
  on pastel is 15:1 either way, and eight dark paper colours would be a second palette to
  keep in sync. They are therefore excluded from the matrix, deliberately.
- A dark appearance now has one fewer arbitrary colour: nothing in the app is allowed to
  keep a light-only value except the sticky notes.

**Considered.** *Reference the variables from the run's inline style* (`color: var(--run-color-3)`)
— rejected: the note is an ordinary HTML file on disk, and it has to keep its colour when
opened outside the app. *Match on `[style*="color: #787774"]`* — rejected: it works, but it
breaks on a hand-edited file without the space, and the failure is silent. *Store a second
palette in the file for dark* — rejected: two values per run with no way to tell which was
meant. *Darken the light values only and leave dark alone* — rejected: it fixes light and
makes dark worse (yellow would jump to 7.19:1 while the greys stay at 4.0).
