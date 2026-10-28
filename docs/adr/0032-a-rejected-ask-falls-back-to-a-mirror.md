# A rejected ask falls back to a mirror

ADR-0030 and ADR-0031 rest on one request: `releases/latest`. Anonymous GitHub allows 60 of those
an hour **per egress IP**, and in this app's main market that IP does not belong to the person
running it. Measured on the development machine while writing this: `x-ratelimit-remaining: 0`,
`used: 60`, a 403 with every attempt — and the IP named in the rejection (`106.38.204.50`) is not
the machine's own (`123.124.142.2`). The accelerator that carries `api.github.com` is a shared
relay, and its hour had been spent by strangers. Turning the accelerator on cannot help: it fixes
reachability, not quota, and a shared exit makes the quota worse rather than better. The result was
a feature that reported 「没能检查」 every single time it was asked, which is indistinguishable
from being broken.

**The decision.** Keep the API as the primary source — it names the release and gives that
release's own page — and when it returns no verdict at all (403, 404, a body that does not parse,
a thrown fetch), ask a second source: the repository's `package.json` on `main`, served by
jsDelivr. That mirror is not rate-limited, sends `Access-Control-Allow-Origin: *`, and needs no
key. It answers one question only — which version is published — so the link it produces is the
releases **list**, not a `/releases/tag/v<version>` URL computed from the number: a computed tag
page can 404, and a link that lands on "not found" is worse than one that needs a second click.

**The mirror may only add, never subtract.** jsDelivr caches branch refs for hours, so its answer
is an upper bound on freshness, never a guarantee. If it reports something newer, believe it. If it
reports the version this build is, do **not** conclude 「已是最新」 when an earlier answer had
already found a newer release — that earlier release has not been withdrawn, the mirror has simply
not seen it yet. The badge stays; only the primary source, which is authoritative about "latest",
is allowed to take it away.

**Why not the alternatives.** *A personal access token* — 5000 requests an hour instead of 60, at
the cost of asking every user to mint and paste a secret into a notes app, and storing it. *Moving
the request into Rust* — it would sidestep CORS, but `reqwest` reads proxy environment variables,
not the Windows system proxy, and the system proxy is exactly how accelerators are wired; the
first-party route would be the one that stops working behind them, and `github.com` itself is not
reachable directly from here either. *Persisting the ETag across launches* — it makes the steady
state cost nothing, but the launch that has no tag yet is the one that fails, and it fails before
there is anything to persist. *`releases.atom`, or the HTML redirect* — neither sends CORS headers,
so the webview cannot read them at all.

**Consequences.** `askApi` now returns `null` for "no verdict", a different answer from `failed`
("both paths were asked and neither answered"), because the fallback has to know when to run and
the caller has to know when to give up. Both payloads are parsed in `lib/update.ts` and nowhere
else. The trust chain grows a third party: jsDelivr can influence whether the app *notices* a
version, but it cannot influence what the app downloads or installs — ADR-0030's promise is
untouched, since the button still only opens a web page that GitHub serves.

**Not addressed.** How stale the mirror actually is at any moment (it is a CDN cache, not a
promise); a first-party mirror of our own; and the 60-an-hour budget for anyone who does reach the
API directly, which stays as ADR-0031 left it.
