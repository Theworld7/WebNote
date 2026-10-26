import type { DataColumn, DataRow, DataTable } from "@/types/data-table"
import type {
  WorktimeAccrual,
  WorktimeBlock,
  WorktimeConsume,
  WorktimeExpiryAlign,
  WorktimeLapse,
  WorktimePolicy,
  WorktimeReset,
  WorktimeScope,
  WorktimeTier,
  WorktimeUnit,
} from "@/types/workspace"
import { DATA_TABLE_VERSION } from "@/types/data-table"
import { cellValue, createOptionId, emptyColumn, emptyRow } from "@/lib/data-table"

/**
 * 工时块的人事口径 —— 池、额度批次、按到期日扣减、结转与年假发放。
 *
 * 视图(`WorktimeBlockView`)与导出快照(`serialize.ts` 的 `worktimeHtml`)共同消费这一份:
 * 「编辑器里算出多少,双击打开就是多少」由单一真源保证,不靠两处各写一套公式对齐。
 *
 * ## 两种过期读法(一个池只走一种)
 *
 * - **逐笔有效期**(`validityMonths > 0`):每笔获得的额度从产生日起 N 个月有效。
 *   适合调休 —— 加班换来的假 3 个月不用就没了。扣减按**到期日从早到晚**(FIFO by expiry),
 *   过期的直接作废,不参与余额。
 * - **周期性额度**(`reset !== "none"`):每期开始时结转上期剩余(受 `carryOverMax` 封顶)
 *   并可自动发放本期额度；期末未用完的额度随期末失效,结转额度到 `carryOverDeadline` 失效。
 *   适合年假。
 *
 * 两者同时配置时按逐笔有效期走 —— 重置与结转不参与,一个池只有一种读法。
 *
 * ## 扣减链(与「一个池一种读法」正交)
 *
 * 默认每个池自给自足:负数行只扣本池。`scope: "chain"` 的池与**同人员、同链名**的池结成
 * 一条链,负数行按 `chainOrder` 从链上依次取额度,跨单位按 `hoursPerDay` 折算到小时。
 * 链上可以有一个只被扣、从不发的池(调休),它自己没有额度 —— 值钱的是链合计。
 *
 * 链不改任何池自己的过期读法,只改「一笔使用从哪儿扣」。两条规则正交,所以既能表达
 * 「加班/年假/育儿假合并成调休池、按优先级扣」(worktime-tracker 的口径),也能表达
 * 「各假期互不相干、各自记账」(0029 的口径)。
 *
 * ## 派生,不落盘
 *
 * 余额、已用、应享、结转量、作废量全是**按今天算出来的**,不进 `.tbl` 也不进块:
 * 落进存储就是第二份会过期的真源。表里只有「发生了什么」——正数行是获得,负数行是使用。
 */

// ---- 列映射 ----

export const WORKTIME_SOON_DAYS_DEFAULT = 30

export const WORKTIME_ROLES = ["date", "person", "kind", "amount", "note", "status", "hire"] as const

export type WorktimeRole = (typeof WORKTIME_ROLES)[number]

/** 块上存列 id 的字段名。字段映射、序列化、解析共用这一份,避免三处手抄。 */
export type WorktimeRoleField =
  | "dateColumnId"
  | "personColumnId"
  | "kindColumnId"
  | "amountColumnId"
  | "noteColumnId"
  | "statusColumnId"
  | "hireColumnId"

export const WORKTIME_ROLE_FIELDS: Record<WorktimeRole, WorktimeRoleField> = {
  date: "dateColumnId",
  person: "personColumnId",
  kind: "kindColumnId",
  amount: "amountColumnId",
  note: "noteColumnId",
  status: "statusColumnId",
  hire: "hireColumnId",
}

/** 导出快照上的 `data-*` 属性名。解析按同一张表倒着读回。 */
export const WORKTIME_ROLE_ATTRS: Record<WorktimeRole, string> = {
  date: "data-date",
  person: "data-person",
  kind: "data-kind",
  amount: "data-amount",
  note: "data-note",
  status: "data-status",
  hire: "data-hire",
}

export const WORKTIME_ROLE_LABELS: Record<WorktimeRole, string> = {
  date: "日期列",
  person: "人员列",
  kind: "类别列",
  amount: "时长列",
  note: "事由列",
  status: "状态列",
  hire: "入职日期列",
}

export type WorktimeRoles = Record<WorktimeRole, DataColumn | null>

/** 自动识别时优先认的列名。人员 / 事由只认名字,不拿任意文本列顶替 —— 猜错会把两列搅在一起。 */
const PREFERRED_NAMES: Record<WorktimeRole, readonly string[]> = {
  date: ["日期", "发生日期", "变动日期", "时间"],
  person: ["人员", "姓名", "员工", "名字", "同事"],
  kind: ["类别", "类型", "假期", "假别", "项目"],
  amount: ["时长", "小时", "天数", "数量", "工时"],
  note: ["事由", "摘要", "说明", "备注", "原因"],
  status: ["状态", "单据", "审批", "流程"],
  hire: ["入职日期", "入职", "入职时间", "司龄起算"],
}

function normalized(value: string): string {
  return value.trim().toLowerCase()
}

function acceptsType(role: WorktimeRole, column: DataColumn): boolean {
  switch (role) {
    case "date":
    case "hire":
      return column.type === "date"
    case "kind":
    case "status":
      return column.type === "select"
    case "amount":
      return column.type === "number"
    case "person":
    case "note":
      return column.type === "text"
  }
}

function claim(
  columns: readonly DataColumn[],
  used: Set<string>,
  predicate: (column: DataColumn) => boolean,
): DataColumn | null {
  const column = columns.find((item) => !used.has(item.id) && predicate(item)) ?? null
  if (column !== null) used.add(column.id)
  return column
}

/**
 * 解析出七个语义列。显式设置优先;空串或指向已删列时退回自动识别。
 *
 * 类别列只认 `select` —— 池子的身份是它的选项 id,一列自由文本既成不了池,也没法挂规则。
 * 人员 / 事由两列都只按名字认:自动猜一个「文本列当人员」,猜错时余额会按人名切碎,
 * 那比不显示分池更糟。
 */
