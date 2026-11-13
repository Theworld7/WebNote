# The heading nav owns its gutter

The floating heading nav sits at the editor's right edge and, at rest, is a column of short ticks
about 40px wide. The body column's right gutter, meanwhile, is `clamp(12px, 4.3cqw, 40px)` — it
shrinks with the editor. In a wide window the two just barely clear each other; narrow the window and
the gutter collapses to 12px while the ticks stay 40px, so the ticks land on top of the text. Reading
with a tick drawn through the last word of every line is not a floating ornament, it is damage.

**The decision.** When the nav is on screen, the body column's right padding has a floor of
`3.75rem`: the collapsed nav is `3.25rem` (`right-3` 0.75 + the card's `px-1.5` 0.75 + the button's
`px-1` 0.5 + the widest tick `w-5` 1.25), and half a rem of air keeps the text off the ticks. The
floor is written as `max(GUTTER_RIGHT, NAV_RESERVE)` and only while the nav is showing, so a note
with the nav off — or with fewer headings than the threshold — keeps the old breathing room and the
old column width.

## Fixed, not another clamp

The reserve is a constant even though the gutter next to it is a `clamp`. The two measure different
things: the gutter is breathing room for text, which may legitimately shrink with the column, while
the reserve covers an object of fixed width. Making the reserve a second `clamp` would only mean the
ticks start landing on the text again at some intermediate width — the failure the first version had.

It is in `rem` rather than px because the nav's own classes are: `px-1.5`, `right-3`, `w-5` all scale
with the root font size, so at a large base font the reserve grows with the ticks instead of being
overtaken by them. At the default font it is 60px.

## Only the collapsed state

Hovering expands the nav into a labelled card up to 13.75rem wide, over the text. That stays. The nav
is deliberately zero-cost at rest — ADR-0027's body column does not pay for it when nobody is looking
— and reserving space for the expanded card would push the text left by 200px for the entire session
in order to keep the mouse pointer from ever covering a word.

## Consequences

- `design/heading-nav-check.html` pins the reserve at two widths: padding-right ≥ 52px when the nav
  is up, the content's right edge never past the ticks' left edge, and — after squeezing the editor
  to 360px, where the `cqw` gutter bottoms out — the padding unchanged (the floor does not scale with
  the container).
- The column's `maxWidth` includes the reserve (`calc(… + GUTTER_LEFT + right)`), so a wide window
  grows the column by 20px instead of eating 20px of text. `settings-check`'s band assertion
  (`measure .. measure + 136`) never sees the reserve: its fixture has no headings, so no nav.
- No change to export geometry (ADR-0043): the nav is an editor-only ornament.

## Revisit if

- The nav ever becomes dockable or always-expanded — then it stops being an overlay and belongs in
  the layout, not in the gutter.
- A second floating thing wants the same edge (a scroll-to-top button, an outline rail). Then the
  reserve is a shared "right rail" width with one owner, instead of a constant living in
  `BlockEditor`.
