# The export asks where, then reads — and asks for a recursive grant

Batch export shipped in ADR-0041 with two defects that only show up on real disks. Both came from
the same habit: treat the destination as something you obtain at the end, after the work is done.

**Symptom.** Export a subfolder, then export its parent: the second one fails. The first one worked
because every note in it sat directly in the chosen directory; the parent has at least one level
(`日记/2026-10-08.md`), and that is where it stops.

**Cause.** `plugin:dialog`'s `open({ directory: true })` adds the picked directory to the fs scope
via `allow_directory(path, recursive)`, and `recursive` is `#[serde(default)]` — false. Without it
the granted pattern is `<dir>\*`, and Tauri matches scopes with `require_literal_separator: true`,
so `*` never crosses a separator. Writing `<dir>\日记\2026-10-08.md` is `forbidden path`. The
workspace root has always passed `allow_directory(root, true)` for exactly this reason
(`grant` in `src-tauri/src/lib.rs`); only the export dialog forgot.

**So the dialog is asked for `recursive: true`.** One word, and it is the difference between "can
write one level" and "can write the tree the user just asked for". Worth a note in the code as well
as here: the failure is silent about depth (the error names the file, not the grant) and it reads
like a "parent folder is broken" bug.

**The destination is picked before the notes are read.** `pickExportSink()` returns a sink —
a disk directory, a directory handle, or the download fallback — and `writeMarkdownTree(sink, files)`
fills it. Reading first, opening the dialog second, was the original order and it is wrong three
ways: the browser's directory picker requires *transient user activation*, which can expire while
a batch of notes (and the tables they reference) is being read; the desktop dialog appears seconds
late for no reason the user can see; and cancelling throws away the whole read. Picking first makes
all three disappear and costs nothing — the only thing `noteExportsUnder` needs to decide whether a
dialog is warranted at all is the tree, which is already in memory.

**A failed write no longer aborts the batch.** `writeMarkdownTree` wraps each file, so one
`forbidden path` or one full disk leaves the rest of the batch intact and reports exactly which
notes did not make it. The previous version let the first exception escape, which reported the
whole export as failed while half of it was already on disk. `ExportSummary.failed` therefore means
"these notes are not in the export" — read failure and write failure are the same outcome to the
user, and splitting the wording only asks them to guess which step broke.

**Consequences.** `saveMarkdownTree` is gone, replaced by the two-step pair; `design/markdown-batch-check.html`
stubs `__TAURI_INTERNALS__.invoke` to assert that the dialog carries `recursive: true` and that each
nested file is preceded by a `mkdir` of its own parent — the two facts whose absence caused this,
neither of which the browser branch can exercise. The single-note export still reads before it calls
`save()`; one note is milliseconds, and the picked file is granted on its own, so there is no depth
and no activation window to lose.

**Considered.** A Rust command mirroring `set_workspace_root` for the export directory: rejected —
it exists for the workspace because that grant must survive a restart, while an export target is
used for one batch and the dialog's own runtime grant is enough. Building the whole tree and
reporting one aggregate error: rejected, it is the behaviour being fixed.
