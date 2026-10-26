# A worktime block reads rows as lots, and keeps every balance out of storage

The ask was a **工时** block: overtime, comp time and leave, with the balance visible, the expiry
of each earning adjustable, the reset node of each leave kind adjustable, annual leave either a
fixed number of days or derived from seniority — and enough of the rest of personnel bookkeeping
not to be a toy. The obvious shape is a table with a `balance` column. **Rejected: a stored
balance is a second source of truth and it ages.** It agrees with the rows right up until the day
it silently does not — a lot expires, a year rolls over, a policy changes — and nobody recomputes
it, because nothing on screen says it is stale.

So the block computes. It reads rows and prints a report; the `.tbl` holds facts about what
happened, never a summary of them.

## The decision

**A positive row is a lot; a negative row spends lots.** That one sentence is the whole ledger.
`+8 小时 加班` on 03-02 is a lot of 8 hours with its own expiry; `-4 小时 调休` on 04-11 takes 4
hours out of whichever lots are still alive. Spending consumes **FIFO by expiry date**, never by
the order the rows appear: a lot expiring 06-30 goes before one expiring 12-31, and a lot that
never expires sorts last. Within one expiry date, earlier earning first. This is the only order
that does not quietly forfeit value.

**Two expiry readings, and one pool gets exactly one of them.** `validityMonths > 0` means
**per-lot validity**: each earning is good for N months from its own date, and what is left when
it lapses is written off. `reset !== "none"` means a **periodic quota**: a period (calendar year,
a fiscal year starting `MM-DD`, or each person's own hire anniversary) grants the entitlement at
its start, and what is left at its end carries over up to `carryOverMax`, lapsing on
`carryOverDeadline`. They are not two settings of one model — comp time genuinely dies three
months after the overtime that earned it, annual leave genuinely survives into next year — and
unifying them would mean inventing a period for a lot that has none. When both are set the
per-lot reading wins, and the period machinery stays out of the way.

**A period's grant is a lot too, but a synthetic one.** `accrual: "fixed"` grants `fixedDays`
each period; `"seniority"` grants the tier the person's years of service fall into (0/10/20 年 →
5/10/15 天 by default), and `prorate` scales a hire year by the months left in it. These lots have
no row behind them — `key` is `grant:<period start>` instead of `row:<row id>` — and they must be
synthesised, because "your 2026 annual leave was 10 days" is a consequence of a rule and a hire
date, not something anybody types. `autoGrant` can be switched off, which leaves the block with
hand-entered earnings only: a plain notebook for a team with no formal policy.

**A pool with no movements still gets its current period.** The period walk starts at the first
row so that opening an old table does not mint a decade of entitlement — but a pool with *no*
rows has no history to invent, and "年假 应享 0" on a blank ledger contradicts the policy that is
right there in the settings. So an empty pool grants the period `today` falls in, and nothing
else. A blank preset table therefore shows 年假 5 天 (the 0-year tier) and 调休 0 小时, which is
what somebody inserting the block needs to see.

**A pool can be bounded at both ends.** 育儿假 开在 2025-04-01、每年 5 天、一共三年 is two
facts the policy has to carry, not one: `grantFrom` (where the window opens) and `periodLimit`
(how many periods it runs). The first matters because **"有记录" is not "从这里起才有额度"** — a
table whose first row is dated 2026 must still grant the 2025 period that started before anyone
wrote anything down; without it the walk anchors on the first row and silently loses a year. The
second bounds the walk in the other direction, whether or not a start date is given: an old table
with a 2016 row otherwise mints ten periods of annual leave nobody ever approved.
**Past the last period nothing is granted *and nothing is carried*** — a `settle` that keeps
running would roll the final period's remainder forward under `carryOverMax` forever, so the
window stops settling and the remainder lapses on its own expiry date. Rows keep working either
way: a holiday taken after the window still consumes lots, and lands in overdraft when none are
left.

