# WebNote

A block-based note editor. A note is a standalone `.html` file on disk; the editor reads
and writes those files directly, and the on-disk HTML is the canonical form of the note —
not a private format the editor happens to parse.

Alongside Notes the workspace holds **Data tables** — also standalone files, also plain
text on disk, but structured records rather than prose. A Note can point at one; it never
owns one.

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
One of eighteen identifiers. Fourteen are *textual* — they carry body content. Four are
*structural* and carry their own fields: `image`, `table`, `mermaid`, `datatable`.
_Avoid_: Kind, variant, tag

**Textual block**:
A Block whose body is runs. Headings, lists, quotes, code, todos, callouts and dividers are
all textual blocks — `divider` included, though its body is always empty.
_Avoid_: Rich block, text block

**Structural block**:
A Block that is not textual: an Image, a Table, a Mermaid diagram, or a Data table block.
Each owns its own fields instead of a run list.
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

### Data tables

**Data table**:
A workspace file holding structured records — a column list plus a row list — stored as JSON
in a `.tbl` file. It is a document in its own right, not an attachment: its path is a
workspace path like a Note's, it gets its own Tab, and it can be pointed at by any number of
Notes at once.
_Avoid_: Database, sheet, spreadsheet, csv, dataset

**Data table file**:
The `.tbl` file itself. Its extension is reserved to this editor's data tables — a bare
`.json` was rejected because the file tree can only see file *names*, so a workspace holding
a `package.json` would list it as a data table and offer to open it as one.
_Avoid_: JSON file, data file

**Data column**:
One field of a Data table: an id, a display name, and a type. Columns are ordered by their
position in the column list — the order is part of the data, and there is no separate
ordering field anywhere.
_Avoid_: Field, property, attribute, header

**Data row**:
One record of a Data table: a stable id plus one value per column, keyed by column id. There
is no row order stored — a view may sort by any column.
_Avoid_: Record, entry, item, line

**Column type**:
What a Data column's values mean: `text`, `number`, `date`, `select`, or `checkbox`. A value
is stored in the shape its type implies — a number is a number, a date is a date — not as a
string that happens to look like one, because sorting, filtering and summing all depend on
it. `select` is the only type whose values are a closed set: the options live on the column
and a row stores the option's id.
_Avoid_: Field type, data type, schema

**Data table block**:
A Block inside a Note that points at a Data table by workspace path. It carries the path and
nothing else — the records stay in the `.tbl` file, so the same table seen from two Notes is
the same table, and editing it from either place is the same edit.
_Avoid_: Embed, reference, view, database block

**Missing Data table**:
The state of a Data table block whose path no longer resolves. It is a normal, recoverable
state — the file may have been moved, renamed or deleted, and the user may want to point the
block at it again. It never marks the Note as broken and never blocks opening it.
_Avoid_: Broken reference, dangling link, error

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

**Snapshot exception**: A Note holding a Data table block does **not** round-trip exactly. On
the way out the block is written as the table's current contents — a plain `<table>` — so
that the exported file still opens on its own, without the `.tbl` beside it. Reading that
file back therefore yields a Table block, not a Data table block. The exception is confined
to this one block type and is deliberate: a Note that carries no Data table block round-trips
exactly as before.
_Avoid_: Lossy round trip (the loss is chosen and bounded, not incidental)

### Visual constants

**Typography spec**:
The numbers that fix how a block's text is laid out — font size, line box, marker indent,
heading scale. The editor and the exported Note must both be driven by the same spec; they
are two renderings of it, not two sources of it.
_Avoid_: Styles, theme, CSS

### Preferences

**Preference**:
A user choice that changes how the editor *shows* a Note without changing the Note. It is
stored outside the Note (in the app's own settings), so the same file opened on another
machine renders exactly the same. A Preference is never written into the exported HTML and
never makes a Tab dirty.
_Avoid_: Setting (the panel is the settings panel, but a single item is a Preference),
option, config

**Table effect**:
The Preference that decides what happens when a table in a Note is wider than the Note's
content column. It applies to Tables and to the table a Data table block renders as — but
not to a Data table's own editing view, which is always sized to the window and always
scrolls. Two values:
- *wrap* — cell text wraps, columns are squeezed, the Table stays exactly as wide as the
  content column and never scrolls. This is the default, and the shape the exported HTML
  always takes.
- *scroll* — cell text does not wrap, the Table is sized to its content and scrolls
  horizontally within the content column. A soft shadow at the right edge says "there is
  more to the right"; it disappears once the far edge is reached.

It is a Preference, not a Table property: it applies to every Table at once and is not part
of Block data.
_Avoid_: Table layout, table mode, overflow behaviour

### Bounds

**Table bound**:
The cap on how many rows and columns a Table **inside a Note** may hold. It exists to keep a
mis-clicked picker from producing a huge grid in the middle of a document, and it belongs to
the editor gesture, not to the table idea.

**Data table bound**:
A Data table has **no row cap**. Rows are what the file is for, and a record set that can
only hold sixty entries is not a record set. The column cap stays, because column count is
what drives the editing UI's width, not the scroll length.
_Avoid_: Limit, maximum, quota
