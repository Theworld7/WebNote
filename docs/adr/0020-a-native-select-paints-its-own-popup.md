# A native select paints its own popup

The closed `<select>` is ours. The list that opens is not: it is drawn by the browser, outside
the DOM, with no access to our tokens. In the code block's language dropdown that showed up as a
white sheet carrying our `--muted-foreground` text — grey-on-white in light, and the same pale
grey on a dark toolbar in dark (see ADR-0019's block). Legible in neither.

**`color-scheme` is not the lever.** On a probe page with `<html class="dark">`, the element and
the root both computed `color-scheme: dark`, and the expanded list still came up in the system's
light palette. That property makes the *closed* control and scrollbars follow the appearance; it
does not repaint the platform menu on Windows, which is what a `<select>` popup is there.

**What the popup does read: the element's own colors.** The sheet takes the select's
`background-color`; each row takes the `option`'s explicit `background-color` and `color`. The
probe confirms both: three selects in dark with (a) transparent, (b) an opaque green, (c) green
plus `option { background: #7a1f1f }` rendered as nothing, a green box, and red rows inside the
green box. So the fix is to color those two things.

**Rows always, sheet only while open.** `select option` gets `--popover` / `--popover-foreground`
unconditionally — that is the part that actually darkens the list, and it has no effect on the
closed control. The element's own opaque background is scoped to `:focus` / `:open`, because the
same component is used as a *cell* in data tables and the kanban: there the select is meant to
read as a stretch of text inside a cell, and a standing background would drop a rectangle into
every select cell and break the grid's separation. The popup is built at open time, which is
exactly when those states hold.

**Not in `@layer`.** Every call site writes `bg-transparent`, and several write
`text-muted-foreground` — those utilities are the cause of the fallback, so these rules have to
beat them. Unlayered CSS does, without `!important`, and the comment in `style.css` says so.

**`option:checked` pins its own colors.** The native highlight can land black text on a dark row
in a dark popup; `--color-selection` / `--color-selection-foreground` are the same pair the block
selector and Monaco's selection use, so a highlighted row looks like everything else that is
selected.

**Considered.** *`select { background: var(--popover) }` for everyone* — the simplest rule, and it
turns every cell select into a filled box; rejected above. *`appearance: base-select` +
`::picker(select)`* — the picker becomes DOM, so it would be fully styleable and screenshot-able,
but it needs Chrome 135+ (WebView2 qualifies, WKWebView on macOS does not), and opting in means
rebuilding the closed control by hand (arrow, padding, focus ring) for all twenty call sites. *A
custom dropdown component* — the same twenty call sites, and native keyboard, IME and
type-ahead behavior would have to be re-earned. *Fixing only the code block* — the identical white
sheet opens from the bookmark, table, kanban, ledger and stat panels; the report just happened to
come from the language picker.

**Consequences.** The rows are ours; the few pixels of popup frame around them are still the
system's, which is only visible as a hairline at the edge of the list. A native popup cannot be
opened in headless Chrome, so section 十一 of `design/code-edit-check.html` asserts the three
sources instead of the result: resting background transparent, focused background opaque and equal
to `--popover`, `option` colors equal to the popover tokens with ≥ 4.5 contrast — in both
appearances. If a future change makes those pass and the popup still looks wrong, the engine has
stopped reading the element's colors and the answer becomes `appearance: base-select`.
