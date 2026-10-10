# Create rebuilds one directory, not the whole tree

Creating a Note or Folder writes to disk first and then re-reads **only the parent
directory** that gained an entry, replacing that folder node's `children` in the tree.

The alternative — re-scanning the whole workspace — is already implemented (`scanTree`), but
it reads every directory down to `MAX_DEPTH`, so creating one file in a large library costs
hundreds of directory reads. Appending the new node purely in memory was also rejected: the
tree would then claim a shape the disk was never asked to confirm, and any entry the user
added outside the editor would stay invisible until the next restart.

**Consequences.** `WorkspaceFs` gains `scanDir(root, path)`, so both implementations must be
able to read a single level (`policy.ts` factors out the one-level scan that `walk` uses).
The tree is still treated as a projection of the disk — it is just rebuilt a level at a time
instead of whole. A `Create` that fails on disk touches no state at all, which is why no
rollback path exists anywhere in the flow.

**Considered.** Whole-tree rescan: O(tree) per create, and it would have to reuse the
bootstrap path, which clears tabs and expansion state. In-memory splice: cheapest, but the
tree stops being a faithful projection of disk.
