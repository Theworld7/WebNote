import type { DataCellValue, DataColumn, DataRow, DataTable } from "@/types/data-table"
import type { SubscriptionBlock } from "@/types/workspace"
import { DATA_TABLE_VERSION } from "@/types/data-table"
import { cellValue, createOptionId, emptyColumn, emptyRow, valueText } from "@/lib/data-table"

/**
 * 订阅块的语义层。
 *
 * 一块订阅卡要回答的问题不是「表里有什么列」,而是「这一行的名称、金额、周期、
 * 到期日分别是哪一格」。这层把**列映射**(用户显式指定优先,留空按列名与类型识别)
 * 和**派生值**(状态、剩余天数、月均 / 年均支出)收在一处,视图与导出快照共用,
 * 避免两边各写一套公式。
 *
 * 派生值一律不进 `.tbl`、不进块:它们随「今天」变化,存下来就是第二份会过期的真源。
 */
export const SUBSCRIPTION_ROLES = [
  "name",
  "icon",
  "amount",
  "cycle",
  "autoRenew",
  "trialEnd",
  "start",
  "end",
  "cancelled",
  "paid",
] as const

export type SubscriptionRole = (typeof SUBSCRIPTION_ROLES)[number]

export type SubscriptionRoles = Record<SubscriptionRole, DataColumn | null>

/** 块上存列 id 的字段名。字段映射、序列化、解析共用这一份,避免三处手抄。 */
export type SubscriptionRoleField =
  | "nameColumnId"
  | "iconColumnId"
  | "amountColumnId"
  | "cycleColumnId"
  | "autoRenewColumnId"
  | "trialEndColumnId"
  | "startColumnId"
  | "endColumnId"
  | "cancelledColumnId"
  | "paidColumnId"

export const SUBSCRIPTION_ROLE_FIELDS: Record<SubscriptionRole, SubscriptionRoleField> = {
  name: "nameColumnId",
  icon: "iconColumnId",
  amount: "amountColumnId",
  cycle: "cycleColumnId",
  autoRenew: "autoRenewColumnId",
  trialEnd: "trialEndColumnId",
  start: "startColumnId",
  end: "endColumnId",
  cancelled: "cancelledColumnId",
  paid: "paidColumnId",
}

/** 导出快照上的 `data-*` 属性名。解析按同一张表倒着读回。 */
export const SUBSCRIPTION_ROLE_ATTRS: Record<SubscriptionRole, string> = {
  name: "data-name",
  icon: "data-icon",
  amount: "data-amount",
  cycle: "data-cycle",
  autoRenew: "data-auto-renew",
  trialEnd: "data-trial-end",
  start: "data-start",
  end: "data-end",
  cancelled: "data-cancelled",
  paid: "data-paid",
}

/** 菜单里的角色名。顺序与卡片上的阅读顺序一致。 */
export const SUBSCRIPTION_ROLE_LABELS: Record<SubscriptionRole, string> = {
  name: "名称列",
  icon: "图标列",
  amount: "金额列",
  cycle: "周期列",
  autoRenew: "自动续费列",
  trialEnd: "试用期到期列",
  start: "开始日期列",
  end: "到期日期列",
  cancelled: "已取消列",
  paid: "累计支付列",
}

/**
 * 自动识别时优先认的列名。先按名字、类型两重匹配;都对不上才按类型兜底。
 *
 * 试用期到期**只认名字**,不参与日期列兜底 —— 否则「开始日期」会被当成试用到期,
 * 卡片上凭空多出一段试用期,比不显示更糟。
 */
