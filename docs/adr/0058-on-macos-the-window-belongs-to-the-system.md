# On macOS the window belongs to the system

## The corners

On Windows 11 the rounded corners are free: DWM rounds every ordinary top-level window, whether or
not the app draws its own title bar. macOS has no such layer. The rounded corner is part of the
**title bar**, and only a window that has one gets it — `decorations: false` produces a borderless
`NSWindow`, whose four corners are square. The same window therefore looked finished on Windows and
unfinished on macOS, and nothing in the product explained the difference.

**The decision.** On macOS the window gets a title bar back — `Titled`, plus `FullSizeContentView` so
the content reaches the top edge, plus `Closable` so it is an ordinary closable window — and that
title bar is then made invisible: transparent and without a title. The system then draws the corners
and the shadow, and the app's own chrome row (ADR-0024) sits on top of it exactly as before. Nothing
in the frontend or in `tauri.conf.json` changes: `decorations: false` stays for every platform.

**Why the window is not made transparent.** The other route to rounded corners is `transparent: true`
plus a CSS `border-radius`. It costs `macOSPrivateApi`, gives up the system's shadow (which cannot be
drawn outside the window's own bounds), and makes the radius ours rather than the system's. The AppKit
route costs one `setStyleMask:` call and gives the system's own corners.

**Why the title bar has to be transparent.** Two reasons, one cosmetic and one behavioural.

Cosmetic: the chrome is one row we draw ourselves, brand on the left, document info on the right. A
system title bar would be a second row of chrome.

Behavioural: with a transparent title bar the system stops doing its own double-click-to-zoom, so the
double click on the drag region (Tauri's built-in `internal_toggle_maximize`) is the only one. With an
opaque title bar the system would zoom on the second `mousedown` *and* Tauri would zoom on the
`mouseup`, and the two would cancel each other out — double-clicking the title bar would do nothing.
Verified with an AppKit probe: the same window, one run with a transparent title bar and one without,
and only the opaque one zooms itself.

**Why the frame is restored.** Changing the style mask makes AppKit recompute the window's frame (a
title bar is added at the top). The frame is captured before the change and put back after it, so the
window neither grows nor moves. With `FullSizeContentView` the content area and the outer frame are
the same rectangle in both masks, so restoring the frame restores the content area.

**Why the first responder is restored.** Same reason tao restores it when it changes the decorations:
rebuilding the frame view can drop the first responder back to the window, and then the keyboard
stops reaching the document.

## The buttons

**The decision.** macOS keeps the system's traffic lights; Windows keeps the three buttons we draw.
This settles the item ADR-0024 left open — a single fixed arrangement put Windows-style buttons at
the top-right on macOS too, which is a platform-identity bug rather than a chrome-consolidation one.

The two platforms therefore lay the chrome row out differently: on macOS the traffic lights sit at
the top-left of the window and the row starts to the right of them; on Windows the row starts at the
left edge and the drawn buttons sit at the right. The window's own buttons are the platform's, and
where they live is the platform's business.

**Why the traffic lights are worth keeping.** They are the one piece of window chrome macOS users
recognise without reading, and they come with the system's own behaviour: the red one asks before
closing a dirty document (through the same `CloseRequested` the guard already watches), the yellow
one minimises, the green one enters fullscreen. Drawing our own means re-implementing all of that
*and* looking foreign on the platform.

**Why the content steps aside for them.** The lights occupy the window's left edge, 9pt in, each
14pt wide with 23pt between them — the group ends at 69pt. The chrome row therefore starts at 80pt
on macOS (`pl-[5rem]`) instead of the usual 12pt. Clicking a light still reaches the system button:
the title bar container sits above the content view in the z-order, so the hit test finds the native
button rather than the webview (checked with an AppKit probe — the hit at the light's position
returns the theme's close widget, not the content view).

**Why the lights are not moved.** Nudging them down to the row's centre is possible — move the
three buttons — but AppKit re-lays them out on every resize and snaps them back, so it means
re-applying the nudge after every resize, and the lights would visibly jump while the user drags a
window edge. The system's own placement is the one that does not fight the system. So the chrome
moves instead, and the lights stay where the system put them.

**How the chrome lines up with them.** The lights sit 16pt below the window's top — the vertical
centre of the system's 32pt title bar band — while a 44pt chrome row centres its contents at
22pt, so the lights used to sit 6pt above the content's centre line.

The content now centres on the **32pt band** rather than on the 44pt row: the row gives up
`--chrome-row - 32px` at the bottom, the content box becomes 32px, and its centre lands on 16pt —
the lights' centre line. The numbers are measured, not assumed: the native side reads
`standardWindowButton(.closeButton)`'s frame, and on macOS 27.2 it reports a 32pt band, a
14×14pt button and a centre 16pt below the top.

**Why the bottom inset is a `calc()` and not a fixed 12px.** The row is rem-based (the base-font
preference scales it) while the band is a system measure that does not move with our type scale.
The inset therefore tracks the row, so the content box stays 32px at every base-font step and the
alignment survives a change of type size. `design/chrome-check.html` pins both: the centre lands on
16px at the default step, and still on 16px at a 20px root.

## Consequences

- `src-tauri/src/lib.rs` grows `macos_frame::apply`, called from the `setup` hook — after the window
  is created, before it is shown, so there is no flash of square corners.
- `objc2-app-kit` becomes a macOS-only dependency of the crate. It was already in the tree as a
  transitive one (tao uses it); the direct dependency adds only the AppKit classes this call needs,
  and the lock file grows by one line rather than by a tree of crates.
- `TitleBar.vue` asks which platform it is on (`src/lib/platform.ts`, from the WebView's user agent)
  and lays the row out accordingly: the macOS gutter on the left, the drawn buttons only on Windows.
  The platform is read from the user agent rather than asked for over IPC because the first frame has
  to be laid out correctly — waiting for a round trip would show one layout and then jump to another.
- The maximize button changes behaviour on macOS: with `Titled | Resizable` in the mask, tao uses the
  system's own zoom instead of setting the frame itself. The system zooms to the visible frame and
  restores the previous one on the way back — the macOS-native behaviour, and the content still fills
  the window edge to edge.
- The window regains the system behaviours that come with a title bar: the Window menu, `Cmd+M`, the
  standard zoom animation.
- `style.css` grows two variables: `--chrome-row` (the row's height, rem-based) and
  `--mac-titlebar-band` (the system's title bar band, 32px). The chrome's height moved from a
  literal `h-11` to `h-[var(--chrome-row)]`, so the row has one definition and the macOS bottom
  inset can be computed from it.

## Revisit if

- macOS grows a per-window corner radius API — then no title bar is needed for the corners at all.
- The green light's fullscreen behaviour turns out to be wrong for this app (a note-taking window may
  rather want the green light to zoom), in which case the zoom belongs on the button, not the system.
