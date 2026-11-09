# Changing a passphrase re-keys the vault

ADR-0052 fixed the salt: *per-vault and permanent*, because the salt belongs to the key and a new
salt needs the passphrase — which the app never stores. That is still right for every write. It is
not right for the one action where the passphrase is in hand anyway: **changing it**. Keeping the
salt would mean the old passphrase still derives a key for the same file, and that two files can
be attacked from the same starting point.

So this ADR adds two things ADR-0052 did not have — a way to change the passphrase, and a stated
rule for what a passphrase has to be — and it narrows one of its sentences.

## The rules a new passphrase has to pass

At least 8 characters, with at least one uppercase letter, one lowercase letter, one digit and one
symbol (anything outside `[A-Za-z0-9]`). `passphraseProblem` in `lib/vault.ts` is the **only**
implementation: the insert dialog and the change-passphrase panel both call it, so the two can
never drift into two different ideas of "strong enough".

The message says what is missing (`口令还缺大写字母、数字`), not that the input is invalid. A user
staring at a red box learns nothing from "invalid"; they act on "you still need a digit".

## Generating one

`generatePassphrase` produces 16 characters: one from each of the four classes, the rest from the
whole alphabet, then shuffled — without the shuffle the first four positions would always be
uppercase, lowercase, digit, symbol, and anyone reading it would know which position is which.

The alphabet drops `I O l 0 1`; a generated passphrase is meant to be **copied or written down**,
and those five are the ones people misread on paper.

**The plaintext is shown exactly once** — the generation moment. There is no "reveal passphrase"
anywhere afterwards, because there is no stored passphrase to reveal (ADR-0052). So the panel
prints the value, offers a copy button, and says in one line that this is the last chance to keep
it. Editing either field by hand clears the printed value: it is no longer *the thing we generated*,
and leaving it on screen invites the user to copy the wrong string.

`components/PassphraseFields.vue` is that whole block — two fields, generate, one-time reveal,
copy. It is used by the insert dialog and by the vault block's change panel.

## Changing it

Changing the passphrase means **new salt, new key, re-encrypt, write**. The old passphrase stops
working the instant the file is rewritten; there is no transition state and no second copy.

Order matters:

1. **Verify the old passphrase first** — decrypt the envelope on disk with it. Wrong passphrase
   means the file is not touched at all. The error is `原口令不对`, not "decryption failed", for
   the same reason the unlock prompt says that: "the file is corrupted" makes people doubt their
   own file.
2. **Re-encrypt the in-memory table, not the on-disk one.** The user may have edited cells that
   are not flushed yet; rewriting from disk would silently drop them. The table in the registry is
   the truth, disk is a snapshot of it.
3. **Swap the in-memory key only after the write succeeds.** A failed write leaves the old key in
   place, the panel open, and the file untouched — the user can retry instead of sitting in front of
   a vault nothing can open.

## What was rejected

- **Keeping the salt when the passphrase changes.** Cheaper (no new derivation), and wrong: the
  whole point of a per-vault salt is that a passphrase-derived key is unique per file. Reusing it
  across two passphrases gives an attacker one target instead of two.
- **Storing the old passphrase (or a hash of it) to "confirm" the change later.** That is a
  passphrase-adjacent secret next to the ciphertext — exactly what ADR-0047 rejected and ADR-0052
  kept out.
- **A passphrase hint / recovery question.** It is a second, weaker passphrase, and it silently
  turns "8+ characters of entropy" into "the name of your first pet".
- **Enforcing the rules on unlock.** Old vaults may hold short passphrases; refusing to unlock them
  would lock users out of their own data. The rules apply where a **new** passphrase is set, and
  nowhere else.

## Consequences

- `design/vault-check` grew a section: the rule rejects each missing class, the generator is 16
  characters and varied, the panel fills both fields and reveals once, the reveal clears on edit,
  and the change flow — wrong old passphrase leaves the disk byte-identical, right one swaps the
  salt, kills the old passphrase, keeps every row, and leaves the registry holding the new key (a
  later flush still decrypts with it).
- `useTables` gained `changeVaultPassphrase`. It is still the only place that knows a table can be
  encrypted; the block view only collects three strings and shows what came back.
- The insert dialog's passphrase fields became `PassphraseFields`, so "the rules and the generator"
  have one home. An empty passphrase still passes through when referencing an **existing** vault —
  that table has its own passphrase, and asking for it here would be asking the user to type a
  secret the app has no use for yet.

## Revisit if

- The vault grows a keychain-backed optional wrapping (ADR-0052 "Revisit if"): the change flow would
  also have to rewrap the device key, not just re-derive.
- Users start wanting per-entry passphrases or rotation reminders — that is a different product, and
  it would make "one passphrase, one file" stop being true.
