# Page CSS is formatted in the drawer, compacted on save

The page style is one string in `<head>` with no editor of its own — it is edited in the same
Monaco drawer as an HTML block's source. In the file it is compact: a note that has a page
style usually has a handful of rules on one line, because that is what an export or a
one-off edit leaves behind, and because the `.html` file is read by people and by git rather
than by a bundler. In the drawer that same line is unreadable: no wrap points, no way to see
where one rule ends.

**Formatting lives in the editor buffer, never in the file.** On open, the CSS is run through
prettier (standalone + its postcss plugin) and the editor is seeded with the result; a
`格式化` button re-runs it after the text has been pasted in or mangled. On commit the text is
compacted back to a single line. The two directions are separate functions
(`lib/css-format.ts`) because they have opposite failure policies: formatting is display-only
and may fail — a failed prettier load or an unparsable stylesheet leaves the raw text in the
editor and costs nothing — while compaction is on the write path and must always produce a
string.

**A no-op commit returns the original text.** Without this, opening a note and pressing
`完成` would rewrite its `<style>` with prettier's indentation, and the file would grow one
formatting layer per visit. The drawer remembers what it displayed and, if the buffer still
equals it, emits `props.source` instead of the compacted buffer. Reverting an edit to exactly
the displayed text counts as a no-op too — that is the same file either way.

**Compaction is not a minifier.** It removes redundant whitespace and semicolons; it does not
rewrite values (`#ffffff → #fff`, `0px → 0`, merging equal rules) and does not drop comments.
Those optimizations buy tens of bytes on a note-sized stylesheet and risk changing what the
author wrote — `calc(100% - 10px)` needs its spaces, a custom property's value is text, and a
`/* 标题间距 */` comment is a note the user left for themselves. Whitespace is dropped only on
the tight side of `{ } ; , : ( ) > ~`, never before `:` or before `(` — so `a :hover` keeps its
space (it is a descendant selector, not the same rule as `a:hover`) and `and (min-width:…)`
does not collapse into the function token `and(`.

**Considered.** *Monaco's built-in CSS formatter* (`formatDocument` already works in this
drawer) — zero dependencies, but its output is whatever the CSS language service decides and
cannot be aligned with the prettier the rest of the project uses. *Saving the formatted text*
— the file then carries indentation that no tool regenerates, and every open/close pair shows
up as a diff. *csso / a real minifier* — rejected above; the saving is not worth value
rewriting on user data. *A "format on save" setting* — a preference nobody turns off,
guarding a decision that has one obviously better answer. *Formatting only on an explicit
button, not on open* — an unformatted stylesheet is exactly the thing the button exists to
fix, and making the user press it every time is the cost the automatic path avoids.

**Consequences.** The `<style data-note-style>` body is a single line, so a pretty-printed diff
of a page style is not available (the diff is per-note, not per-rule). Formatting is a few
hundred KB loaded on demand — `formatCss` imports prettier dynamically, so a session that
never opens the CSS drawer never downloads it. The preview path is unaffected: `scopeCss` runs
the CSSOM on whatever text arrives, compact or not. A stylesheet prettier rejects keeps the
raw text and the compact commit still works, because compaction is a character scan, not a
parse.
