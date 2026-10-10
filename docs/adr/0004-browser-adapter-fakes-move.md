# The browser adapter fakes `move` by reading, writing, then deleting

`WorkspaceFs.move(root, from, to)` exists on both adapters, but only the Tauri one maps to a
real primitive (`rename`, which the fs plugin documents as "renames (moves), paths may be
files or directories"). The File System Access API has no move operation, so the browser
adapter performs one as read → write at the destination → delete the source.

This is the unglamorous option and it is chosen on purpose. `FileSystemFileHandle.move()` does
exist and is a single call, but it is not in the specification, is Chrome-only, and would
therefore make the browser adapter — the one the `design/*.html` probes and `pnpm dev` run on —
behave differently from the adapter users actually ship. A probe that passes on a private API
proves less than one that passes on the path the app takes.

**Consequences.** The copy is not atomic: a failure between the write and the delete leaves
the Note in both places. Callers must treat that as a real outcome and surface it rather than
assume the move either fully happened or did not happen at all. The source is only deleted
after the destination write resolves, so the failure mode is a duplicate, never a loss.
Deleting is an internal step of `move` and is deliberately **not** exposed on `WorkspaceFs` —
a standalone delete carries its own questions (open tabs, unsaved edits, confirmation) and
gets its own decision when it is asked for.
