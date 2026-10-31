# Batch export mirrors the folder tree; batch import refuses duplicates

Exchanging Markdown had been one file at a time: `pickMarkdownFile` opened with `multiple: false`,
and export hung off a single note's menu because it needs a filename to offer as the default. The
note app's request — "batch import and export" — is two different problems wearing one label, and
they resolve in opposite directions.

**Export picks a directory, not a filename.** One dialog, then each note is written at its own
relative path under that directory, creating the folders it needs. Flattening everything into one
level was the obvious alternative and it does not survive contact with a real vault: `日记/2026.html`
and `工作/2026.html` both want `2026.md`. Renaming one of them to `2026 (2).md` is exactly the
silent de-duplication ADR-0002 rejected — a file whose name no longer matches what the user called
it is misreported by the tree forever after — and overwriting the first is worse. Mirroring the tree
is also the only mapping that round-trips: `folder/note.md` re-imported lands back in `folder`.

**Import takes many files and refuses the ones that collide.** One picker with `multiple: true`; each
picked file becomes a note in the target folder, named after its stem. A file whose name is already
taken is skipped, not renamed, for the ADR-0002 reason above. What is new is how it is reported: the
count comes back in one line ("已导入 3 篇，2 篇重名未导入") instead of raising `fsError` once per
duplicate. `fsError` means "something failed and it is still failing" — a note that already exists is
neither. The existence check runs before `createInto` for that reason, not because `createInto` is
untrusted: it still does its own check, and still raises `fsError` when called one note at a time.

**The mapping is a pure function.** `noteExportsUnder(tree, folderPath)` answers "which notes, at
which relative path"; `importSummaryText` / `exportSummaryText` answer "what do we tell the user".
Both live in `lib/markdown/batch.ts` with no filesystem access, because everything around them —
a real workspace root, a directory picker, a user gesture — cannot be driven from a check page,
while the part most likely to be wrong (path arithmetic, prefix boundaries, `.htm` vs `.html`) can.
`design/markdown-batch-check.html` covers it against a fake tree, and the browser branch of
`saveMarkdownTree` against OPFS.

**A batch opens no tabs.** `createInto` normally opens what it created, which is right for one note
and wrong for ten — the session is restored on next launch, so ten tabs would outlive the import.
Batch import therefore passes `openAfterWrite: false` and leaves the selection alone unless exactly
one file was picked.

**Path prefixes are compared segment by segment.** `日记` is not a prefix of `日记本/2026.html`, even
though the strings start the same. The tree walk therefore compares `toSegments(...)` element-wise,
the same rule `lib/paths.ts` uses for `migratePath` and `isUnder`.

**Not exported: tables, and `.md` files that are already in the workspace.** A data table is not a
note, and a `.md` file is already Markdown — copying it out would produce a same-name same-content
duplicate of something the user can open in place.

**Consequences.** Desktop export needs `fs:allow-mkdir` alongside the write permission it already
had. The directory chosen in the dialog extends the fs scope — but only one level deep unless the
dialog is asked for `recursive: true`, which is the trap ADR-0042 records. Without a directory
picker (browser debug mode) the batch degrades to one download per file with the path flattened
using `-`, which is ugly but never silently loses a note.

**Considered.** A zip/tar archive: rejected — it adds a dependency and an extraction step to what is
already the interchange format (a folder of `.md` files). One save dialog per note: rejected, that is
the behaviour being replaced. Auto-renaming on import: rejected, see ADR-0002. Writing the export
flat and refusing when names collide: rejected — the user's tree is legal, it is the layout that
would be at fault.
