# A note is saved when you leave it

Saving used to have three doors and none of them was a habit: the icon that only appears on the
active dirty tab, `Ctrl+S`, and the confirm box on closing a tab or the window. Switching tabs
deliberately kept the dirty flag and wrote nothing — the note in `requestCloseTab` says why:
switching is a high-frequency action, and interrupting it to ask is worse than carrying the dirty
state along.

The dirty state is not carried far. It lives in memory, the process ends on a window close, and the
one path that would have caught it — the confirm box — only appears when you close a tab you are
already looking at. "Changed something, swiped to the next note, closed the app" loses the change
with no prompt at all, because nothing was left that considered itself unsaved-and-open.

**The decision.** A note is written when you *leave* it, not when a timer fires. Three triggers:

- **Another tab** (`activateTab`) — the tab being left is saved before `activePath` moves, so the
  path is captured first; reading `activePath` after the assignment would save the wrong note.
- **The window loses focus** — you alt-tabbed away and may not come back.
- **Close** (`requestWindowClose`) — the native layer has already stopped the close and asked the
  front end whether anything is unsaved, so the send-back handler saves the active note and, if the
  dirty flag came back clean, closes immediately instead of asking. A failed write leaves the flag
  set and the confirm box appears exactly as before: not asking is a reward for success, not a
  blindfold.

**Only the active note.** Every other dirty tab stays dirty and untouched. They have not been left
yet; writing them from a blur would decide on their behalf when their content freezes — and a
`.tbl` referenced by one of them is flushed and snapshotted into the note at that moment
(ADR-0005). It also keeps one blur to one file instead of one file per open tab.

**No timer.** A quiet-window save (the shape `undo` already uses for its baseline, 500 ms) was the
first candidate and is the wrong signal: it fires in the middle of a sentence, several times per
editing session, and each write re-serialises the note — reference snapshots recomputed, the tree
refreshed. Typing a paragraph would write half a paragraph, then two thirds of one, then the whole
thing. Leaving is the moment an editing session actually ends, and it is cheap to detect.

**The switch.** `settings.autoSave`, default **on** (`readAutoSave` returns true unless `"false"` was
stored, the same judgement as `headingNav`), persisted to `localStorage` and to `webnote.json`. The
default is on because "I did not press the shortcut and lost the paragraph" is the failure the
editor should not have; turning it off is a choice, and `Ctrl+S` is still there. The workspace does
not import settings: `attachAutoSave(enabled)` hands the ref in, the same seam as
`attachIntegrateTables`. Unattached (self-check pages, the browser debug path) counts as off —
nothing should write to a fake disk behind the page's back.

**Blur is not "focus left the document".** The sandboxed iframe of an HTML block takes focus, which
blurs the parent window while the person is still in the app. The handler returns early on
`document.hasFocus()`, so clicking into an iframe is not a reason to write. `visibilitychange` to
hidden covers what blur does not: minimise, switch virtual desktop, lock the screen.

**Consequences.** The "discard" path narrows. `resolveClose` / `resolveWindowClose` still offer
save-or-discard, but with autosave on there is rarely anything dirty left to ask about, so the
choice mostly appears when a write failed or the switch is off. The old note in `requestCloseTab`
("switching carries the dirty state, does not interrupt") now holds only in the second case. A save
that is in flight still hands the tab a stale snapshot if typing continues during it — pre-existing,
not introduced here, and the window is one write wide.

**Considered.**

*A debounce timer* — rejected above: wrong signal, redundant writes, snapshots frozen mid-sentence.

*Save every dirty tab on blur* — rejected: it decides when other notes' reference snapshots freeze,
and turns one blur into a batch of writes.

*Ask on every tab switch* — rejected by the same note that made tab switches silent in the first
place.

*No switch* — rejected by the person who asked for the feature: an editor that writes when you did
not ask is a behaviour worth being able to turn off.

`design/autosave-check.html` covers it on a real workspace and a fake disk: with the switch off a
tab switch writes nothing; with it on the tab goes clean and the file on disk carries the edit; a
blur saves, an iframe-like focus does not; closing with autosave on skips the confirm box.
