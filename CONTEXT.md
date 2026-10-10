# WebNote

A block-based note editor. A note is a standalone `.html` file on disk; the editor reads
and writes those files directly, and the on-disk HTML is the canonical form of the note —
not a private format the editor happens to parse.

## Language

### The note document

**Note**:
A single document, stored as one `.html` file. It is also the working unit: one Note is open
in one Tab at a time.
_Avoid_: Document, page, file

**Block**:
The atomic unit a Note is made of. Blocks are a flat list, not a tree.
_Avoid_: Element, node, item, paragraph

**Block type**:
One of seventeen identifiers. Fourteen are *textual* — they carry body content. Three are
*structural* and carry their own fields: `image`, `table`, `mermaid`.
_Avoid_: Kind, variant, tag

**Textual block**:
A Block whose body is runs. Headings, lists, quotes, code, todos, callouts and dividers are
all textual blocks — `divider` included, though its body is always empty.
_Avoid_: Rich block, text block

**Structural block**:
A Block that is not textual: an Image, a Table, or a Mermaid diagram. Each owns its own
fields instead of a run list.
_Avoid_: Widget, embed, special block

**Depth**:
A textual block's nesting level, starting at 0. Nesting is expressed as a number on a flat
list — there is no tree of blocks.
_Avoid_: Indent, level (level belongs to the exported HTML structure, not the model)

### Block body

**Run**:
A contiguous span of text inside a textual block, carrying the inline marks in effect over
it. A block's body is a sequence of runs, never a string.
_Avoid_: Span, segment, text node

**Inline mark**:
One of six character-level formats a run can carry: bold, highlight, italic, underline,
strike, code. A link is *not* a mark.
_Avoid_: Format, style, decoration

**Link**:
A run's `href`. It is a property of the run, not one of its marks — so "a run marked as a
link but holding no address" cannot be represented.
_Avoid_: Anchor, hyperlink mark

**Canonical run form**:
The normalised shape every run list must be in: text non-empty, marks deduplicated and
ordered, adjacent runs with identical marks and href already merged. Runs that leave the
editor and runs that enter it both pass through this form.
_Avoid_: Normalised form, sanitised runs

### The workspace

**Workspace**:
The user-chosen root folder the file tree is built from. A Note's path is always relative to
it.
_Avoid_: Project, vault, root (root is the adapter-level handle on the folder, not the
concept)

**Folder**:
A directory under the workspace. It is not a document and holds nothing itself — its only
role is to be a segment of the Note paths beneath it. It can be created, but never opened.
_Avoid_: Directory, group, category

**Note path**:
A Note's location under the workspace, written as folder names joined by `" / "` and ending
in the file name. It is the identity of an open Tab, and a Folder's identity is the path
prefix that all Notes under it share.
_Avoid_: Full path, key, url

**Create**:
Adding a new Note or Folder to the workspace. The name is chosen before anything is touched
on disk; the file or directory is written first and the tree is rebuilt from it afterwards,
so a failed Create leaves the workspace exactly as it was.
_Avoid_: New, add

**Name collision**:
A Create or Move whose target path already holds something. It is refused outright — the
editor never resolves it by appending a suffix, because a silently different name on disk
than the one the user typed is a lie the file tree would then repeat.
_Avoid_: Conflict, duplicate name

**Move**:
Changing a Note's Folder without changing its name, by dragging it onto another Folder (or
onto the workspace root row). It is not a reordering: the disk has no notion of sibling
order, so the tree's sequence is always recomputed from names and a Move can never express
"put this above that".
_Avoid_: Drag-and-drop, reorder, relocate

**Tab**:
An open Note within the editing session. Tabs are few and each has a dirty flag; a note can
be open or not, but a Note is never "half-open".
_Avoid_: Buffer, editor instance

**Dirty**:
A Tab's state when its in-memory blocks differ from what is on disk. It is per-Tab, not
per-Block.
_Avoid_: Modified, unsaved, pending

### Two ends of one wire

**Blocks-to-HTML** (the write direction):
Turning a block list into the canonical HTML form of a Note.

**HTML-to-blocks** (the read direction):
Reading a Note's HTML back into blocks. It is lenient by design — it accepts HTML the editor
never wrote.

**Round trip**:
Reading back a Note the editor has just written reproduces the same blocks exactly. This is
the property the two directions must jointly hold.
_Avoid_: Serialisation / deserialisation (they name one direction each; the round trip is a
property of the pair)

### Visual constants

**Typography spec**:
The numbers that fix how a block's text is laid out — font size, line box, marker indent,
heading scale. The editor and the exported Note must both be driven by the same spec; they
are two renderings of it, not two sources of it.
_Avoid_: Styles, theme, CSS
