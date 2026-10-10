# Dragging in the tree means "move into a folder", never "reorder"

A Note can be dragged onto a Folder row (or the workspace root row) to move it there. Dragging
is deliberately **not** a way to set sibling order, and Folders themselves are not draggable.

The forcing constraint is that a directory on disk has no order. The tree's sequence is
recomputed on every scan by `sortNodes` — folders first, then by name. A "drop between two
rows" gesture would therefore need somewhere to record the result, and the only places
available are a sidecar index file or an encoding smuggled into the file names. Both break the
project's founding rule: the files themselves are the note format, and deleting this app must
leave a directory that still makes sense.

**Consequences.** `Move` is only ever "change the parent folder, keep the name", so the only
things it can invalidate are the *path prefix* of the moved Note — which is why `migratePath`
exists and why only one key needs rewriting per state map.

A Move touches **two** directories (source and destination), so both must be rescanned. That
exposed a latent bug in the existing `replaceChildren`: a rescan uses `scanDir`, which is
single-level and returns every subfolder with `children: []`. When the rescan target was the
workspace root, the old implementation replaced the whole tree with those hollow nodes,
**wiping every already-loaded subtree** — the user's expanded folders would collapse and empty
out. `createInto` had the same defect but rarely tripped it, because a create at the root while
looking at a loaded subfolder is uncommon; a move almost always rescans the root.

So `replaceChildren` now recurses to the target path and replaces **only that one level**,
leaving every other folder's loaded children untouched. This is a correctness fix, not an
optimization. Folder dragging is not forbidden
by design so much as unsolved: it would add cycle detection (a folder dropped into its own
descendant) and whole-subtree prefix migration. Those are real work, not a config flag, so
they wait for their own turn. If they land, they land on top of `migratePath` unchanged —
which is why its prefix rule was written before any caller needed it.

**Considered.** A `sortOrder` column on a sidecar manifest: rejected, it makes the tree
authoritative over the disk. Inferring order from modification time: rejected, it would make
a Move silently reshuffle unrelated rows.
