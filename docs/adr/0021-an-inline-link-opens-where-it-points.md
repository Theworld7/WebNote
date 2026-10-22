# An inline link opens where it points

A link run has carried an `href` since the read direction was written, but the editor did nothing
with it: `contenteditable` swallows anchor activation, so a click only moved the caret, and
Tailwind's preflight resets `a` to `color: inherit; text-decoration: inherit` — the link looked
exactly like the words around it. Two ends were missing, and they are one decision: **a link is a
live reference, not decoration.**

**The click gesture is the contentious part.** One click on a link in a contenteditable has two
readings: "go there" and "put the caret in this word". Nothing satisfies both, so it has to be
picked. We picked *go there* — plain left click, no modifier. Links are a minority of the words in
a note, and a person who clicks one almost always wants to leave; asking for Ctrl+click (the
Typora / Obsidian way) hides the feature behind a convention nobody discovers. The cost is stated
plainly: to edit a link's text you arrow into it rather than clicking it. One guard stays on —
a click that ends a drag-selection over the link does nothing, because the selection is the
intent, not the link.

**Editing a link is editing the whole link.** The popover carries two fields — the words it
displays and the address — because both are things a person wants to change, and `text` is also
the only thing that makes the link visible. A selection that starts inside an existing link
widens to its whole span before the popover opens: relabelling half a link while the other half
stays behind is not a state anyone asks for, and the field has to show what the link actually
says rather than whatever happened to be selected. Cancelling writes nothing and hands the caret
and selection back to the text; a click outside closes it without taking the caret back from
wherever the person just went.

**Where it goes is decided once, in `lib/link.ts`.** An address is free text typed into a popover,
so "is this a website or a document in this workspace" cannot be answered per call site. A scheme
(`https:`, `mailto:`, `data:`) is an external address and goes to the system browser; anything else
is read as a workspace path — the ` / ` form, slashes, backslashes from a disk path, and a
percent-encoded copy from a browser bar all fold to the same path — and if it ends in `.html` /
`.htm` / `.tbl` it has an editor here and opens as a Tab. That is the same set the file tree admits
(`lib/fs/policy.ts`), reused rather than restated.

**Not the app's own webview for external links, and not a silent no-op for broken ones.** An
external address leaves the app (`opener:default` already allows `http(s)` / `mailto` / `tel`);
opening someone's site inside the note application, with no address bar and no back, only looks
like a hang. A workspace path that resolves to nothing, or to a file type with no editor, writes
the reason into the existing error strip: a click that does nothing is the hardest kind of failure
to diagnose yourself.

**Both ends share the gesture.** The body of a textual block and a table cell hold the same runs,
so `linkHrefOf` (the gesture) and `followLink` (the navigation) are single definitions used by
both. `getAttribute("href")` rather than `anchor.href`: the latter resolves the relative address
against the app's own URL, and the workspace path is gone by the time you read it back.

**Style travels with the file.** The editor and the exported HTML each get the same rule — brand
colour plus a 40%-density underline that fills in on hover — because the standing promise is that a
note looks the same when double-clicked. The card shape is explicitly excluded from it rather than
left to cascade order; two rules of equal specificity quarrelling over one element breaks silently
the next time either file is edited.

**Consequences.** In the exported file a workspace-path link is just an `href` — a browser has no
workspace, so the in-app opening is an editor behaviour and the export keeps the raw address. What
lands in the note file is unchanged: still `href` on the `<a>`, no new attribute, so the round trip
and the old files are untouched.
