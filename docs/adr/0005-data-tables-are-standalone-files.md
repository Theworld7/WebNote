# Data tables are standalone `.tbl` files that Notes point at

A Data table is a workspace document in its own right: a `.tbl` file, one per table, holding
a column list and a row list as JSON. A Note reaches one through a Data table block, which
carries the table's workspace path and nothing else. Any number of Notes may point at the
same table, and the table outlives all of them.

The forcing requirement was that **one table be usable from several Notes**. That single
sentence rules out the shape that would otherwise have been the obvious one — carrying the
records inside the Note's own HTML, the way a Table block does. Inlined records belong to
exactly one Note: a second Note could only hold a copy, and two copies of one record set
drift. The project's founding rule is that what is on disk is the truth and there are no
derived copies to keep in step, so the records have to live in one place and be *pointed at*
from the others.

**Consequences.**

`Block` gains a fifth shape, `datatable`, and the block union goes from four to five. It is a
structural block: it owns a `path` field and carries no runs. Every dispatch point that
already lists the structural types (`isTextualBlock`, `blocksToHtml`, `createBlock`,
`cloneBlock`, `blockText`, `retypeBlock`) gains one more arm, and
`assertRegistryComplete` does its job — a missed arm fails to compile.

The file tree gains a second file kind. `FileNode.kind` goes from `"folder" | "file"` to
`"folder" | "note" | "table"`, which is a widening of a discriminated union that the whole
tree already narrows on. `.tbl` files are listed as their own rows, beside the Notes, exactly
as they sit on disk.

`WorkspaceFs` does **not** change. `readNote` / `writeNote` are plain text reads and writes
at a workspace path — the names say "note" because Notes came first, not because the channel
knows what a note is. A Data table goes through the same two methods. That the names are now
slightly too narrow is a naming debt, not a capability gap.

A Note holding a Data table block **stops round-tripping exactly**: on the way out the block
is written as the table's current contents, a plain `<table>`. That trade is taken in the next
section. The exception is bounded to this one block type; a Note without a Data table block is
unaffected, and the `parse-check` round-trip assertions still hold for it.

The extension is **`.tbl`**, not `.json`. The file tree is built from file *names* — `readDir`
returns `name` / `isFile` / `isDirectory` and nothing else — so a bare `.json` could not be
told apart from the `package.json`, `tsconfig.json` and every other JSON file a developer's
directory holds. Those would be listed as data tables and offered for opening as such. A
reserved extension makes the classification a property of the name, which is all the scan
has, and it costs only the syntax highlighting an editor would give a plain `.json`.

## An exported Note writes the table's contents, not a pointer

When a Note is written out, its Data table block is serialised as the table's **current
contents** — a real `<table>` with the columns as its header row. It is not written as a
pointer, a link, or an `<iframe>`.

This costs the Note its exact round trip, and that price is paid deliberately. The project's
central promise is that a `.html` file this editor wrote can be double-clicked and read with
nothing else present — the README opens by saying so, and `mermaidHtml()` already refused
inline SVG to protect a weaker version of the same property. A pointer would leave the
exported file with no table in it at all whenever the `.tbl` is not beside it, which is the
normal case once somebody mails the file. An `<iframe src="客户.html">` is worse: it makes the
file stop being self-contained *and* still shows nothing when moved.

So the export is a **snapshot**, and the word is honest: it is a picture of the records at the
moment of writing. Editing the `.tbl` afterwards does not reach back into an already-exported
file, exactly as editing a Note does not reach back into a copy that was already saved
elsewhere. What a reader gets is what the writer last wrote.

Reading the exported file back yields a Table block rather than a Data table block, because
that is what is now in it — and that is the correct reading. The block model gains the table
it can see, not a reference to a file that may not exist. Re-pointing at a Data table is an
explicit action, not something inferred from a file that no longer says it.

**Considered.** *A pointer that renders as a link* — rejected: the exported file loses its
contents under the most common transport (send it to somebody). *Rewriting the pointer back
into a Data table block on import* — rejected: it needs a rule for deciding that a given
`<table>` was originally a reference, and any such rule guesses. The deliberately ambiguous
case is a hand-written Note containing exactly one table; under this decision it stays a
Table, which is the safe reading.

**Considered (where the records could have lived).**

*Records inline in the Note's HTML* — the shape a Table block takes. Rejected on the
requirement itself: it cannot be shared. It would also have made a Note and its records a
single file, so "save the note" and "save the records" could never be separated again.

*Storing the records in the `.html` file but as a `<script type="application/json">` island*
— still one file, still unshareable. Same rejection.

*`.json` with a marker key inside* — the file would stay a universally readable `.json`. But
the scan only sees names, so every `.json` in the workspace would enter the tree, and the
only way to tell a data table from `package.json` would be to read every one of them during
`scanTree`. A hundred-file library would pay a hundred IPC reads to draw a file list.

*Merge a same-stem `.tbl` and `.html` into one tree row* — considered for the user's benefit,
since `客户.tbl` and `客户.html` next to each other read as two halves of one thing. Rejected
after working through the consequences: the merged row is a node the disk does not contain,
so the tree stops being a projection of the disk — the premise ADR-0001 and ADR-0003 both
build on. It also widens `kind` to a fourth, *derived* value, adds a pairing pass to both
scan implementations that must agree on case-folding, and turns Move into a paired operation
whose second half can fail after the first succeeded — against ADR-0001's "a failed Create
touches no state", which is why no rollback path exists there. The two-row presentation also
turns out to say something true: a shared table *is* its own thing, and showing it as a row
of its own is what makes "several Notes use this" visible.
