# Block type behaviour stays as exhaustive chains, not a dispatch table

The block type list is restated six times: `isTextualBlock` (thirteen `!==`), `createBlock`
(thirteen `if`), `retypeBlock` (eleven `||`), `cloneBlock`, `blockText`, and the per-type branch
at the top of `blocksToHtml`. An architecture review proposed folding all six into one
`Record<BlockType, TypeSpec>` — make, clone, text projection, write, read — so that a type is
described once and every call site becomes a lookup. **Rejected, and worth writing down because
the refactor reads as strictly better until you try to type it.**

**The blocker is the project's ban on type assertions.** Dispatching on a block's type and then
handing the block to that type's implementation requires the compiler to get from a value of type
`T` to `BlockOfType<T>`. With `as` that is one line. Without it there is no way to write it:
indexing a mapped table with `block.type` yields the *union* of behaviours, while each
implementation expects one member of that union. The remaining options are a twenty-seven-case
`switch` — longer than the chains it replaces — or a generic helper the compiler still cannot
prove sound. The chains are not sloppiness; they are what narrowing looks like with the assertion
hatch closed.

**Completeness is already enforced, which removes most of the table's value.** These are not
free-form `if` trees. Each ends in a branch that only type-checks when the remaining type is
textual — `block.runs`, `createTextualBlock(type)` — so adding a structural block type makes
`blockText`, `createBlock` and `retypeBlock` fail to compile at exactly the line that forgot it,
and `assertRegistryComplete` covers the half `satisfies` cannot see. A table would enforce the
same guarantee through `Record`, i.e. one mechanism instead of two: a real but small gain, paid
for with the loss of narrowing.

**What the review was actually pointing at has been fixed elsewhere.** The friction was never the
chains; it was the insert path — seven near-identical `insertXxxBlock` functions plus a type
ternary inside `convertBlockToFileType`, all restating "find or create a `.tbl`, then place a
block that points at it". That difference really was data (a factory plus an optional preset
table), not a narrowing problem, so it is now one flow in `useWorkspace.insertReferenceBlock`
driven by `REFERENCE_INSERT_SPEC`. A new reference block type costs one table entry.

**Considered.** *A table typed `Record<BlockType, (block: Block) => …>`* — every implementation
re-narrows internally, which moves the twenty-seven branches inside instead of removing them.
*One module per block type* (make / clone / text / write / read / view colocated, a registry
listing modules) — this is the shape that would actually make a new type cheap, but it is a
whole-repository move across thirteen structural and fourteen textual types, not an increment, and
the dispatch point still has to narrow.

**Revisit if** TypeScript gains narrowing over a computed table key, the assertion ban is lifted,
or a new block type starts touching sites beyond the six known ones.
