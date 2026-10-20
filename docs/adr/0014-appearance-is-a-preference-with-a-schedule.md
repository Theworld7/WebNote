# Appearance is a preference with a schedule

`.dark` has existed since ADR-0010 — a full token set, a contrast gate, a preview panel in
`theme-check.html` — but nothing ever put the class on `<html>`. The dark appearance was
written and unreachable. This ADR is about the switch, not the colours.

**Appearance is a Preference.** It changes how the editor looks, never what a Note is: it
lives in `useSettings` (localStorage plus `webnote.json`), it never marks a Tab dirty, and it
never reaches the exported HTML. The exported file keeps the `prefers-color-scheme` media
query its own `DOC_STYLE` already carries — a Note opened on someone else's machine follows
*their* system, because the file has no opinion about appearance. That is the same line
ADR-0010 drew when it refused a `prefers-color-scheme` switch for the brand.

**One setting, five modes.** `ThemeSettings` is stored as a single `webnote:theme` value
(`{ mode, lightAt, darkAt, latitude, longitude }`), not five independent preferences: they
only mean anything together, and split keys allow the half-state "sun mode, no coordinates".
Modes: `light` / `dark` (pinned), `system` (`prefers-color-scheme`), `fixed` (two `HH:mm`
times), `sun` (sunrise / sunset at a place). The default is `system` — an app that has a dark
appearance and ignores the OS is choosing for the user on first launch.

**The schedule derives the present, it does not fire at the future.** Every question is "given
this moment, what should I be", answered by `displayFor` in `lib/theme-mode.ts`: walk back from
today's transition list to the last one not after `now` (up to eight days, so a day with no
transitions — a polar day, or a rule that only fires on weekends — inherits the previous one).
A 30-second heartbeat and a re-check on `focus` / `visibilitychange` are the only timers. This
is the stance borrowed from DuoSwitch's scheduler: sleep, wake, clock changes and throttled
timers all need no handling, because nothing is aligned to a deadline that can be missed.

**A manual toggle overrides a slot, not the setting.** In the two pinned modes the tab-bar
button *is* the setting, so it writes `mode`. In the three automatic modes it records
`ManualOverride { theme, slot }`, and the override dies when the slot changes — the next
sunrise, the next fixed time, the next `prefers-color-scheme` flip. The slot's identity is the
transition's timestamp (`at:<epoch>`), so expiry is a comparison, not a cleanup job, and the
user's choice inside a slot is never fought back. Same rule as DuoSwitch: assert once per slot,
then respect whatever the user did.

**The sun is local arithmetic, not a service.** `lib/sun.ts` is the NOAA approximation
(zenith 90.833°, fractional year, equation of time) ported from DuoSwitch's `suncalc.rs`:
±1 minute at mid-latitudes, off-line, no network, no timezone database of its own — the
calculation runs in UTC and hands back local `Date`s, so the zone and its DST rules stay the
runtime's business. Polar day / polar night is not "no answer": the day's single transition
lands at midnight as light or dark respectively, because falling back to an eight-day-old slot
would produce the wrong answer confidently.

**The place comes from the system timezone**, since an off-line app cannot geocode and should
not ask for a location permission to colour a window. `lib/place.ts` maps IANA zones to a
representative city; an unlisted zone falls back to longitude derived from the UTC offset and
latitude zero (a ~12-hour day year-round: the switch times stop drifting with the season
instead of drifting to something absurd). The panel shows which city, which zone, and today's
computed sunrise/sunset — a wrong coordinate has no error message, only implausible times.

**Three neutral tokens had to be re-declared for dark.** `--color-canvas`, `--color-line` and
`--color-muted-strong` were `@theme` constants in light values; under `.dark` they produced a
near-white canvas, near-white borders and a near-white hover fill, which flattens every
boundary the islands and cards rely on. Dark now re-declares them, keeping the light
relationships (canvas darker than the card, borders lighter than it). The table's right-edge
scroll shadow became a variable for the same reason: a black shadow on a dark surface is
not drawn at all.

**The code editor paints itself, so it has to be told.** Monaco (VS Code's core, behind the
source drawer) carries its colours in a JS object of `#rrggbbaa` values and never looks at CSS
variables, so `theme: "vs"` was a hard-coded light appearance: opening the drawer in the dark
app produced a white rectangle. `lib/monaco-theme.ts` defines one theme per appearance with
`inherit: true` and overrides only the chrome — `editor.background` = `--background` (the drawer
is `bg-background`; anything else shows a seam), foreground, line numbers, cursor
(`--color-brand`), selection (`--color-selection-strong`), indent guides (`--color-line`),
widgets and suggestions (`popover` / `border`). HTML and CSS syntax colours are left to the
base theme, because that is VS Code's own palette and this app has no business inventing a
second one for source code. The colours are read off a probe element that carries `.dark`
itself rather than off `<html>`: the document is only *currently* one appearance, and defining
a theme must not depend on which one that is. Two themes are defined once; switching is
`editor.setTheme`, so the instance keeps its undo stack, its scroll position and its workers.

**Consequences.**

`<html>` also gets `color-scheme`, so UA-drawn parts (scrollbars, date pickers, autofill)
follow along — the app's own tokens cannot reach those.

**The native title bar needs a word from the Rust side, and the framework's word is not enough.**
The frame is drawn by DWM, so no CSS reaches it. `window.setTheme` is the documented route —
but it was never callable here: `core:window:default` grants `allow-theme` (read) and not
`allow-set-theme`, so every switch was rejected with `window.set_theme not allowed` and the
rejection was swallowed by a bare `.catch()`. The interface went dark, the frame stayed light.
Granting the permission is not the end of it either: the command then returns `Ok` and
`theme()` reads back dark, while `DwmGetWindowAttribute(hwnd, 20)` stays `0` and the frame
stays light — measured on Windows 11 25H2 with tauri 2.12.3 / tao 0.37.1. So `set_window_theme`
(`src-tauri/src/lib.rs`) does both: it calls `window.set_theme` (the framework route, which is
what macOS needs) and, on Windows, writes `DWMWA_USE_IMMERSIVE_DARK_MODE` directly and nudges
the non-client area with the same pair of `WM_NCACTIVATE` calls tao uses. Writing the attribute
from outside the process does darken the frame, which is what makes the second half a fix
rather than a guess. The command takes the *resolved* appearance, not `null`-for-system: the
watcher already recomputes `theme` when the OS flips, so there is nothing left for the OS to
decide. Failures now `console.warn` instead of vanishing — the swallowed rejection is what made
this bug invisible.

`design/theme-mode-check.html` covers the sun math (asserted in UTC so the page does
not depend on the machine's zone), the transition/slot derivation, the override rule, the
settings round trip and its bad-value fallbacks, and — through the real `EditorTabBar` — that
the class actually lands and `body` really paints dark. `settings-check` and `theme-check`
cover the panel section and the new dark neutrals. `html-drawer-check` asserts that the
editor's painted background equals the token in both appearances, that dark is actually dark
rather than white, and that a switch does not recreate the instance or its model.

**Considered.** *A dropdown on the tab bar (light / dark / follow system)* — rejected: the
button is a two-state toggle, and a menu there would be an entry point competing with the
settings panel that already holds the schedule. *Per-note appearance* — rejected: a Note is a
file that opens anywhere; its appearance belongs to the machine, not the document. *A
transition animation between appearances* — deferred: no value worth the flash of animating
every token at once.
