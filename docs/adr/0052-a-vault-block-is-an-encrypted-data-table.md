# A vault block is an encrypted data table

A credential used to live in a `secret` block: one card, one key, and the value in plain text in
the note's own HTML — `data-secret="…"`, with `••••••••` as the visible text. ADR-0047 called that
the only honest shape and **rejected encryption outright**:

> It sounds like the responsible option and is the worse one. A forgotten passphrase is an
> unrecoverable note; a passphrase the app remembers is a key sitting next to the ciphertext.

That reasoning was sound for what it was about: *one key per note, in a file the user might well
email to themselves*. It is not sound for a password book. The request that produced this ADR was
the obvious one — a password manager's actual shape: many credentials, one place, and the file on
disk not readable by anyone who picks it up. This is the decision that follows, and it does
supersede ADR-0047.

## What was rejected

- **Keeping the `secret` block and adding a "lock" toggle.** A lock that hides text in the UI is
  what ADR-0047 already called out as the failure mode: the file still holds the plaintext, and a
  user who believes the block is protected will paste things into it that they would never paste
  into a text file.

- **Encrypting only the password column.** It leaves the account names, sites and labels in
  plaintext, which is most of what a password book reveals — *which services you use* is often the
  sensitive part. It also leaks password length through ciphertext length, and produces a file
  that is half-secret in a way nobody can reason about.

- **`crypto.subtle`.** The browser's WebCrypto API requires a **secure context**, and Tauri
  serves the frontend from `tauri://localhost`, which WebKit (macOS, Linux) does **not** treat as
  one — `crypto.subtle` is `undefined` there. The feature would have worked in `pnpm dev`
  (`http://localhost` is secure) and been dead in the packaged app. Pure-JS primitives
  (`@noble/ciphers`, `@noble/hashes`) have no such condition and behave identically in WKWebView,
  WebKitGTK, EdgeWebView2 and a plain browser — one implementation, four environments.

- **Storing the key next to the ciphertext** (in `webnote.json`, in `localStorage`, in the same
  folder). That is what ADR-0047 meant by "a key sitting next to the ciphertext": it encrypts
  nothing against anyone who copies the workspace.

## The decision

**A vault block is a reference block that points at a `.tbl`, and that `.tbl` is encrypted at
rest.** The block carries the path and one field mapping — which column is the password — and
nothing else. The records live in the table, as with every other reference block (ADR-0005).

**The file on disk is an envelope, not JSON.** It is still text, so any editor can open it, but
the table's contents are ciphertext:

```json
{
  "webnote-vault": 1,
  "kdf": { "name": "PBKDF2", "hash": "SHA-256", "iterations": 210000, "salt": "…" },
  "cipher": { "name": "AES-GCM", "iv": "…" },
  "data": "…"
}
```

The plaintext inside `data` is exactly `tableToJson(table)` — the ordinary data-table JSON.
**Encryption changes the on-disk form, not the data model.** Everything downstream — columns,
rows, cell types, select options, sorting, the registry's shared-object semantics — is unchanged,
and the table registry branches only once, where it reads the file.

**The key comes from a passphrase and lives in memory only.** PBKDF2-HMAC-SHA-256 at 210 000
iterations derives a 256-bit AES-GCM key. The key is never written to disk, never derived from
anything the app stores, and dies with the process: **the app has to be unlocked again next
time.** There is no "remember my passphrase" and no device key — a device key would make the
encryption only mean something against someone who copied the `.tbl` and not the rest.

**The salt is per-vault and permanent; the IV rotates on every write.** The salt belongs to the
key, so it cannot change without re-deriving the key (which needs the passphrase). The IV must be
unique per message under one key, so it changes every time. Same table, two writes, two different
ciphertexts. Permanent **except when the passphrase itself changes** — that is the one moment a new
key can be derived, so the salt is replaced then (ADR-0053).

**The exported `.html` contains a pointer and nothing else.** This is the one exception to
ADR-0006, which writes a snapshot *with* a pointer so the exported file stands alone. A snapshot
of a password book would put the credentials in plaintext into a file that is meant to be
double-clicked, forwarded and archived. So the vault block exports as
`<div class="note-vault" data-vault="…" data-vault-column="…">密码本（内容未导出）</div>` — it
says there is a password book, not how many entries it has or what they are called. The content
stays in the encrypted `.tbl`, which is where it belongs.

**The `secret` block is deleted, not deprecated.** Old notes may still contain
`<div data-secret="…">`. The parser recognises it and **does not read the value back** — reading
it would mean that opening an old note re-exposes the key, which is the exact thing this ADR
exists to stop. The block degrades to a short notice, and the plaintext disappears from the file
the next time the note is saved. This is deliberate data loss, and it is the right trade: the
alternative is that every old note stays a plaintext credential store that merely *looks* safe.

## Consequences

- `design/vault-check` (new) drives the real thing: the pure crypto (round trip, wrong passphrase,
  fresh salt per vault, rotating IV, no plaintext in the envelope), then the real editor over
  OPFS — locked by default, wrong passphrase rejected, right one unlocks, the password cell is
  masked until the eye is clicked, copy yields the plaintext, and the exported HTML and the `.tbl`
  on disk both contain no credentials.
- `design/parse-check` lost the secret round-trip fixture and gained a vault one, plus three
  assertions that a legacy `data-secret` block degrades rather than being read back.
- `useTables` gained a `locked` load state and an in-memory key map. It is the **only** place
  that knows a table can be encrypted: the registry reads a file, asks "is this an envelope?",
  and either decrypts it or reports the table as locked.
- The data table editor can open a vault `.tbl` from the file tree, and shows the unlock prompt
  there — a locked table is not a broken file, and the two must not be shown as the same thing.
- `TableRefNotice` gained a `locked` kind, so a reference block pointing at a locked vault says
  "go open it in a vault block" instead of spinning on "reading".
- `ADR-0047` is superseded. Its concern — a value that looks protected but is not — is now
  addressed rather than argued around: the value genuinely is encrypted, and the passphrase is
  genuinely not stored.
- `design/migrate-secret-to-vault.mjs` migrates a note that still carries `secret` blocks: it
  reads the plaintext out of the file, writes an encrypted table next to it, and replaces the
  blocks with a vault block. It borrows the app's own modules through Vite's SSR loader so the
  table shape and the envelope format keep exactly one definition. The rewritten note is then
  re-parsed by the real parser before anything is trusted.

## Revisit if

- The app grows a real keychain (macOS Keychain / Windows Credential Manager) as an *optional*
  second factor: derive the key from the passphrase, wrap it with a device key, and let the OS
  hold the wrapped form. That keeps "the passphrase is the only secret" while removing the
  unlock-every-launch friction. It must never become the *only* way in.
- Tables get shared between machines in a way that makes per-device keys painful.
- The reader wants a password book that is not a data table (fields that are not columns,
  attachments, TOTP seeds) — at which point the vault stops being a `.tbl` and becomes its own
  document kind.
