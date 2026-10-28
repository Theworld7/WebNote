# A manual check asks conditionally

ADR-0030 shipped a launch-time check and left one item open on purpose: a "check for updates"
command in the settings panel, deferred because a click is a request and the anonymous GitHub
limit is 60 an hour. This closes that item.

**The entry lives in the settings sheet, under a new 关于 section.** The header's action cluster
is for things a person does while writing; a version number is something they look up once, in the
place the application describes itself. Putting it there also keeps the promise ADR-0030 made
about the title bar: no permanently-lit 「检查更新」 pixel, no second place where "there is an
update" can appear. The section is one card: the version this build is, a button, and — only once
a check has run — one line saying what came back.

**Every request after the first is a conditional one.** The first 200 carries an `ETag`; it is
kept and sent back as `If-None-Match`. GitHub answers 304, and a 304 **does not count against the
rate limit**. That is what makes a click safe: a person can press the button as often as they
like and only the first press is a real query. The tag is not persisted — it dies with the process
for the same reason the result does (a cached answer survives the upgrade it announces), and a
fresh launch is one unconditional request, which is the budget ADR-0030 already spent.

**Three outcomes, one line each.** `newer` — 发现新版本, the version number, and the same small
「新版本」 button the title bar uses, because it is the same action and should not be written
twice. `current` — 已是最新版本. `failed` — 没能检查, which is not an error state: offline, a 403
from the limit, a 404 on a repository with no releases, and a body that does not parse all mean
the same thing to the reader, exactly as they did in ADR-0030.

**It is a line, not a toast.** The toast exists for actions whose result is invisible and
finished — copying to the clipboard is the example in `useToast`. "There is a new version" is
neither: it is a fact you may want to read twice, and a message that disappears after two seconds
would be the wrong shape for it. It also is not an error strip: nothing is broken.

**A failed re-check does not erase what an earlier one found.** The panel shows 「发现新版本」 from
a release that a previous answer named, and then the network goes away. The release is still
newer than this build; only the asking failed. Clearing the line would turn "could not ask" into
"nothing to report", which is a different and false statement.

**Consequences.** `useUpdateCheck` grows `outcome`, `checking` and `checkNow` alongside
`checkOnLaunch`, and the panel reads them rather than holding them — the sheet unmounts when it
closes, and 「刚才那一次说了什么」 must survive that. The panel now contains the 「新版本」button and
therefore needs a `TooltipProvider` ancestor; the real app has one at the root, and
`design/settings-check.html` had to grow one. Worth recording: without it the patch throws
mid-render and the visible symptom is *clicking 检查更新 changes nothing*, which reads exactly
like a broken reactive binding and cost an hour of looking in the wrong place.

**Considered.** *A switch to turn the launch check off* — rejected: it would let a person silence
the one channel through which they learn a new version exists, to save one request per launch.
*A "检查更新" item in a menu* — there is no menu bar; the application has no File menu to put it in.

**Not addressed.** A scheduled re-check while the app stays open (a work session is hours, and
the launch check is the only fresh one); download progress or an install button, which ADR-0030
declined to build.
