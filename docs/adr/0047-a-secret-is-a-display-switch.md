# A secret block is a display switch, not encryption

Notes are plain `.html` files in a folder the user picked. Anything the app can read, any text
editor can read, and any sync client will copy. A block that stores an API key therefore has exactly
one honest shape: **the value is in the file, and the UI does not put it on screen by default.**

What was rejected:

- **Encryption with a passphrase.** It sounds like the responsible option and is the worse one. A
  forgotten passphrase is an unrecoverable note; a passphrase the app remembers is a key sitting
  next to the ciphertext; and a user who believes the block is encrypted will paste things into it
  that they would never paste into a text file. Half-encryption that looks like encryption is how
  people get hurt.
- **Not storing the value at all** (only a pointer to a password manager). That is a different
  product, and it fails the actual case: a token you need to read back and paste into a terminal at
  2 a.m.
- **`type="password"` for the field.** Browsers treat it as a login form: password-manager popups,
  autofill heuristics, "save this password?" on an API key.

## The decision

**One card, one credential.** `SecretBlock { name, value, note }` — no tags, no list, no per-item
ids. A note that needs several keys holds several blocks; the block list already groups and
reorders.

**The mask is `SECRET_MASK` in `lib/secret.ts`, and it is a component-local `revealed` ref.** Masked
state renders a *button* showing `••••••••`; clicking it (or the eye) swaps in an `<input>` holding
the plaintext and focuses it — you open it in order to change it. Esc closes the plaintext without
bubbling (it must not also mean "leave the block"). Because `revealed` is component state, closing
and reopening the note always lands on masked; nothing persists the reveal.

**The plaintext never reaches visible text in the exported HTML.** `serialize.ts` writes
`data-secret` (the value) plus `data-name` / `data-note` on the wrapper `<div>` and `SECRET_MASK` as
the text content; `parse.ts` rebuilds the block from those three attributes and does not read the
children. So the rendered, shareable, "open it in a browser to show someone" form of the note shows
dots — the export is safe to *show*, while the file itself still round-trips losslessly.

**The value stays out of every text projection.** `blockText()` returns `${name} ${note}` only, so
search, outline, heading nav and the block's own text-ish behaviours never surface the key.

**Markdown export writes the plaintext.** It is the one place the value is deliberately emitted:
a `.md` file has no attribute slot to hide it in, and a silent `••••••••` would make the export
useless for the reason people export. This is a documented consequence, not an oversight: exporting
a note that holds a key to Markdown produces a file that holds the key.

## Consequences

- `design/parse-check` gained a secret round-trip fixture and two assertions that would fail if the
  mask ever slipped into an attribute or the plaintext into visible text (130 assertions total).
- `design/secret-check` (28 assertions) drives the real view: masked by default, the plaintext is
  absent from `textContent`, the eye reveals and focuses, Esc hides, `change` writes back through
  `setSecretFields`, copy yields the plaintext (not the mask) and flips the icon to ✓, an empty card
  says so and refuses to copy, and a close/reopen lands back on masked.
- `BLOCK_SPACING` and `DOC_STYLE` carry `.note-secret*` rules so the exported page looks like the
  editor's card. The mask is text, never a CSS trick — a rule that hides a value cannot be relied on
  to keep it out of a copied selection or a `curl`.
- `isTextualBlock` excludes `secret`, so it takes no text runs, no inline markdown, no drop-cap and
  no `data-editable` block body except the name field.

## Revisit if

Notes stop being plain files (a database, an encrypted vault) — then the honest answer changes and
the value could actually be protected at rest. Or if the user asks for a "hide value in Markdown
export" toggle, which would make the export stance a setting rather than a decision.
