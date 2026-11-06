# A block type wears an icon, not a character

The block type menu had a left-hand column of monospace characters — `¶` for text, `H1`, `☐`, `●`,
`❝`, `{}`, `▧` for image, `▷` for video, `▤` for a data table, `▦` for a gallery, `☰` for kanban,
`◌` for chat. The note in `BlockTypeMeta` even carried an invariant for picking them: **one
character, filled, ink mass roughly like its neighbours (8–15px)**.

The invariant did not hold, and could not. Daily use reported six of them as "smaller than the
others" — image, video, data table, gallery, kanban, chat. Measured at the rendered 13px, their
bounding boxes were the *same* as their neighbours' (11×9, 11×10). What was smaller was the ink:
those six are line art, and a geometric shape in a 13px text run is drawn with exactly one physical
pixel of stroke. `☰` is three 1px bars 11px wide; `◌` is a dashed circle 5px tall; `▧` is 50%
hatching that reads as grey. Compare `●`, a filled 7×5 disc, which reads *heavier* than half the
column. A previous round swapped six glyphs for heavier ones (`•`→`●`, `[ ]`→`☐`, `"`→`❝`,
`</>`→`{}`, `!`→`※`, `—`→`▬`) and the complaint simply moved on to the next six. That is the
signature of a constraint that lives in text rendering, not in the character table.

## The decision

**`BlockTypeMeta.icon` is a `@lucide/vue` component.** The library was already a dependency and
already drawn in 49 files, so this adds nothing to the app — it only stops the menu from
hand-rolling a fourth visual language. Every icon sits on the same 24×24 grid with the same
`stroke-width: 2`, rendered at 14px in a 22px box (`BlockTypeIcon.vue`), which is the same 14px the
toolbar's `＋` uses. Optical weight is uniform *by construction*; nothing needs to be measured or
argued per block type.

**`BLOCK_TYPES` is still the one list.** Both menu layouts, the drag grip, and the action menu read
the icon from there; `MenuIcon.vue` exists only so the 22px box and the 14px size are written once.
Every other menu that hand-rolled a glyph column followed in the same pass — the action menu
(`⧉` copy, `⎘` copy content, `↻` convert, `✕` remove), the insert-position arrows (`↑` `↓`), and
the data table / table column menus (`✕` delete, `↑+` `↓+` `←+` `→+` insert, `▤` header, `↔` align).
A menu cannot carry two visual languages, and a toolbar with an icon grip next to a glyph menu reads
as unfinished. The one thing that stayed a character is the **selection mark** (`✓`), because it
reports state rather than naming an action — and a checkmark is the shape every menu already uses
for that.

**Choose the icon for what the block is, not for its geometry.** The failure mode of the old column
reappears in SVG form if two types draw almost the same picture: at 14px `TableIcon` and
`TablePropertiesIcon` are indistinguishable, and `ImageIcon` and `ImagesIcon` both read as "photo
with a mountain". Data table therefore takes `DatabaseIcon` (also the file tree's `.tbl` icon) and
gallery takes `LayoutGridIcon`. The only judge is a render at 14px, not the name.

**The glyph invariant is retired.** What replaces it is short: pick an icon that says what the
block *is*, and make sure it does not read as the same picture as a neighbour.

What this costs: an icon is markup, not text. Check pages that pinned characters (`kanban marker 是
☰`, `ledger marker 是 ¥`, `playlist marker 是 ♪`, and `drag-check`'s per-block comparison against
`meta.marker`) now pin the component identity or the rendered geometry (`viewBox`, `stroke-width`,
14px box) instead, and menu items are located by label alone. `menu-nav-check` gained the assertion
that every item carries a 14px icon on a 24 grid, so the property this ADR is about is checked
rather than assumed.