const PREFERRED_NAMES: Record<SubscriptionRole, readonly string[]> = {
  name: ["名称", "名字", "订阅", "服务", "项目"],
  icon: ["图标", "logo", "封面"],
  amount: ["金额", "价格", "费用", "月费", "年费", "订阅费"],
  cycle: ["周期", "计费周期", "付款周期", "订阅周期"],
  autoRenew: ["自动续费", "自动续订", "自动扣费", "续费"],
  trialEnd: ["试用期到期", "试用到期", "试用期结束", "试用结束", "试用截止"],
  start: ["开始日期", "订阅日期", "起始日期", "开始"],
  end: ["到期日期", "下次到期", "续费日期", "结束日期", "到期", "结束"],
  cancelled: ["已取消", "取消", "已停用", "已停订"],
  paid: ["累计支付", "累计支出", "累计花费", "累计", "总支付"],
}

function normalized(value: string): string {
  return value.trim().toLowerCase()
}

function acceptsType(role: SubscriptionRole, column: DataColumn): boolean {
  switch (role) {
    case "name":
      return column.type === "text"
    case "icon":
      return column.type === "image"
    case "amount":
    case "paid":
      return column.type === "number"
    case "cycle":
      return column.type === "select"
    case "autoRenew":
    case "cancelled":
      return column.type === "checkbox"
    case "trialEnd":
    case "start":
    case "end":
      return column.type === "date"
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
 * 解析出十个语义列。显式设置优先;空串或指向已删列时退回自动识别。
 *
 * 自动识别分三遍:先认名字 + 类型,再按类型兜底 —— 两遍分开是为了让
 * 「自动续费」与「已取消」两个勾选列按名字各归其位,而不是按列序先到先得。
 */
export function subscriptionRoles(columns: readonly DataColumn[], block: SubscriptionBlock): SubscriptionRoles {
  const roles: SubscriptionRoles = {
    name: null,
    icon: null,
    amount: null,
    cycle: null,
    autoRenew: null,
    trialEnd: null,
    start: null,
    end: null,
    cancelled: null,
    paid: null,
  }
  const used = new Set<string>()

  for (const role of SUBSCRIPTION_ROLES) {
    const id = block[SUBSCRIPTION_ROLE_FIELDS[role]]
    if (id === "") continue
    const column = columns.find((item) => item.id === id) ?? null
    roles[role] = column
    if (column !== null) used.add(column.id)
  }

  for (const role of SUBSCRIPTION_ROLES) {
    if (roles[role] !== null) continue
    const names = PREFERRED_NAMES[role]
    roles[role] = claim(
      columns,
      used,
      (column) =>
        acceptsType(role, column) &&
        names.some((name) => normalized(column.name) === name),
    )
  }

  if (roles.name === null) {
    roles.name =
      claim(columns, used, (column) => column.type === "text") ??
      claim(columns, used, (column) => column.type !== "image" && column.type !== "checkbox")
  }
  if (roles.icon === null) roles.icon = claim(columns, used, (column) => column.type === "image")
  if (roles.amount === null) roles.amount = claim(columns, used, (column) => column.type === "number")
  if (roles.cycle === null) roles.cycle = claim(columns, used, (column) => column.type === "select")
  if (roles.autoRenew === null) roles.autoRenew = claim(columns, used, (column) => column.type === "checkbox")
  if (roles.cancelled === null) roles.cancelled = claim(columns, used, (column) => column.type === "checkbox")
  if (roles.start === null) roles.start = claim(columns, used, (column) => column.type === "date")
  if (roles.end === null) roles.end = claim(columns, used, (column) => column.type === "date")
  if (roles.paid === null) roles.paid = claim(columns, used, (column) => column.type === "number")

  return roles
}

// ---- 取值 ----

export function subscriptionFlag(row: DataRow, column: DataColumn | null): boolean {
  return column !== null && cellValue(row, column) === true
}

export function subscriptionNumber(row: DataRow, column: DataColumn | null): number | null {
  if (column === null) return null
  const value = cellValue(row, column)
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

export function subscriptionDate(row: DataRow, column: DataColumn | null): string {
  if (column === null) return ""
  const value = cellValue(row, column)
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ""
}

export function subscriptionText(row: DataRow, column: DataColumn | null): string {
  if (column === null) return ""
  return valueText(cellValue(row, column), column).trim()
}

export function subscriptionName(row: DataRow, roles: SubscriptionRoles): string {
  const name = subscriptionText(row, roles.name)
  return name === "" ? "未命名订阅" : name
}

/** 图片列的值(data URI / URL)。非图片列即便有文本也不当图标用。 */
export function subscriptionIcon(row: DataRow, roles: SubscriptionRoles): string {
  if (roles.icon === null || roles.icon.type !== "image") return ""
  const value = cellValue(row, roles.icon)
  return typeof value === "string" ? value : ""
}

/** 整行都是空值 —— 新建预设表带的空行不该算成「1 项订阅」。 */
export function subscriptionIsEmpty(row: DataRow, roles: SubscriptionRoles): boolean {
  return (
    subscriptionText(row, roles.name) === "" &&
    subscriptionIcon(row, roles) === "" &&
    subscriptionNumber(row, roles.amount) === null &&
    subscriptionText(row, roles.cycle) === "" &&
    subscriptionDate(row, roles.trialEnd) === "" &&
    subscriptionDate(row, roles.start) === "" &&
    subscriptionDate(row, roles.end) === "" &&
    subscriptionNumber(row, roles.paid) === null
  )
}

// ---- 格式化 ----

/** 金额显示:去掉无意义的尾零,千分位分隔。148 → 148,148.5 → 148.5,17.21 → 17.21。 */
export function formatMoney(value: number): string {
  const normalizedValue = Object.is(value, -0) ? 0 : value
  const fixed = Math.abs(normalizedValue).toFixed(2)
  const [rawWhole, rawDecimal] = fixed.split(".")
  const whole = rawWhole ?? "0"
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  const decimal = (rawDecimal ?? "").replace(/0+$/, "")
  const sign = normalizedValue < 0 ? "-" : ""
  return `${sign}${grouped}${decimal === "" ? "" : `.${decimal}`}`
}

export function formatPrice(value: number): string {
  return `¥${formatMoney(value)}`
}

// ---- 会员卡色 ----

/**
 * 会员卡的强调色调色板。
 *
 * 订阅表里没有「品牌色」这一列,卡片又不能都长成同一张灰卡:按行 id 哈希取一支固定
 * 色相,同一项订阅每次打开都是同一张卡,颜色既不进 `.tbl` 也不进笔记。编辑器与导出
 * 快照共用这一个真源,和看板便签色同一条立场。
 */
const SUBSCRIPTION_ACCENTS: readonly string[] = [
  "#c15f86",
  "#7464d8",
  "#c15c50",
  "#3564c8",
  "#2c8a6f",
  "#b85762",
  "#3e82a7",
  "#a46a1c",
]

export function subscriptionCardAccent(id: string): string {
  let hash = 0
  for (let index = 0; index < id.length; index += 1) {
    hash = (Math.imul(hash, 31) + id.charCodeAt(index)) >>> 0
  }
  return SUBSCRIPTION_ACCENTS[hash % SUBSCRIPTION_ACCENTS.length] ?? SUBSCRIPTION_ACCENTS[0]
}

/**
 * 周期折算成月数,用来算月均 / 年均支出。
 *
 * 只认常见写法(月 / 季 / 半年 / 年 / 周),认不出的返回 null —— 视图把它排除在
 * 支出汇总之外,而不是按次数或金额猜 —— 猜出来的月均比不显示更误导。
 */
export function cycleMonths(column: DataColumn | null, value: DataCellValue): number | null {
  if (column === null) return null
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value
  const text = valueText(value, column).trim().toLowerCase()
  if (text === "") return null
  if (text.includes("半年") || text.includes("half")) return 6
  if (text.includes("季") || text.includes("quarter")) return 3
  if (text.includes("年") || text.includes("year") || text.includes("annual")) return 12
  if (text.includes("月") || text.includes("month")) return 1
  if (text.includes("周") || text.includes("week")) return 0.25
  return null
}

export function cycleMonthValue(row: DataRow, roles: SubscriptionRoles): number | null {
  if (roles.cycle === null) return null
  return cycleMonths(roles.cycle, cellValue(row, roles.cycle))
}

// ---- 日期与状态 ----

/** 本机日历日期。状态判定、剩余天数都按用户眼前的「今天」算,不按 UTC。 */
export function localToday(now = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const day = String(now.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function dayNumber(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (match === null) return null
  const year = Number(match[1] ?? 0)
  const month = Number(match[2] ?? 1)
  const day = Number(match[3] ?? 1)
  return Date.UTC(year, month - 1, day)
}

/** `to - from` 的整天数。日期非法返回 null。 */
export function daysBetween(from: string, to: string): number | null {
  const start = dayNumber(from)
  const end = dayNumber(to)
  if (start === null || end === null) return null
  return Math.round((end - start) / 86_400_000)
}

export type SubscriptionState = "active" | "trial" | "soon" | "expired" | "cancelled"

export interface SubscriptionStatus {
  kind: SubscriptionState
  label: string
  /** 距到期 / 试用结束的天数,负数表示已过去。null = 没有可算的日期。 */
  days: number | null
}

/**
 * 一张订阅卡的状态。
 *
 * 优先级:已取消 → 试用中 → 到期 / 即将到期 → 生效中。试用期先于到期,因为参考表里
 * 试用行的「到期日期」是正式到期日,试用结束才是用户当下最需要看到的节点。
 */
export function subscriptionStatus(row: DataRow, roles: SubscriptionRoles, today: string): SubscriptionStatus {
  if (subscriptionFlag(row, roles.cancelled)) return { kind: "cancelled", label: "已取消", days: null }

  const start = subscriptionDate(row, roles.start)
  const end = subscriptionDate(row, roles.end)
  const trialEnd = subscriptionDate(row, roles.trialEnd)
  const trialDays = trialEnd === "" ? null : daysBetween(today, trialEnd)

  if (trialDays !== null && trialDays >= 0 && (start === "" || start <= today)) {
    return { kind: "trial", label: "试用中", days: trialDays }
  }

  if (end === "") return { kind: "active", label: "生效中", days: null }

  const days = daysBetween(today, end)
  if (days === null) return { kind: "active", label: "生效中", days: null }
  // 自动续费开着却已过到期日:多半是在等扣款,「待续费」比「已到期」更接近事实。
  if (days < 0) {
    return subscriptionFlag(row, roles.autoRenew)
      ? { kind: "expired", label: "待续费", days }
      : { kind: "expired", label: "已到期", days }
  }
  if (days <= 7) return { kind: "soon", label: "即将到期", days }
  return { kind: "active", label: "生效中", days }
}

/** 当前订阅周期已走过的比例(0..1)。起止日期缺一或顺序不对时返回 null。 */
export function cycleProgress(start: string, end: string, today: string): number | null {
  const total = daysBetween(start, end)
  const elapsed = daysBetween(start, today)
  if (total === null || elapsed === null || total <= 0) return null
  return Math.min(1, Math.max(0, elapsed / total))
}

export interface SubscriptionSummary {
  total: number
  /** 在订:未勾「已取消」且未过到期日。 */
  live: number
  cancelled: number
  /** 在订订阅按周期折算的月支出。 */
  monthly: number
  /** 在订订阅按周期折算的年支出。 */
  yearly: number
  /** 在订但周期认不出的行数 —— 它们没进月 / 年汇总。 */
  unknownCycle: number
  /** 最近一次到期:日期与名称。空串 = 没有可预告的到期日。 */
  nextEnd: string
  nextName: string
}

export function summarizeSubscriptions(
  rows: readonly DataRow[],
  roles: SubscriptionRoles,
  today: string,
): SubscriptionSummary {
  let total = 0
  let live = 0
  let cancelled = 0
  let monthly = 0
  let yearly = 0
  let unknownCycle = 0
  let nextEnd = ""
  let nextName = ""

  for (const row of rows) {
    if (subscriptionIsEmpty(row, roles)) continue
    total += 1
    if (subscriptionFlag(row, roles.cancelled)) {
      cancelled += 1
      continue
    }
    const end = subscriptionDate(row, roles.end)
    const trialEnd = subscriptionDate(row, roles.trialEnd)

    // 试用到期与正式到期都可能成为「下一个节点」;先找出最晚的一个判断是否已失效,
    // 再取还在未来的最早一个当「最近到期」。
    let latest = ""
    let upcoming = ""
    for (const date of [trialEnd, end]) {
      if (date === "") continue
      if (latest === "" || date > latest) latest = date
      if (date >= today && (upcoming === "" || date < upcoming)) upcoming = date
    }
    // 所有到期日都过去了、又没勾「已取消」的行不再产生支出 —— 多半是忘了续费或忘了标记。
    if (latest !== "" && latest < today) continue

    live += 1
    if (upcoming !== "" && (nextEnd === "" || upcoming < nextEnd)) {
      nextEnd = upcoming
      nextName = subscriptionName(row, roles)
    }

    const amount = subscriptionNumber(row, roles.amount)
    if (amount === null) continue
    const months = cycleMonthValue(row, roles)
    if (months === null || months <= 0) {
      unknownCycle += 1
      continue
    }
    monthly += amount / months
    yearly += (amount / months) * 12
  }

  return { total, live, cancelled, monthly, yearly, unknownCycle, nextEnd, nextName }
}

/** 展示序:取消的沉底,其余按到期日由近到远 —— 先看到该续费的。 */
export function sortSubscriptions(rows: readonly DataRow[], roles: SubscriptionRoles): DataRow[] {
  return [...rows].sort((left, right) => {
    const leftCancelled = subscriptionFlag(left, roles.cancelled)
    const rightCancelled = subscriptionFlag(right, roles.cancelled)
    if (leftCancelled !== rightCancelled) return leftCancelled ? 1 : -1

    const leftEnd = subscriptionDate(left, roles.end)
    const rightEnd = subscriptionDate(right, roles.end)
    if (leftEnd === rightEnd) return 0
    if (leftEnd === "") return 1
    if (rightEnd === "") return -1
    return leftEnd.localeCompare(rightEnd)
  })
}

// ---- 预设表 ----

export interface SubscriptionPreset {
  table: DataTable
  /** 角色 → 列 id。新块据此把字段映射写死,列名再改也不影响。 */
  roles: Record<SubscriptionRole, string>
}

/**
 * 参考表的结构:名称 / 图标 / 金额 / 周期 / 自动续费 / 试用期到期 / 开始 / 到期 /
 * 已取消 / 累计支付。新建订阅块时直接给这一张,插入即可用;已有表则走自动识别。
 */
export function createSubscriptionPreset(): SubscriptionPreset {
  const name = emptyColumn("名称", "text")
  const icon = emptyColumn("图标", "image")
  const amount = emptyColumn("金额", "number")
  const cycle = emptyColumn("周期", "select")
  cycle.options.push(
    { id: createOptionId(), name: "月付" },
    { id: createOptionId(), name: "季付" },
    { id: createOptionId(), name: "年付" },
  )
  const autoRenew = emptyColumn("自动续费", "checkbox")
  const trialEnd = emptyColumn("试用期到期", "date")
  const start = emptyColumn("开始日期", "date")
  const end = emptyColumn("到期日期", "date")
  const cancelled = emptyColumn("已取消", "checkbox")
  const paid = emptyColumn("累计支付", "number")
  const columns = [name, icon, amount, cycle, autoRenew, trialEnd, start, end, cancelled, paid]

  return {
    table: { version: DATA_TABLE_VERSION, columns, rows: [emptyRow(columns)] },
    roles: {
      name: name.id,
      icon: icon.id,
      amount: amount.id,
      cycle: cycle.id,
      autoRenew: autoRenew.id,
      trialEnd: trialEnd.id,
      start: start.id,
      end: end.id,
      cancelled: cancelled.id,
      paid: paid.id,
    },
  }
}
