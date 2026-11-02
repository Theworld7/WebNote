# A table's unsaved state lives only in the registry

The architecture review's fourth candidate: *a data table's dirty flag has two sources of truth.*
`useTables` marked each `entry.dirty`; `OpenTab` carried a `dirtyTables: string[]` list, written by
`markTableDirty()` which pushed onto **whatever tab happened to be active**. Save, discard and rename
each read that list, so it had to be maintained in four places — on every cell edit, on save, on
discard, on rekey — and any one of them missed a case leaves a change with no owner.

**It was not a duplicate, it was wrong.** A table is global state: one `.tbl` can be open in the
table editor and referenced by a gallery in two different notes at once, and there is exactly one
copy in memory. "Which tab changed it" is not a fact the data has — it is a fact about a UI session,
and the wrong session wins the moment two of them touch the same table. The failure that fell out of
this: change a table from note A's gallery, switch to that table's own editor tab (whose
`dirtyTables` is empty because it never edited anything), save → nothing is flushed, the dot stays
lit, and the change waits for a save that will never come from that tab. `design/data-table-check`
now covers it.

## The decision

**`OpenTab.dirty` means one thing: the note body changed.** `dirtyTables` is gone, `markTableDirty`
is gone. The register is the only thing that knows a table changed, and `entry.dirty` — set inside
`mutate` — is the only place it is set.

**"Does this tab have unsaved work" is computed, not stored.** `tabHasUnsaved(tab)` = body dirty,
or (a dirty table exists and this tab's surface can reach it — its own file for a table tab, the
tables its blocks reference for a note). It is asked by the tab dot, by the close dialog's dirty
count, and by the delete dialog. A note whose block was just removed stops counting the table it
used to reference — that table is still dirty, but it is no longer *this note's* surface, so it does
not follow the note when the note is discarded; the window-close guard covers it.

**Save flushes every dirty table, not this tab's.** One copy in memory, one answer: whichever save
runs first should write it down. The cost is that saving A can write a table changed from B's
surface — but the content written is the content both surfaces are looking at, so there is nothing
to reconcile. The narrower rule (only the tables this tab references) would reintroduce the original
bug for any table reached from two places.

**Discard reloads by reference, not by recollection.** `resolveClose("discard")` walks
`tablesTouchedBy(path)` — the tables reachable from that note's blocks — and reloads each from disk.
Reloading a table that was never changed is a no-op, so the wider set is safe; the narrower one
cannot be reconstructed once the record of "who changed it" is gone.

**The sixth port member.** `TableRegistry` (the shape `App.vue` hands across the existing
cycle-breaking seam) gained `dirtyPaths()`, and `useWorkspace` holds it in a `computed`. That
computed only works if `dirtyPaths` in `useTables` subscribes to each entry's `dirty` *and*
`revision` — reading a map of refs is not tracking them, and the symptom would be a tab dot that
never lights up.

## Consequences

- Rename and delete guard on `dirtyTablePaths.value` directly (the register's union) instead of
  building the same union from tabs. Nothing to keep in sync.
- `EditorTab` takes an `unsaved` prop instead of reading `tab.dirty`; the tab bar computes it, since
  it is the only layer that can see both the register and the reference graph.
- `data-table-check` gained two: "改了表、正文没动，这个标签仍算未保存" and "表在别处被改脏，保存
  仍要把它落盘". Reverting the flush condition to `tab.dirty ? …` fails four of them.
- `ledger-edit-check` asserts the same thing from the component side, right before its save step.

## Revisit if

A table's changes ever need to be discarded per-note while another note keeps them, or if more than
one registry can exist in a session (separate windows with separate in-memory copies). Both would
make "the register is the only answer" false rather than merely inconvenient.