export function worktimeRoles(columns: readonly DataColumn[], block: WorktimeBlock): WorktimeRoles {
  const roles: WorktimeRoles = {
    date: null,
    person: null,
    kind: null,
    amount: null,
    note: null,
    status: null,
    hire: null,
  }
  const used = new Set<string>()

  for (const role of WORKTIME_ROLES) {
    const id = block[WORKTIME_ROLE_FIELDS[role]]
    if (id === "") continue
    const column = columns.find((item) => item.id === id) ?? null
    roles[role] = column
    if (column !== null) used.add(column.id)
  }

  for (const role of WORKTIME_ROLES) {
    if (roles[role] !== null) continue
    const names = PREFERRED_NAMES[role]
    roles[role] = claim(
      columns,
      used,
      (column) => acceptsType(role, column) && names.some((name) => normalized(column.name) === name),
    )
  }

  if (roles.date === null) roles.date = claim(columns, used, (column) => column.type === "date")
  if (roles.kind === null) roles.kind = claim(columns, used, (column) => column.type === "select")
  if (roles.amount === null) roles.amount = claim(columns, used, (column) => column.type === "number")
  if (roles.status === null) roles.status = claim(columns, used, (column) => column.type === "select")
  if (roles.hire === null) roles.hire = claim(columns, used, (column) => column.type === "date")
  if (roles.note === null) roles.note = claim(columns, used, (column) => column.type === "text")

  return roles
}

// ---- 规则 ----

/** 法定阶梯的缺省:满 0 / 10 / 20 年 → 5 / 10 / 15 天。0 档即可按公司政策改的「不满一年」口径。 */
export const WORKTIME_TIERS_DEFAULT: readonly WorktimeTier[] = [
  { minYears: 0, days: 5 },
  { minYears: 10, days: 10 },
  { minYears: 20, days: 15 },
]

export const WORKTIME_POLICY_DEFAULT: WorktimePolicy = {
  unit: "day",
  validityMonths: 0,
  reset: "none",
  resetMonthDay: "01-01",
  carryOverMax: null,
  carryOverDeadline: "",
  autoGrant: false,
  grantFrom: "",
  periodLimit: 0,
  accrual: "fixed",
  fixedDays: 5,
  tiers: WORKTIME_TIERS_DEFAULT.map((tier) => ({ ...tier })),
  prorate: true,
  expiryAlign: "none",
  consume: "expiry",
  scope: "standalone",
  chain: "",
  chainOrder: 0,
  hoursPerDay: 8,
  lapse: "writeoff",
}

/** 一天的默认小时数。「天」与「小时」两种单位在链上撮合时用它折算。 */
export const WORKTIME_HOURS_PER_DAY_DEFAULT = 8

export const WORKTIME_RESET_LABELS: Record<WorktimeReset, string> = {
  none: "不重置",
  calendar: "自然年",
  fiscal: "财年",
  anniversary: "入职周年",
}

export const WORKTIME_ACCRUAL_LABELS: Record<WorktimeAccrual, string> = {
  fixed: "固定天数",
  seniority: "按工龄",
}

export const WORKTIME_UNIT_LABELS: Record<WorktimeUnit, string> = {
  day: "天",
  hour: "小时",
}

/** 某池生效的规则:块上存的优先,缺项按缺省兜底(手改过的文件、旧块都可能缺字段)。 */
export function worktimePolicy(block: WorktimeBlock, optionId: string): WorktimePolicy {
  const stored = block.policies[optionId]
  if (stored === undefined) return { ...WORKTIME_POLICY_DEFAULT, tiers: WORKTIME_TIERS_DEFAULT.map((tier) => ({ ...tier })) }
  return {
    unit: stored.unit,
    validityMonths: stored.validityMonths,
    reset: stored.reset,
    resetMonthDay: stored.resetMonthDay,
    carryOverMax: stored.carryOverMax,
    carryOverDeadline: stored.carryOverDeadline,
    autoGrant: stored.autoGrant,
    grantFrom: stored.grantFrom,
    periodLimit: stored.periodLimit,
    accrual: stored.accrual,
    fixedDays: stored.fixedDays,
    tiers: stored.tiers.map((tier) => ({ ...tier })),
    prorate: stored.prorate,
    expiryAlign: stored.expiryAlign,
    consume: stored.consume,
    scope: stored.scope,
    chain: stored.chain,
    chainOrder: stored.chainOrder,
    hoursPerDay: stored.hoursPerDay,
    lapse: stored.lapse,
  }
}

// ---- 日期 ----

const DAY_MS = 86_400_000

function toUtc(date: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (match === null) return null
  const year = Number(match[1] ?? 0)
  const month = Number(match[2] ?? 1)
  const day = Number(match[3] ?? 1)
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return new Date(Date.UTC(year, month - 1, day))
}

