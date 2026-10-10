# Name collisions are checked, and refused

A Create whose target path already exists is rejected with a message, rather than being
written through and having the failure translated from whatever the platform reports.

`WorkspaceFs` therefore gains `exists(root, path)` as a first-class query. Doing the check by
attempting the write and catching an "already exists" error was rejected: the error shape
differs per platform in the Tauri fs plugin, arrives only after an IPC round trip, and would
have pushed a string-matching branch into `lib/errors.ts`.

**Consequences.** The Tauri capability needs `fs:allow-exists`. The browser implementation
needs its own existence helper (`getFileHandle` / `getDirectoryHandle` without `create`).
Names containing path separators or other illegal characters are refused at the same gate, in
validation code shared by both create paths, so the two never disagree about what a legal
name is.

**Considered.** Silent de-duplication (`未命名 2.html`): rejected — a file named differently
from what the user typed is misreported by the tree forever after.
