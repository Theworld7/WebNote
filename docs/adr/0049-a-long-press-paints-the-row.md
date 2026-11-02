# Holding a row paints it before the menu opens

On a touch screen the file tree has exactly one way to reach a row's menu: press and hold. Up to
this point that worked and was invisible. reka's `ContextMenuTrigger` already runs a long-press
timer, but with two problems: the default `pressOpenDelay` is **700ms**, which is a long time to hold
a phone still, and nothing on screen changes during it. Tailwind v4 also scopes `hover:` to
`@media (hover: hover)`, so on a finger there is not even the hover wash a mouse gets — the row is
pixel-identical from touch-down to menu, and the user has no way to tell whether the press registered
or whether they are holding the wrong row.

What was rejected:

- **CSS `:active`.** The obvious answer, and wrong on the one device it matters for. Chrome does not
  apply `:active` to a touch point inside a scrollable container until it has decided the gesture is
  not a scroll, and on the real tree row it never decided: measured with CDP touch input, 580ms of
  holding produced `matches(":active") === false` at every sample and a completely transparent
  background. iOS Safari adds its own condition (the element needs a touch handler). A state the
  browser may or may not grant is not a state.
- **A ripple.** It needs the touch point, a pseudo-element, and a keyframe animation — three things
  to make feel native, for a list row that is 28px tall.
- **A press scale (`active:scale-[0.985]`).** Rows are a tight stack; shrinking one makes its
  neighbours appear to shift.
- **Haptics.** `navigator.vibrate` is Android-only; the app also ships as a desktop window, where it
  is a silent no-op. One platform's confirmation is not worth a branch that reads as a bug on the
  other.

## The decision

**500ms, in one constant.** `LONG_PRESS_MS` (`lib/touch`) is passed as `pressOpenDelay` at all three
menu triggers — folder row, file row, tab. 500 is where iOS and Android both put their own
long-press, and it is the number the *style* has to agree with.

**The held state is computed, not inherited from the browser.** `usePressHold` sets a `pressed` ref
on `pointerdown` when `pointerType !== "mouse"`, clears it on `pointerup` / `pointercancel`, and also
clears it once the finger moves more than 8px — scrolling a list should not drag a wash along every
row it passes. The component renders it as `data-pressed`, which is also what the self-check can
assert on, unlike `:active`.

**Three layers of background, and each one answers a different question.** `hover:bg-muted` on
pointer devices; `data-[pressed]:bg-muted-strong` with `data-[pressed]:duration-500` while holding;
`data-[state=open]:bg-muted-strong` while the menu is open, so the row the menu belongs to stays
marked even after the finger lifts. The entry transition is 500ms (`duration-500`) and exits in
100ms — a slow fill that ends exactly when the menu appears, and a fast retreat when the press is
abandoned. Measured with real touch input: 20% at 120ms, 90% at 300ms, 100% at 580ms, and the row
stays dark after release because `data-state` took over.

**Tabs use the same timing, not the same colour.** An inactive tab fills to `muted-strong` like a
row. The *active* tab is already `bg-selection`; filling it grey would read as "this tab is no longer
selected", so it only dims to `bg-selection/90`.

## Consequences

- The number lives in two places by necessity (a TS constant and a Tailwind duration class).
  `context-menu-check` reads `data-[pressed]:duration-(\d+)` off the rendered row and compares it
  with the imported constant, so the two cannot drift silently.
- `context-menu-check` grew a touch section (31 assertions total): press paints, a 20px move takes it
  back, the menu is still absent at `LONG_PRESS_MS - 150` and present at `+150`, the row carries
  `data-state="open"` and computes to `muted-strong` while the menu is up, and releasing does not
  also open the file — reka's modal menu swallows the trailing click, which is why the row's `@click`
  still works normally on a short tap.
- Mouse users gain a 100ms colour transition on row hover that was previously instant, and no press
  state at all — `usePressHold` ignores `pointerType === "mouse"`.

## Revisit if

The tree becomes a virtualised list, where a pressed row can be recycled mid-press. Or if the app
ever grows a gesture layer of its own (drag-to-reorder on touch), at which point press/hold/long-press
should live in one place rather than two.
