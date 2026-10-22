# A reference block's settings are read and written by hand on both ends

An architecture review counted five places where one block setting is registered — the
`BlockSettingsPatch` type, a positional `createXxxBlock` parameter list, the attribute readers in
`parseXxx`, the attribute writers in `xxxHtml`, and the settings menu in the view — and proposed
one schema per type (`{ field, attribute, default }`) that all five derive from, so that adding a
setting is one line and a mistyped attribute name becomes a compile error. **Rejected after
checking: two of the five were already unified, and the rest are not interchangeable enough to
share a schema.**

**The patch type is not a fifth copy, it is the reason one function works.** `updateBlockSettings`
is already a single call for all seven reference block types, guarded by `isReferenceBlock`, and
`BlockSettingsPatch` — the intersection of the six settings shapes — is exactly what lets it take
any of them. Narrowing it per type would give a compiler error nobody has hit, at the cost of the
one seam that made seven `updateXxxBlock` functions collapse into one.

**The attribute names already agree, and the round trip proves it.** Comparing the two sides
directly: both read and write `data-gallery`, `data-columns`, `data-ratio`, `data-width`,
`data-fit`, `data-fields`, `data-group`, `data-group-by`, `data-group-order`, `data-kanban`,
`data-show-empty`, `data-income`, `data-expense`, `data-balance`, `data-group-mode`,
`data-sort`, `data-sort-dir`, `data-name`, `data-url`, `data-icon-column`, `data-role`,
`data-stat`, `data-precision`, `data-filter-column`, `data-filter-value`, `data-ledger`,
`data-bookmark`, `data-subscription`. Nothing is one-sided except `data-icon`, which is written
and deliberately never read back (the character is derived from the address, per the Link
contract). A rename that lands on one side only is the failure the schema would prevent, and
`design/parse-check.html` — 127 assertions, every block type through write-and-read — is what
would catch it today. The defaults are likewise exported constants used in the three places a
default has to exist: the `create` signature, the write-side "omit if default" test, and the
read-side fallback.

**A schema without converters cannot drive both sides, and with them it is the code it replaces.**
Reading is tolerant and coercive (`Number(...)` with a range check, `=== "contain" ? … : "cover"`,
comma-split into ids); writing is a conditional omit-if-default. The fields' value types differ
(`number`, `"auto" | number`, `string[]`, a `mode` union), so a triple of strings is not enough —
each field would need a parse closure and a write closure too. At that point the table is roughly
the size of the code it removes, and it puts an indirection between a reader and the attribute it
reads, which is the thing a person debugging a round trip wants to see directly.

**What the review did find next to it was real, and is fixed.** The duplicated settings code was
not in the block settings but in cell editing: three views each carried the same
"parse → compare → write" state machine, and `DataTableEditor` carried a verbatim copy of
`parseCellInput` while the comment in `lib/data-table.ts` warned that such a copy would let the two
entry points drift. Both are now `composables/useCellEditing.ts` plus the one function.

**Revisit if** a third consumer of those attribute names appears (a paste handler that reads note
fragments, a non-HTML export), if a setting must be renamed in both files at once, or if a
setting's default stops being a constant and has to be computed.
