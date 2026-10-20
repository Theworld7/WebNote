# A code block formats on a button, inside the buffer

The edit toolbar gained a `格式化` button. It runs the code through prettier and replaces the
editor's buffer with the result; the file is still written by the commit path that was already
there (blur, `Ctrl/⌘ + Enter`, or `完成`), so pressing `Esc` after formatting throws the whole
thing away exactly as it throws away typing. Nothing about the block model, the runs, or the
exported `<code>` changes — a formatted block is just a block whose text happens to be tidy.

**Coverage is prettier's, not the block's.** The language dropdown offers thirteen entries;
prettier has parsers for seven of them — css, html, javascript, typescript, json, yaml,
markdown. The other six (plain text, python, shell, sql, go, rust) have no formatter anywhere
in the browser, so the button is **disabled with an explanatory title** instead of hidden.
Hiding it would make the toolbar change width every time the language changes, and would leave
a user who writes TypeScript all day wondering why a feature they heard about never appears.

**estree is not optional.** prettier's babel and typescript plugins only parse — their printers
live in `plugins/estree`, and the standalone build has no default plugin set, so handing it
`plugins: [babel]` fails outright with `Couldn't find plugin for AST format "estree"`. The bug
survived the type check (the option type accepts any `Plugin[]`) and only showed up when the
harness pressed the button, which is why the spec table loads plugins per language rather than
assuming "one plugin per language".

**The file is not the buffer, and formatting is not a write.** This is the opposite of the page
style (ADR-0012), where formatting is automatic on open because the file is compact and
unreadable until someone expands it. A code block's text *is* the note's content; formatting it
silently on entry would rewrite the user's source every time they clicked edit, and the diff
would appear even if they only came in to read. So: a button, and the result stays in the
buffer until the ordinary commit path runs. Reformatting something already formatted is a no-op
that leaves the buffer untouched, so a second click cannot accumulate anything.

**The cursor is translated, not reset.** `prettier.formatWithCursor` takes the caret's offset
and returns the same logical position in the formatted text; `formatCode` clamps the incoming
offset into `[0, source.length]` first, because prettier asserts on it and a caret at
end-of-text after a trailing newline is one past the end. Without this the caret would jump to
line 1 after every format, which reads as "the editor threw my position away".

**Two undo stops bracket the edit.** `pushUndoStop` before and after means one `Ctrl+Z` reverts
one format, instead of folding the reformatting into whatever was hand-typed before it.

**Failure is silent except for the button label.** Code being edited is routinely incomplete,
and prettier rejects incomplete code; a dialog per aborted format would be noise. The button
shows `无法格式化` for 1.5 s and the buffer keeps its text. The same path covers a failed plugin
load — the format is display-layer only, and losing it costs nothing but a reparse.

**Async, so the handle is re-checked on the way back.** The first format of a language downloads
its plugin (babel + estree is the heavy pair), which is long enough for the block to have left
the edit state. `formatCodeEditor` compares the module's `active` handle after the `await` and
bails if the instance is gone — touching a disposed Monaco editor throws inside Monaco's own
service container, far from anything the reader could interpret.

**Considered.** *Monaco's built-in document formatting* — free for css/html/json/ts, but its
output is whatever each language service decides and cannot be aligned with the prettier that
already formats the source drawer; two formatters would mean two answers to "what does
formatting do". *Formatting on entry, like the page style* — rejected above. *Writing the block
from the format action instead of the buffer* — one unrecoverable write per click, and no way to
back out. *A per-language "format on save" preference* — a setting whose only good value is
"on", guarding a decision that has one obviously better answer.

**Consequences.** `lib/source-format.ts` now owns the language→(parser, plugins) table and
returns the cursor offset alongside the text; `formatCss` / `formatHtml` become thin wrappers
over the same `formatCode`, so the drawer and the code block cannot drift apart. Plugin modules
are cached per package, not per language — `javascript` and `json` share babel, `typescript` and
`javascript` share estree. `design/code-edit-check.html` covers the three states of the button
(enabled / disabled / reformatted) plus "formatting does not write the block".