**`granted` and `added` stay apart.** The summary line reads 应享 / 含结转 / 补入 / 已用 / 作废,
not one "earned" number. A rule-granted 10 days and a manually topped-up 2 days both raise the
balance, but folding them together hides the thing an HR person is looking for — whether the
number came from the policy or from somebody's hand.

**The pool is the `select` option's id, not a leave kind we enumerate.** One option = one pool,
one policy, keyed by option id (`人员\0选项`, so a table with a person column splits every kind per
person). Adding 婚假 is adding an option to a column; renaming it keeps the policy, because the
name is never the key. The block ships a preset table with 年假 (natural year, +5 天 carry-over
to 03-31, seniority), 调休 (3 months per lot), 加班, 事假 and 病假 — a starting point, not a closed
set.

**Units belong to the pool.** Annual leave counts days, comp time counts hours, and nothing
converts between them: a pool has a unit and every number in it wears that unit. Converting would
need a hours-per-day constant that is wrong for somebody, and rounding it is how half a day
disappears.

**Overdraft is a number, not an error.** Spending more than a pool holds leaves the balance
negative and keeps it visible, rather than clamping at zero or refusing the row. Advance leave is
real; debt is what it looks like.

**Status filtering is a policy field.** A `statusValue` on a block limits the report to rows whose
status cell matches — so a table can hold 待审批 / 已批准 / 已驳回 and the balance only moves on
已批准. It filters **input**, so a rejected row never becomes a lot at all; the alternative
(compute everything, then hide) would leave the numbers disagreeing with the list.

**Everything else is derived and nothing else is stored.** Available, used, granted, carried-in,
forfeited and the per-row running balance all come out of `worktimeReport(rows, roles, block,
today)` — a pure function of the rows, the settings and a date. That is also why 「今天」 is a
parameter: the same rows give different answers in March and in December, and a self-check can
hand in a fixed date instead of waiting for one.

**On disk it is a snapshot with a pointer (ADR-0006), like the Gallery and Ledger blocks.** A
`<div data-worktime>` carries the path, the seven column mappings, `data-status-value`,
`data-soon`, `data-lots` and `data-policies` (one compact JSON object, keyed by option id, with
short field names — `validity`, `reset`, `cap`, `deadline`, `accrual`, `prorate` — and unknown
keys ignored on read). Its children are the summary grid and the movement table, written as plain
markup so the export opens on its own. The reader is tolerant in the way every `parseXxx` is
(ADR-0023): a missing attribute falls back to a default, a bad `data-soon` falls back to 30, an
unparseable policy blob falls back to the default policy — and a table that no longer resolves
leaves an **empty container that keeps the pointer**, so the settings survive a moved file.

## Consequences

- The movement table's 有效期至 column shows a date on earnings and `—` on spending. A spend can
  draw from several lots; printing one date against it would be a lie.
- A lot list is available (`showLots`) but off by default: at rest the question is "how much do I
  have", and which batch it came from is a follow-up.
- `design/worktime-check.html` pins the semantics — periods, seniority tiers, proration, FIFO
  order across expiries, carry-over caps and deadlines, forfeiture, overdraft, per-person pools,
  status filtering, the soon window, and a full write-and-read round trip. It hands in its own
  `today`, so a wrong answer is a wrong answer on any day the page is opened.
- Seven column mappings are read and written by hand on both ends, per ADR-0023. The fields are
  `data-date` / `data-person` / `data-kind` / `data-amount` / `data-note` / `data-status` /
  `data-hire`, and `parse-check` covers the round trip alongside every other block type.
- Changing the kind column **clears `statusValue` and the whole `policies` map**: those keys are
  option ids of the old column, and a stale key that happens to collide with a new option id would
  apply a stranger's policy.
- The view reuses the shared cell-editing seam (`useTableEntry` / `useCellEditing`) and the
  **Option cell** picker, so editing a row here behaves like editing the same row in a Ledger or
  a Data table block — Tab into a select cell opens the list, and skipping it takes a second Tab.
