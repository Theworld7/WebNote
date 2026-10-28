# A new version is a hint, not an install

The app is handed out as an installer on the Releases page, so "there is a newer version" is
information the person running it cannot get from inside the app at all. The cheapest way to
close that gap is to ask GitHub what the latest release is, and say so. What that sentence must
not become is an updater: **the button points at the release page and stops there.**

**The decision.** Once per launch, `GET /repos/Theworld7/WebNote/releases/latest`. If the tag is
newer than the version this build was made from, a text button reading 「新版本」 appears at the
right end of the undo/redo cluster in the title bar, tinted with the brand colour. Clicking it
hands that release's own page to the system browser. Nothing is downloaded, nothing is replaced,
and when there is no update there is no button — chrome is the most expensive real estate in the
window and a permanently-lit 「已是最新」 is the least useful kind of pixel.

**Why not `tauri-plugin-updater`.** It is the obvious answer and it costs more than the problem.
The plugin needs a signing keypair whose private half must be present at build time, a
`latest.json` manifest published as a release asset on every release, and installers built by our
own bundler — the updater replaces the running executable, so a copy someone unzipped by hand is
not updatable and would have to be told so. Above that sits the trust decision: an app that
downloads a binary and runs it is a different promise from an app that opens a web page. The
request was the hint. The installer stays the person's own act, in their own browser, with the
download bar they already know.

**Both sides of the comparison are read once, on their own terms.** The running version is
`package.json`'s version, injected as `__APP_VERSION__` at build time: `chore(release)` already
moves package.json, Cargo.toml and tauri.conf.json in one commit, so asking Tauri for its version
asynchronously would only add a second source for a number that is already settled when the bundle
is built. The remote side is parsed once, at the boundary, in `lib/update.ts` — after that every
caller sees `ReleaseInfo` and never inspects GitHub's field names again. `Reflect.get` instead of
a typed cast, `tag_name` must be three dot-separated numbers with an optional `v`, and a payload
that is a draft or a prerelease is discarded even though `/releases/latest` already excludes both:
the endpoint's guarantee is not ours to rely on.

**A tag we cannot parse is not a newer version.** `v0.9.0-beta.1`, `nightly`, and `0.8` all
return `null`, and `null` means no hint. That is the deliberate asymmetry — a missed hint costs a
person one visit to a page they know about, while a false one sends every stable user after a
prerelease. There is also no third state: no "there is something odd on the server" notice,
because that is a state nobody can act on.

**Every failure looks like no update.** Offline, a 403 from the anonymous rate limit, a 404 on a
repository that has no releases yet, a body that does not parse — all four end the same way, with
`console.warn` and nothing on screen. A note application that looks broken because an optional
nicety could not reach GitHub is a worse outcome than a missing hint.

**The result is not cached.** One request per launch, no `localStorage`. A cached answer survives
the upgrade it was announcing, so the person who just installed 0.9.0 keeps being told 0.9.0 is
available, pointing at the page they came from. The rate limit is 60 requests an hour per address;
one launch is one request, and a machine that exceeds that is a build machine, not a reader.

**Why that exact spot.** ADR-0029 left the middle of the header as the window's only drag surface
and the right end as document information (character count, page-style entry, window buttons). A
window-level notice can live neither in the drag surface nor in the middle of a cluster that
describes the open document, so it goes at the end of the action cluster — past undo/redo, no
divider, because the brand colour already says it is a different kind of thing. The label is words
rather than an arrow-in-a-circle: the message is "there is something to go and get", which no icon
in the set says. It is `v-if` on the detection result, so the cluster keeps its width on every
launch where nothing was found.

**Consequences.** The hint is untestable against the live API, so `design/update-check.html` stubs
`fetch` and `window.open` and asserts the parse, the comparison, the appearance of the button and
the address it opens; `design/chrome-check.html` asserts where the button lands and that it stays
absent when there is no update. The visible width of the action cluster is now a function of a
network answer, so the width of the drag surface beside it is still measured in that page rather
than assumed — it is the one thing in the header that cannot afford to shrink.

**Not addressed.** In-app download or install-on-quit (rejected above, not deferred); a "check for
updates" command in the settings panel, which would need ETag caching before it could be offered
at a click (added later, with conditional requests — see ADR-0031); and the macOS / Linux
packaging story, which is still the open item from ADR-0024.
