# A session is what you were looking at, written down on the way out

Reopening the app used to lose everything about *where you were*: the sidebar width, the collapsed
state, and every preference came back (they live in `localStorage` and `webnote.json`), but the tabs
you had open, the one you were reading, and how far the tree was unfolded were memory-only. A second
launch started at "one layer unfolded, nothing open" — for a library of a few hundred notes, that is
the same three clicks every morning.

**The decision.** One snapshot of the session, written at the moment the window closes, restored
right after the tree is scanned. It carries four things: the tab paths in order, the active path,
the set of expanded node ids, and where each note was scrolled to.

**It records what you were looking at, not what you changed.** That second half is autosave's job
(ADR-0036) and the two do not overlap: the session is perishable state belonging to this machine,
while unsaved edits are a fact about the disk. Keeping them apart is why restoring never has to
decide whether a tab comes back dirty — it never does; a restored tab is clean, and the file on disk
is the truth. Which is also why an app killed with `taskkill` loses nothing of value: the edits were
already written, only the tab layout is stale.

**`localStorage`, not `webnote.json`.** The preference file travels with the workspace — that is its
whole point (see `useSettings`). The session must *not*: it belongs to this machine, and a laptop
opening the same library over a sync folder should not be handed the desktop's half-finished layout.
So the key is `webnote:session:<absolute root path>` — one session per workspace, nothing crossing
between them. The browser runtime has no root path (`absolutePath`
returns `null`), so it uses a single fixed key; that path is the `pnpm dev` debug runtime, and one
key is enough there.

**Written once, on the way out.** Tab switches, expands, and scrolls change memory only. A
`localStorage` write is microseconds, but writing on every click buys nothing that the close is not
already going to buy, and the close is precisely the moment the session stops changing. The write
sits in `confirmWindowClose` rather than `requestWindowClose`: the latter is "somebody asked to
close", and the person can still answer "cancel" — a cancelled close must not freeze the layout of
that instant.

**Scroll positions are the exception: recorded live.** Every other field is still readable at close
time, but the reading position of the note you are currently looking at is not — closing the app is
not "leaving this note", so there is no moment that would capture it. `BlockEditor` therefore keeps
`scrollTop` in a module-level map on every scroll event (memory only — no writes), and the snapshot
picks the map up at close. The map existed before this change for tab switches; it moved to
`composables/useSession.ts` because the workspace, not a component instance, now has to read it.

**Restoring is forgiving in one direction and strict in the other.** Tabs and expanded ids are
filtered against the freshly scanned tree: a note deleted outside the app drops out of the tab bar
instead of opening onto an error, and the rest of the bar survives — losing one file is not a reason
to throw away eight open tabs. When the active path is among the casualties, focus falls to the
first surviving tab. But `tabs` and `expandedIds` must *be arrays* for the snapshot to count at all:
a session where one parses and the other does not would restore "tree unfolded as before, no tabs",
which is more confusing than no session at all. Empty is legal — closing every tab is a real way to
end a day — so `[]` is honoured and only a wrong *type* throws the whole file away.

**Consequences.** A folder created outside the app while it was closed comes back collapsed: the
snapshot says which ids are open, and a new id is not one of them. That is the honest reading of
"remember what it looked like", and the alternative (union with `defaultExpanded`) would keep
unfolding folders the person had deliberately closed. The browser runtime has no native close event,
so its `beforeunload` writes the snapshot too — the desktop path never reaches it, since the Rust
guard intercepts the close first.

**Considered.**

*Write on every change* — rejected: it makes `localStorage` a per-click write path for a benefit
that only materialises at the next launch, and it would freeze the session of a crash, which is not
a state anyone asked to see again.

*Store the session inside `webnote.json`* — rejected: that file follows the workspace across
machines, and the session must not. It would also put a per-close write into the notes directory,
where it shows up as a sync conflict for anyone who syncs their library.

*Restore only the tabs, not the tree* — rejected: the tree is the half that saves the most clicks in
a deep library, and it costs one `Set` to carry.

*Restore the scroll offset by block id instead of pixels* — the better answer in principle, and
unavailable for the same reason `BlockEditor` already stores pixels: the scroll container has no
per-block anchor, and inventing one is a larger change than this one. A pixels-off restore after a
font-size change is the honest limit of the current model.

`design/session-check.html` drives a real workspace over OPFS: `requestWindowClose` writes the
snapshot, a fresh `openRoot` brings back the tab order, the active tab, the collapsed folder, and
the scroll offset; a deleted file drops out while the rest of the bar survives; closing every tab is
preserved as an empty bar; malformed JSON and wrong field types both fall back to the default. The
live scroll recording has its own page, `design/scroll-memory-check.html`, mounted on the real
`BlockEditor`: a scroll lands in the map without leaving the note, switching away keeps it, and
coming back puts the viewport where it was.