function dateText(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, "0")
  const month = String(date.getUTCMonth() + 1).padStart(2, "0")
  const day = String(date.getUTCDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function shiftMonths(date: string, months: number): string {
  const utc = toUtc(date)
  if (utc === null) return date
  const total = utc.getUTCFullYear() * 12 + utc.getUTCMonth() + months
  const year = Math.floor(total / 12)
  const month = (total % 12) + 1
  const day = Math.min(utc.getUTCDate(), lastDayOfMonth(year, month))
  return dateText(new Date(Date.UTC(year, month - 1, day)))
}

export function addDays(date: string, days: number): string {
  const utc = toUtc(date)
  if (utc === null) return date
  return dateText(new Date(utc.getTime() + days * DAY_MS))
}

export function addMonths(date: string, months: number): string {
  return shiftMonths(date, months)
}

/** 该日期所在月的最后一天。 */
export function monthEndOf(date: string): string {
  const utc = toUtc(date)
  if (utc === null) return date
  const year = utc.getUTCFullYear()
  const month = utc.getUTCMonth() + 1
  return dateText(new Date(Date.UTC(year, month - 1, lastDayOfMonth(year, month))))
}

/**
 * 一笔额度的到期日。`""` = 不过期。
 *
 * `validityMonths: 0` 配 `expiryAlign: "monthEnd"` 是「当月有效」而不是「永不过期」——
 * 「月」被点名之后,0 月就是「不满一个月」。加班用 `1 + monthEnd`(次月末),陪产假用
 * `0 + monthEnd`(当月末,也就是次月 1 号起失效)。
 */
export function lotExpiry(policy: WorktimePolicy, date: string): string {
  const counted = policy.validityMonths > 0 || policy.expiryAlign === "monthEnd"
  if (!counted) return ""
  const shifted = policy.validityMonths > 0 ? shiftMonths(date, policy.validityMonths) : date
  return policy.expiryAlign === "monthEnd" ? monthEndOf(shifted) : shifted
}

/** `to - from` 的整天数。任一日期非法返回 null。 */
export function diffDays(from: string, to: string): number | null {
  const start = toUtc(from)
  const end = toUtc(to)
  if (start === null || end === null) return null
  return Math.round((end.getTime() - start.getTime()) / DAY_MS)
}

/** 本机日历日 —— 与订阅块同一口径,状态按用户眼前的「今天」算,不按 UTC。 */
export function localToday(now = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const day = String(now.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

/**
 * 入职周年 / 财年的起点月-日。
 *
 * `fiscal` 用块上的 `resetMonthDay`;`anniversary` 用入职日期的月-日 —— 后者没有入职日期
 * 时退回自然年(总比整池不发要好,视图里也会明说「缺入职日期」)。
 */
function anchorMonthDay(policy: WorktimePolicy, hire: string): string {
  if (policy.reset === "fiscal") return /^\d{2}-\d{2}$/.test(policy.resetMonthDay) ? policy.resetMonthDay : "01-01"
  if (policy.reset === "anniversary") {
    const match = /^\d{4}-(\d{2}-\d{2})$/.exec(hire)
    if (match !== null) return match[1] ?? "01-01"
  }
  return "01-01"
}

export interface WorktimePeriod {
  /** 周期起点,`YYYY-MM-DD`(含)。 */
  start: string
  /** 周期终点,`YYYY-MM-DD`(含)。 */
  end: string
}

/** 某一天落在哪个周期里。用于算发放量、本期已用与结转边界。 */
export function periodAt(date: string, policy: WorktimePolicy, hire: string): WorktimePeriod {
  const utc = toUtc(date)
  if (utc === null) return { start: date, end: date }
  const anchor = anchorMonthDay(policy, hire)
  const year = utc.getUTCFullYear()
  const candidate = `${year}-${anchor}`
  const start = date < candidate ? `${year - 1}-${anchor}` : candidate
  return { start, end: addDays(shiftMonths(start, 12), -1) }
}

function nextPeriod(period: WorktimePeriod): WorktimePeriod {
  const start = shiftMonths(period.start, 12)
  return { start, end: addDays(shiftMonths(start, 12), -1) }
}

// ---- 年假发放 ----

/** 满多少年(完整年数,按日对齐)。入职日期非法或晚于参照日时返回 0。 */
export function seniorityYears(hire: string, on: string): number {
  const start = toUtc(hire)
  const ref = toUtc(on)
  if (start === null || ref === null || ref < start) return 0
  let years = ref.getUTCFullYear() - start.getUTCFullYear()
  const beforeAnniversary =
    ref.getUTCMonth() < start.getUTCMonth() ||
    (ref.getUTCMonth() === start.getUTCMonth() && ref.getUTCDate() < start.getUTCDate())
  if (beforeAnniversary) years -= 1
  return Math.max(0, years)
}

/** 工龄阶梯取值:取 `minYears` 不超过当前工龄的最后一档。阶梯为空返回 0。 */
export function tierDays(tiers: readonly WorktimeTier[], years: number): number {
  let days = 0
  let matched = false
  for (const tier of [...tiers].sort((left, right) => left.minYears - right.minYears)) {
    if (years < tier.minYears) continue
    days = tier.days
    matched = true
  }
  return matched ? days : 0
}

/** 一期按剩余月份折算:入职当期只发「剩下的月份 / 12」。0.5 天精度,人事台账够用。 */
function prorate(days: number, hire: string, period: WorktimePeriod): number {
  const start = toUtc(hire)
  const end = toUtc(period.end)
  if (start === null || end === null) return days
  const monthsLeft = (end.getUTCFullYear() * 12 + end.getUTCMonth()) - (start.getUTCFullYear() * 12 + start.getUTCMonth()) + 1
  if (monthsLeft >= 12) return days
  if (monthsLeft <= 0) return 0
  return Math.round((days * monthsLeft) / 12 / 0.5) * 0.5
}

/**
 * 一期应发的额度。`fixed` 直接给固定值;`seniority` 按**周期起点**的工龄取下限档 ——
 * 用起点而不是今天,是为了让同一期每次重算都得到同一个数(否则年中过生日余额会自己跳)。
 * 入职当期按剩余月份折算,入职不在本期则不折算。
 */
export function accrualDays(policy: WorktimePolicy, hire: string, period: WorktimePeriod): number {
  // 还没入职的那几期不发额度 —— 否则翻出一张老表,入职前的年份也挂着一笔年假。
  if (hire !== "" && hire > period.end) return 0
  const base = policy.accrual === "seniority" ? tierDays(policy.tiers, seniorityYears(hire, period.start)) : policy.fixedDays
  if (!policy.prorate || hire === "" || hire < period.start || hire > period.end) return base
  return prorate(base, hire, period)
}

// ---- 批次 ----

export interface WorktimeLot {
  /** 批次的身份。`grant:<期起>` / `carry:<期起>` / `row:<行 id>`。 */
  key: string
  /** 产生日。 */
  date: string
  /** 到期日,`""` = 永不过期。 */
  expiresOn: string
  amount: number
  used: number
  /** 来源行 id。周期额度与结转额度为空串。 */
  rowId: string
  /** 批次说明:「年度额度」「上期结转」「加班」…。 */
  label: string
}

function remaining(lot: WorktimeLot): number {
  return lot.amount - lot.used
}

/** 展示序:到期早的在前,永不过期的垫底;同到期日按产生日、再按批次键稳定。 */
function lotOrder(lot: WorktimeLot): string {
  return `${lot.expiresOn === "" ? "9999-12-31" : lot.expiresOn}|${lot.date}|${lot.key}`
}

function isAlive(lot: WorktimeLot, on: string): boolean {
  return lot.expiresOn === "" || lot.expiresOn >= on
}

/** 这一笔此刻还算不算余额。`retain` 的池过期只标记、不作废(陪产假口径)。 */
function counts(lot: WorktimeLot, policy: WorktimePolicy, on: string): boolean {
  return policy.lapse === "retain" || isAlive(lot, on)
}

/** 这一笔此刻还能不能被扣。`retain` 的池过了期也照扣 —— 账上还挂着,就得能用掉。 */
function spendable(lot: WorktimeLot, policy: WorktimePolicy, on: string): boolean {
  return policy.lapse === "retain" || isAlive(lot, on)
}

/**
 * 同池批次的扣减序。
 *
 * `expiry` 先到期先扣,永不过期的垫底;`latest` 最新一笔先扣(日期倒序,同日按批次键倒序,
 * 让后记的那笔先被吃掉)。两种序都要求批次日期不晚于使用日 —— 那一条在扣减处判,
 * 不在这里。
 */
function compareLots(left: WorktimeLot, right: WorktimeLot, consume: WorktimeConsume): number {
  if (consume === "latest") {
    const byDate = right.date.localeCompare(left.date)
    return byDate !== 0 ? byDate : right.key.localeCompare(left.key)
  }
  const byExpiry = lotOrder(left).localeCompare(lotOrder(right))
  return byExpiry
}

// ---- 报表 ----

export interface WorktimeEvent {
  rowId: string
  date: string
  person: string
  optionId: string
  amount: number
  note: string
}

/** 一笔使用从某个池里扣走多少(按池自己的单位)。链上一笔使用通常拆成好几份。 */
export interface WorktimeDraw {
  poolKey: string
  /** 扣走的量,按**该池**的单位 —— 不是小时。 */
  amount: number
}

export interface WorktimeRowInfo {
  /** 这一行发生后该池的可用余额。null = 这一行的类别不在池里(类别值为空或对不上选项)。 */
  balance: number | null
  /** 正数行的额度到期日;负数行(使用)为空串 —— 一次使用可能跨几个批次,标一个日期是撒谎。 */
  expiresOn: string
  /** 这一行落在哪个池上(`人员\\0选项`)。空串 = 没有池。 */
  poolKey: string
  /** 这一行所属的扣减链,空串 = 不在链上。链上时 `balance` 只是它自己那个池的,看合计。 */
  chainKey: string
  /** 这一行发生后整条链的合计余额(小时)。不在链上时为 null。 */
  chainBalance: number | null
  /** 这一行拆到了哪几个池。空数组 = 没拆(不入链,或这一行是获得)。 */
  draws: readonly WorktimeDraw[]
}

export interface WorktimePool {
  key: string
  person: string
  optionId: string
  name: string
  policy: WorktimePolicy
  /** 可用余额 = 未过期批次的剩余 − 超支量。可以是负数(先用了额度再说)。 */
  available: number
  /** 本期按规则**自动发放**的额度。`reset` 关了或没开自动发放时为 0。 */
  granted: number
  /** 本期**手工登记**的正数行合计(补发、临时调整)。与 `granted` 分开,余额才不会把「规则算的」与「人记的」混成一句话。 */
  added: number
  /** 本期结转进来的量。 */
  carryIn: number
  /** 本期该池被消耗的量(正数)。链上被别的池借走的也算进来 —— 否则卡片上「余额少了、已用没动」。 */
  used: number
  /** 已作废量(含历史上没结转掉的)。`lapse: "retain"` 的池恒为 0。 */
  expired: number
  /** 未来 `soonDays` 天内到期的剩余量。 */
  soon: number
  /** 最近一个到期日,空串 = 没有即将到期的额度。 */
  soonOn: string
  lots: readonly WorktimeLot[]
}

/**
 * 一条扣减链:同人员、同链名的池合起来算一次「可用多少小时」。
 *
 * 链不改任何成员的过期读法,只回答「这笔调休还能请几小时」。链上没有额度的池(调休)
 * 让合计更有意义 —— 它自己的余额恒为 0,值钱的是别人还剩多少。
 */
export interface WorktimeChain {
  key: string
  person: string
  name: string
  /** 链合计可用量,恒按**小时**。 */
  available: number
  /** 成员池的 key,按取额度顺序(扣减时也是这个顺序)。 */
  members: readonly string[]
}

export interface WorktimeReport {
  pools: readonly WorktimePool[]
  chains: readonly WorktimeChain[]
  rows: ReadonlyMap<string, WorktimeRowInfo>
  /** 出现过的全部人员,按首现序。单人表为空数组。 */
  persons: readonly string[]
}

interface PoolBucket {
  person: string
  optionId: string
  name: string
  policy: WorktimePolicy
  hire: string
  events: WorktimeEvent[]
}

/** 空行 / 无日期 / 无数值 / 无类别的行不进报表 —— 新建预设表带的空行不该算成一次变动。 */
function eventOf(row: DataRow, roles: WorktimeRoles, statusValue: string): WorktimeEvent | null {
  if (roles.date === null || roles.kind === null || roles.amount === null) return null
  const dateValue = cellValue(row, roles.date)
  if (typeof dateValue !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return null

  const amountValue = cellValue(row, roles.amount)
  if (typeof amountValue !== "number" || !Number.isFinite(amountValue) || amountValue === 0) return null

  const kindValue = cellValue(row, roles.kind)
  if (typeof kindValue !== "string" || kindValue === "") return null

  if (statusValue !== "" && roles.status !== null) {
    const status = cellValue(row, roles.status)
    if (status !== statusValue) return null
  }

  const personValue = roles.person === null ? "" : cellValue(row, roles.person)
  const noteValue = roles.note === null ? "" : cellValue(row, roles.note)

  return {
    rowId: row.id,
    date: dateValue,
    person: typeof personValue === "string" ? personValue.trim() : "",
    optionId: kindValue,
    amount: amountValue,
    note: typeof noteValue === "string" ? noteValue : "",
  }
}

/** 一行里读出的入职日期。人员分池时每人各取自己那行的第一条非空值。 */
function hireOf(row: DataRow, column: DataColumn | null): string {
  if (column === null) return ""
  const value = cellValue(row, column)
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ""
}

interface PoolResult {
  pool: WorktimePool
  /** 行 id → 该行发生后的池余额与额度到期日。 */
  rows: Map<string, WorktimeRowInfo>
}

/**
 * 一个池的计算状态。链上多个池各持一份,共享的是「一笔使用从谁那儿扣」。
 *
 * 从 `runPool` 的局部变量提成结构体,是因为链把「一个池自己跑完」变成「几个池交织着跑」——
 * 周期游标、结转量、作废量必须跨事件保留,不能再塞在同一个 for 循环里。
 */
interface PoolState {
  bucket: PoolBucket
  policy: WorktimePolicy
  /** 周期口径(`reset !== "none"` 且不是逐笔有效期)。逐笔口径的池忽略周期字段。 */
  periodMode: boolean
  lots: WorktimeLot[]
  rows: Map<string, WorktimeRowInfo>
  /** 周期循环从哪一天起算。空串 = 这一池不发放,周期机器不启动。 */
  anchor: string
  windowStart: WorktimePeriod | null
  cursor: WorktimePeriod | null
  /** 已经做过期初动作的期起点 —— `advanceTo` 靠它防重入。 */
  opened: string
  issued: number
  closed: boolean
  /** 超支量(本池单位)。链上扣不动的部分记在使用行所属的池上。 */
  debt: number
  forfeited: number
  current: WorktimePeriod
  grantedNow: number
  addedNow: number
  carryInNow: number
  usedNow: number
}

function poolKeyOf(person: string, optionId: string): string {
  return `${person}\u0000${optionId}`
}

function keyOf(state: PoolState): string {
  return poolKeyOf(state.bucket.person, state.bucket.optionId)
}

/** 池单位 → 链单位(小时)的折算比。小时池恒为 1;天池按 `hoursPerDay`。 */
export function hoursPerUnit(policy: WorktimePolicy): number {
  if (policy.unit === "hour") return 1
  return policy.hoursPerDay > 0 ? policy.hoursPerDay : WORKTIME_HOURS_PER_DAY_DEFAULT
}

/** 这一行是否落在「本期」—— 只影响 granted / added / used 三个统计量,不影响余额。 */
function inCurrent(state: PoolState, date: string): boolean {
  return date >= state.current.start && date <= state.current.end
}

/** 池的可用余额(本池单位)。含超支,所以可以是负数。 */
function balanceOf(state: PoolState, on: string): number {
  let total = 0
  for (const lot of state.lots) if (counts(lot, state.policy, on)) total += remaining(lot)
  return total - state.debt
}

function chainBalanceOf(states: readonly PoolState[], on: string): number {
  let total = 0
  for (const state of states) total += balanceOf(state, on) * hoursPerUnit(state.policy)
  return total
}

/** 逐笔口径的池,一笔正数行的到期日;周期口径下有效期跟着周期走,不用这个。 */
function lotExpiryOf(state: PoolState, date: string): string {
  return lotExpiry(state.policy, date)
}

/**
 * 期初结算:上期剩余按上限结转到本期,其余作废。
 *
 * 判定「上期剩余」用 `prev.end` 这一天 —— 期末到期的周期额度会算进来(它正好在期末失效),
 * 而结转额度若在期中就到期了则不算,那部分直接进作废量。
 */
function settle(state: PoolState, period: WorktimePeriod): void {
  const policy = state.policy
  const lots = state.lots
  if (lots.length === 0) return
  const prevEnd = addDays(period.start, -1)
  let alive = 0
  let dead = 0
  for (const lot of lots) {
    const value = remaining(lot)
    if (value <= 0) continue
    if (isAlive(lot, prevEnd)) alive += value
    else dead += value
  }
  state.forfeited += dead
  const cap = policy.carryOverMax
  const carry = cap === null ? alive : Math.max(0, Math.min(alive, cap))
  state.forfeited += alive - carry
  lots.length = 0
  if (carry <= 0) return
  // 结转失效日落在**本期内**:填 03-31 而周期 04-01 起算时,那一年的 03-31 早已过去,
  // 要算到下一个自然年;算出来的日期仍不在本期内(周期短于两个月这种配置)就退回期末 ——
  // 否则刚结转的额度会当场作废。
  let expiresOn = period.end
  if (/^\d{2}-\d{2}$/.test(policy.carryOverDeadline)) {
    const year = Number(period.start.slice(0, 4))
    const sameYear = `${year}-${policy.carryOverDeadline}`
    const candidate = sameYear > period.start ? sameYear : `${year + 1}-${policy.carryOverDeadline}`
    if (candidate <= period.end) expiresOn = candidate
  }
  lots.push({ key: `carry:${period.start}`, date: period.start, expiresOn, amount: carry, used: 0, rowId: "", label: "上期结转" })
  if (period.start === state.current.start) state.carryInNow += carry
}

/**
 * 一期的期初动作:结算上期 → 发放本期。
 *
 * `opened` 保证同一期只做一次 —— 逐事件推进时,一期里可能有几十条事件,结算跑第二遍会把
 * 刚刚发放的额度当场结掉。
 */
function openPeriod(state: PoolState, period: WorktimePeriod): void {
  const policy = state.policy
  const inFrom = state.windowStart === null || period.start >= state.windowStart.start
  // 窗口用完之后不再 settle:否则最后一期没结转掉的额度会被按 carryOverMax 一路滚下去。
  if (!state.closed) settle(state, period)
  if (inFrom && !state.closed && policy.autoGrant) {
    const days = accrualDays(policy, state.bucket.hire, period)
    if (days !== 0) {
      state.lots.push({
        key: `grant:${period.start}`,
        date: period.start,
        expiresOn: period.end,
        amount: days,
        used: 0,
        rowId: "",
        label: period.start === state.current.start ? "本期额度" : "周期额度",
      })
      if (period.start === state.current.start) state.grantedNow += days
    }
  }
  if (inFrom) {
    state.issued += 1
    if (policy.periodLimit > 0 && state.issued >= policy.periodLimit) state.closed = true
  }
  state.opened = period.start
}

/** 把周期游标推到含 `date` 的那一期,路上的每一期都做期初动作。 */
function advanceTo(state: PoolState, date: string): void {
  if (!state.periodMode || state.anchor === "") return
  if (state.cursor === null) state.cursor = periodAt(state.anchor, state.policy, state.bucket.hire)
  while (state.cursor.start <= date) {
    if (state.opened !== state.cursor.start) openPeriod(state, state.cursor)
    if (state.cursor.end >= date) return
    const next = nextPeriod(state.cursor)
    // 起算日是个不存在的日期(手改文件能造出 2026-13-45)时 `nextPeriod` 原地不动 —— 再转一圈
    // 就是死循环,而这一池的额度本来也没法算。停在这里,让报表带着不对的数出来。
    if (next.start === state.cursor.start) return
    state.cursor = next
  }
}

/**
 * 一次性额度:`reset: "none"` + `autoGrant` + `grantFrom`。
 *
 * 陪产假「出生起 15 天,一次给完」是这条路径 —— 它不属于任何周期,也不该被手记。
 * 到期仍按逐笔口径算(`validityMonths` / `expiryAlign`),所以「出生当月有效」= 0 月 + 月末。
 */
function grantOnce(state: PoolState): void {
  const policy = state.policy
  if (policy.reset !== "none" || !policy.autoGrant || policy.grantFrom === "") return
  const days =
    policy.accrual === "seniority"
      ? tierDays(policy.tiers, seniorityYears(state.bucket.hire, policy.grantFrom))
      : policy.fixedDays
  if (days === 0) return
  state.lots.push({
    key: `once:${policy.grantFrom}`,
    date: policy.grantFrom,
    expiresOn: lotExpiryOf(state, policy.grantFrom),
    amount: days,
    used: 0,
    rowId: "",
    label: "一次性额度",
  })
  if (inCurrent(state, policy.grantFrom)) state.grantedNow += days
}

interface Take {
  /** 扣掉的量,按本池单位。 */
  amount: number
  /** 扣掉的量,按小时。 */
  hours: number
}

/**
 * 从一个池里扣 `needHours` 小时。
 *
 * 三条约束缺一不可:批次日期不晚于使用日(不能提前吃还没发生的额度)、批次此刻可扣、
 * 本池还有剩。扣不动就返回实扣量,超支由调用方记账。
 */
function takeFromState(state: PoolState, needHours: number, onDate: string): Take {
  const rate = hoursPerUnit(state.policy)
  const ordered = [...state.lots].sort((left, right) => compareLots(left, right, state.policy.consume))
  let need = needHours
  let hours = 0
  for (const lot of ordered) {
    if (need <= 0) break
    if (lot.date > onDate) continue
    if (!spendable(lot, state.policy, onDate)) continue
    const available = remaining(lot) * rate
    if (available <= 0) continue
    const take = Math.min(need, available)
    lot.used += take / rate
    need -= take
    hours += take
  }
  return { amount: hours / rate, hours }
}

/**
 * 一笔使用落到链上:按 `states` 的顺序依次取,取不满的记在使用行所属池的超支上。
 *
 * `states` 已经按 `chainOrder` 排好;只有一个成员时等价于「自己扣自己」(0029 的口径)。
 */
function applyUse(
  states: readonly PoolState[],
  own: PoolState,
  event: WorktimeEvent,
): readonly WorktimeDraw[] {
  const ownRate = hoursPerUnit(own.policy)
  // 链按小时撮合,所以先把这一笔折成小时;`amount` 原文是池单位。
  let need = -event.amount * ownRate
  const draws: WorktimeDraw[] = []
  for (const state of states) {
    if (need <= 0) break
    const take = takeFromState(state, need, event.date)
    if (take.hours <= 0) continue
    draws.push({ poolKey: keyOf(state), amount: take.amount })
    need -= take.hours
    // 使用行所属的池统一在下面按整笔加,这里只记「被别人借走的」,免得同一笔算两遍。
    if (state !== own && inCurrent(state, event.date)) state.usedNow += take.amount
  }
  if (need > 0) own.debt += need / ownRate
  if (inCurrent(own, event.date)) own.usedNow += -event.amount
  return draws
}

function createState(bucket: PoolBucket, today: string): PoolState {
  const policy = bucket.policy
  const perLot = policy.validityMonths > 0 || policy.expiryAlign === "monthEnd"
  const periodMode = policy.reset !== "none" && !perLot
  const events = [...bucket.events].sort((left, right) => left.date.localeCompare(right.date))

  let anchor = ""
  let windowStart: WorktimePeriod | null = null
  if (periodMode) {
    // 一条变动都还没有的池也要把**本期额度**发出来:空白台账上「年假 应享 0」是错的 ——
    // 规则明明写着按工龄发,只是没人记账而已。没有历史可回溯,所以只发当前这一期。
    //
    // 配了起算日则以它为准,而且**不受「只发当前这一期」的限制**:起算日是用户给的事实
    // (育儿假 2025-04-01 才开始),从那天到今天的每一期都该发,哪怕表里一条记录都没有。
    windowStart = policy.grantFrom === "" ? null : periodAt(policy.grantFrom, policy, bucket.hire)
    const first = events[0]
    const earliest = first === undefined ? today : first.date
    if (windowStart !== null) anchor = earliest < windowStart.start ? earliest : windowStart.start
    else if (first !== undefined) anchor = first.date
    else if (policy.autoGrant) anchor = today
  }

  return {
    bucket,
    policy,
    periodMode,
    lots: [],
    rows: new Map(),
    anchor,
    windowStart,
    cursor: null,
    opened: "",
    issued: 0,
    closed: false,
    debt: 0,
    forfeited: 0,
    current: periodMode
      ? periodAt(today, policy, bucket.hire)
      : { start: `${today.slice(0, 4)}-01-01`, end: `${today.slice(0, 4)}-12-31` },
    grantedNow: 0,
    addedNow: 0,
    carryInNow: 0,
    usedNow: 0,
  }
}

/**
 * 跑一组池。组里只有一个成员时就是「一个池自己跑」(0029 的口径);多于一个就是一条扣减链。
 *
 * 事件按日期合并后逐条处理 —— 链上的使用行必须落在正确的时间位置:4 月的一笔调休不能吃到
 * 5 月才记的加班。每处理一条,先把它所属的池推进到那一天(周期发放/结转),链上还要把每个
 * 供给池也推到位,否则那一期的额度还没发,扣不到。
 */
function runGroup(buckets: readonly PoolBucket[], today: string, soonDays: number): Map<string, PoolResult> {
  const states = buckets.map((bucket) => createState(bucket, today))
  const chained = states.length > 1 || (states[0] !== undefined && isChained(states[0].policy))
  for (const state of states) grantOnce(state)

  const timeline: { event: WorktimeEvent; own: PoolState }[] = []
  for (const state of states) {
    for (const event of state.bucket.events) timeline.push({ event, own: state })
  }
  timeline.sort((left, right) => {
    const byDate = left.event.date.localeCompare(right.event.date)
    return byDate !== 0 ? byDate : keyOf(left.own).localeCompare(keyOf(right.own))
  })

  for (const { event, own } of timeline) {
    for (const state of states) advanceTo(state, event.date)
    const chainKey = chained ? chainKeyOf(own) : ""
    if (event.amount > 0) {
      const expiresOn = own.periodMode ? periodAt(event.date, own.policy, own.bucket.hire).end : lotExpiryOf(own, event.date)
      own.lots.push({
        key: `row:${event.rowId}`,
        date: event.date,
        expiresOn,
        amount: event.amount,
        used: 0,
        rowId: event.rowId,
        label: event.note === "" ? "登记" : event.note,
      })
      if (inCurrent(own, event.date)) own.addedNow += event.amount
      own.rows.set(event.rowId, {
        balance: balanceOf(own, event.date),
        expiresOn,
        poolKey: keyOf(own),
        chainKey,
        chainBalance: chained ? chainBalanceOf(states, event.date) : null,
        draws: [],
      })
      continue
    }
    const draws = applyUse(states, own, event)
    own.rows.set(event.rowId, {
      balance: balanceOf(own, event.date),
      expiresOn: "",
      poolKey: keyOf(own),
      chainKey,
      chainBalance: chained ? chainBalanceOf(states, event.date) : null,
      draws,
    })
  }

  // 尾巴:最后一条事件可能早于今天,周期机器得继续走到今天 —— 否则今年这一期的额度发不出来。
  for (const state of states) advanceTo(state, today)

  const results = new Map<string, PoolResult>()
  for (const state of states) results.set(keyOf(state), summarize(state, today, soonDays))
  return results
}

/** 这一池是否挂在一条件扣减链上。 */
export function isChained(policy: WorktimePolicy): boolean {
  return policy.scope === "chain" && policy.chain !== ""
}

function chainKeyOf(state: PoolState): string {
  return isChained(state.policy) ? `${state.bucket.person}\u0000${state.policy.chain}` : ""
}

function summarize(state: PoolState, today: string, soonDays: number): PoolResult {
  const retain = state.policy.lapse === "retain"
  // 今天视角:可用、即将到期、已作废。作废量含「历史期没结转掉的部分」与「还没到期结算但已过期」两截。
  let expiredNow = 0
  let soon = 0
  let soonOn = ""
  const soonLimit = addDays(today, soonDays)
  for (const lot of state.lots) {
    const value = remaining(lot)
    if (value <= 0) continue
    if (!isAlive(lot, today)) {
      if (!retain) expiredNow += value
      continue
    }
    if (lot.expiresOn !== "" && lot.expiresOn <= soonLimit) {
      soon += value
      if (soonOn === "" || lot.expiresOn < soonOn) soonOn = lot.expiresOn
    }
  }

  return {
    pool: {
      key: keyOf(state),
      person: state.bucket.person,
      optionId: state.bucket.optionId,
      name: state.bucket.name,
      policy: state.policy,
      available: balanceOf(state, today),
      granted: state.grantedNow,
      added: state.addedNow,
      carryIn: state.carryInNow,
      used: state.usedNow,
      expired: retain ? 0 : state.forfeited + expiredNow,
      soon,
      soonOn,
      lots: [...state.lots].sort((left, right) => lotOrder(left).localeCompare(lotOrder(right))),
    },
    rows: state.rows,
  }
}

/**
 * 整张表的工时报表。
 *
 * 池 = 类别列的**选项** × 人员。选项顺序即摘要条的卡片顺序(假期的自然顺序);
 * 人员顺序按首现序。类别值为空、或对不上任何选项的行不进任何池,明细里照样列出
 * —— 它们是「还没分类」的行,不是该被悄悄丢掉的错误。
 */
export function worktimeReport(
  rows: readonly DataRow[],
  roles: WorktimeRoles,
  block: WorktimeBlock,
  today: string,
): WorktimeReport {
  const events: WorktimeEvent[] = []
  const persons: string[] = []
  const seenPerson = new Set<string>()
  const hires = new Map<string, string>()

  const statusValue = block.statusColumnId === "" ? "" : block.statusValue

  for (const row of rows) {
    const event = eventOf(row, roles, statusValue)
    if (event !== null) events.push(event)
    const person = event?.person ?? (roles.person === null ? "" : String(cellValue(row, roles.person) ?? "").trim())
    if (roles.person !== null && person !== "" && !seenPerson.has(person)) {
      seenPerson.add(person)
      persons.push(person)
    }
    if (!hires.has(person)) {
      const hire = hireOf(row, roles.hire)
      if (hire !== "") hires.set(person, hire)
    }
  }

  const options = roles.kind?.options ?? []
  const buckets = new Map<string, PoolBucket>()
  const people = persons.length === 0 ? [""] : persons
  for (const option of options) {
    for (const person of people) {
      buckets.set(poolKeyOf(person, option.id), {
        person,
        optionId: option.id,
        name: option.name,
        policy: worktimePolicy(block, option.id),
        hire: hires.get(person) ?? "",
        events: [],
      })
    }
  }

  for (const event of events) {
    const bucket = buckets.get(poolKeyOf(event.person, event.optionId))
    if (bucket !== undefined) bucket.events.push(event)
  }

  // 分组:不在链上的池各跑各的;同人员同链名的池合成一组,共享一条扣减链。
  const groups = new Map<string, PoolBucket[]>()
  const groupOrder: string[] = []
  for (const bucket of buckets.values()) {
    const key = groupKeyOf(bucket)
    const list = groups.get(key)
    if (list === undefined) {
      groups.set(key, [bucket])
      groupOrder.push(key)
    } else {
      list.push(bucket)
    }
  }

  const pools: WorktimePool[] = []
  const chains: WorktimeChain[] = []
  const rowInfo = new Map<string, WorktimeRowInfo>()
  for (const key of groupOrder) {
    const members = groups.get(key) ?? []
    // 链内取额度的顺序由 `chainOrder` 定;同值时保持选项顺序(`sort` 稳定)。
    members.sort((left, right) => left.policy.chainOrder - right.policy.chainOrder)
    const results = runGroup(members, today, block.soonDays)
    for (const bucket of members) {
      const result = results.get(poolKeyOf(bucket.person, bucket.optionId))
      if (result === undefined) continue
      pools.push(result.pool)
      for (const [rowId, info] of result.rows) rowInfo.set(rowId, info)
    }
    const first = members[0]
    if (first !== undefined && isChained(first.policy)) {
      chains.push({
        key: `${first.person}\u0000${first.policy.chain}`,
        person: first.person,
        name: first.policy.chain,
        available: members.reduce((sum, bucket) => {
          const pool = pools.find((item) => item.key === poolKeyOf(bucket.person, bucket.optionId))
          return pool === undefined ? sum : sum + pool.available * hoursPerUnit(bucket.policy)
        }, 0),
        members: members.map((bucket) => poolKeyOf(bucket.person, bucket.optionId)),
      })
    }
  }

  return { pools, chains, rows: rowInfo, persons }
}

/** 分组键:链上池按「人员 + 链名」合并,其余各自一组。 */
function groupKeyOf(bucket: PoolBucket): string {
  const policy = bucket.policy
  return isChained(policy)
    ? `chain\u0000${bucket.person}\u0000${policy.chain}`
    : `pool\u0000${bucket.person}\u0000${bucket.optionId}`
}

// ---- 序列化辅助 ----

/** 每池规则写进快照的紧凑形态 —— 属性里存完整对象太占地方。 */
export function encodeWorktimePolicies(policies: Record<string, WorktimePolicy>): string {
  const entries = Object.entries(policies)
  if (entries.length === 0) return ""
  const packed: Record<string, unknown> = {}
  for (const [optionId, policy] of entries) {
    packed[optionId] = {
      unit: policy.unit,
      validity: policy.validityMonths,
      reset: policy.reset,
      md: policy.resetMonthDay,
      cap: policy.carryOverMax,
      deadline: policy.carryOverDeadline,
      grant: policy.autoGrant,
      from: policy.grantFrom,
      periods: policy.periodLimit,
      accrual: policy.accrual,
      days: policy.fixedDays,
      tiers: policy.tiers.map((tier) => [tier.minYears, tier.days]),
      prorate: policy.prorate,
      align: policy.expiryAlign,
      consume: policy.consume,
      scope: policy.scope,
      chain: policy.chain,
      order: policy.chainOrder,
      hpd: policy.hoursPerDay,
      lapse: policy.lapse,
    }
  }
  return JSON.stringify(packed)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function pickString(record: Record<string, unknown>, key: string, fallback: string): string {
  const value = record[key]
  return typeof value === "string" ? value : fallback
}

function pickNumber(record: Record<string, unknown>, key: string, fallback: number): number {
  const value = record[key]
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function isReset(value: string): value is WorktimeReset {
  return value === "none" || value === "calendar" || value === "fiscal" || value === "anniversary"
}

function isAccrual(value: string): value is WorktimeAccrual {
  return value === "fixed" || value === "seniority"
}

function isUnit(value: string): value is WorktimeUnit {
  return value === "day" || value === "hour"
}

function isAlign(value: string): value is WorktimeExpiryAlign {
  return value === "none" || value === "monthEnd"
}

function isConsume(value: string): value is WorktimeConsume {
  return value === "expiry" || value === "latest"
}

function isScope(value: string): value is WorktimeScope {
  return value === "standalone" || value === "chain"
}

function isLapse(value: string): value is WorktimeLapse {
  return value === "writeoff" || value === "retain"
}

function decodeTiers(value: unknown): WorktimeTier[] {
  if (!Array.isArray(value)) return WORKTIME_TIERS_DEFAULT.map((tier) => ({ ...tier }))
  const tiers: WorktimeTier[] = []
  for (const item of value) {
    if (!Array.isArray(item)) continue
    const years = item[0]
    const days = item[1]
    if (typeof years !== "number" || typeof days !== "number" || !Number.isFinite(years) || !Number.isFinite(days)) continue
    tiers.push({ minYears: years, days })
  }
  return tiers.length === 0 ? WORKTIME_TIERS_DEFAULT.map((tier) => ({ ...tier })) : tiers
}

/**
 * `data-policies` → 每池规则。宽容读取:不是 JSON、项不是对象、字段类型不对的一律落回
 * 缺省 —— 手改过的文件不该让整块变成「读不到」。
 */
export function decodeWorktimePolicies(raw: string | null): Record<string, WorktimePolicy> {
  if (raw === null || raw.trim() === "") return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!isRecord(parsed)) return {}

  const policies: Record<string, WorktimePolicy> = {}
  for (const [optionId, item] of Object.entries(parsed)) {
    if (optionId === "" || !isRecord(item)) continue
    const unit = pickString(item, "unit", WORKTIME_POLICY_DEFAULT.unit)
    const reset = pickString(item, "reset", WORKTIME_POLICY_DEFAULT.reset)
    const accrual = pickString(item, "accrual", WORKTIME_POLICY_DEFAULT.accrual)
    const align = pickString(item, "align", "none")
    const consume = pickString(item, "consume", "expiry")
    const scope = pickString(item, "scope", "standalone")
    const lapse = pickString(item, "lapse", "writeoff")
    const cap = item.cap
    policies[optionId] = {
      unit: isUnit(unit) ? unit : WORKTIME_POLICY_DEFAULT.unit,
      validityMonths: Math.max(0, Math.round(pickNumber(item, "validity", 0))),
      reset: isReset(reset) ? reset : "none",
      resetMonthDay: /^\d{2}-\d{2}$/.test(pickString(item, "md", "")) ? pickString(item, "md", "") : "01-01",
      carryOverMax: typeof cap === "number" && Number.isFinite(cap) ? Math.max(0, cap) : null,
      carryOverDeadline: /^\d{2}-\d{2}$/.test(pickString(item, "deadline", "")) ? pickString(item, "deadline", "") : "",
      autoGrant: item.grant === true,
      grantFrom: /^\d{4}-\d{2}-\d{2}$/.test(pickString(item, "from", "")) ? pickString(item, "from", "") : "",
      periodLimit: Math.max(0, Math.round(pickNumber(item, "periods", 0))),
      accrual: isAccrual(accrual) ? accrual : "fixed",
      fixedDays: Math.max(0, pickNumber(item, "days", WORKTIME_POLICY_DEFAULT.fixedDays)),
      tiers: decodeTiers(item.tiers),
      prorate: item.prorate !== false,
      expiryAlign: isAlign(align) ? align : "none",
      consume: isConsume(consume) ? consume : "expiry",
      scope: isScope(scope) ? scope : "standalone",
      chain: pickString(item, "chain", ""),
      chainOrder: Math.round(pickNumber(item, "order", 0)),
      hoursPerDay: (() => {
        const raw = pickNumber(item, "hpd", WORKTIME_HOURS_PER_DAY_DEFAULT)
        return raw > 0 ? raw : WORKTIME_HOURS_PER_DAY_DEFAULT
      })(),
      lapse: isLapse(lapse) ? lapse : "writeoff",
    }
  }
  return policies
}

// ---- 展示 ----

/** 去掉无意义的尾零:12 → 12,3.5 → 3.5,2.333 → 2.33。 */
export function formatQuantity(value: number): string {
  const normalized = Object.is(value, -0) ? 0 : value
  return String(Math.round(normalized * 100) / 100)
}

/** 带单位的一条:`3.5 天` / `-4 小时`。负数用真减号。 */
export function quantityWithUnit(value: number, unit: WorktimeUnit): string {
  return `${value < 0 ? "−" : ""}${formatQuantity(Math.abs(value))} ${WORKTIME_UNIT_LABELS[unit]}`
}

// ---- 预置表 ----

export interface WorktimePreset {
  table: DataTable
  /** 角色 → 列 id。新块据此把列映射写死,列名再改也不影响。 */
  roles: Record<WorktimeRole, string>
  /** 选项 id → 规则。五类池各有一份开箱可用的口径。 */
  policies: Record<string, WorktimePolicy>
}

function policyOf(patch: Partial<WorktimePolicy>): WorktimePolicy {
  return {
    ...WORKTIME_POLICY_DEFAULT,
    tiers: WORKTIME_TIERS_DEFAULT.map((tier) => ({ ...tier })),
    ...patch,
  }
}

/**
 * 参考表:日期 / 人员 / 类别 / 时长 / 事由 / 入职日期,五类池各带一份规则。
 *
 * - **年假**:按工龄发,自然年重置,结转上限 5 天、次年 3-31 失效 —— 最接近国内公司口径。
 * - **调休**:加班换来的假 3 个月有效,逐笔过期。
 * - **加班**:只记时长,不设有效期(它的价值在兑换成调休,不在自己过期)。
 * - **事假 / 病假**:只记使用,余额天然为负 —— 那正是「用掉了多少没额度的假」。
 */
export function createWorktimePreset(): WorktimePreset {
  const date = emptyColumn("日期", "date")
  const person = emptyColumn("人员")
  const kind = emptyColumn("类别", "select")
  const amount = emptyColumn("时长", "number")
  const note = emptyColumn("事由")
  const hire = emptyColumn("入职日期", "date")

  const annual = createOptionId()
  const comp = createOptionId()
  const overtime = createOptionId()
  const personal = createOptionId()
  const sick = createOptionId()
  kind.options.push(
    { id: annual, name: "年假" },
    { id: comp, name: "调休" },
    { id: overtime, name: "加班" },
    { id: personal, name: "事假" },
    { id: sick, name: "病假" },
  )

  const columns = [date, person, kind, amount, note, hire]
  return {
    table: { version: DATA_TABLE_VERSION, columns, rows: [emptyRow(columns)] },
    roles: {
      date: date.id,
      person: person.id,
      kind: kind.id,
      amount: amount.id,
      note: note.id,
      status: "",
      hire: hire.id,
    },
    policies: {
      [annual]: policyOf({
        unit: "day",
        reset: "calendar",
        carryOverMax: 5,
        carryOverDeadline: "03-31",
        autoGrant: true,
        accrual: "seniority",
      }),
      [comp]: policyOf({ unit: "hour", validityMonths: 3 }),
      [overtime]: policyOf({ unit: "hour" }),
      [personal]: policyOf({ unit: "day" }),
      [sick]: policyOf({ unit: "day" }),
    },
  }
}
