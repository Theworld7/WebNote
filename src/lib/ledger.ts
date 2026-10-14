import type { DataColumn, DataRow, DataTable } from "@/types/data-table"
import type { LedgerGroupMode } from "@/types/workspace"
import { DATA_TABLE_VERSION } from "@/types/data-table"
import { cellValue, emptyColumn, emptyRow, groupRows } from "@/lib/data-table"

/**
 * 账目块的财务口径 —— 求和、余额、金额格式化、分组小计。
 *
 * 视图(`LedgerBlockView`)与导出快照(`serialize.ts` 的 `ledgerHtml`)共同消费这一份:
 * 「编辑器里算出多少,双击打开就是多少」由单一真源保证,不靠两处各写一套公式对齐。
 *
 * 金额只是数字列上的值(不新增列类型):格式化是账目视图的事,`.tbl` 里存纯数字,
 * 与 Excel 等外部工具互换无损。收入 / 支出列不限定类型 —— 非数字值在求和里按空处理,
 * 与「指向的列被删后退化为未设置」同一立场,渲染时自愈。
 */

/** 金额配色(收入红 / 支出绿,涨红跌绿口径)。导出 CSS(`typography.ts`)从这里插值,两处不漂移。 */
export const LEDGER_INCOME_COLOR = "#a32d2d"
export const LEDGER_EXPENSE_COLOR = "#3b6d11"

/** 一组求和结果:`net = income − expense`。 */
export interface LedgerTotals {
  income: number
  expense: number
  net: number
}

/**
 * 新建账目表的预置内容:`日期 / 摘要 / 收入 / 支出` 四列 + 一空行,附上收入 / 支出
 * 两列的 id —— 插入账目块时按它把块指好,三种记账场景开箱即录。预置列是**普通列**
 * (date / text / number),不引入新的列类型;用户后续改名、加列都不受影响。
 */
export function createLedgerPreset(): { table: DataTable; incomeColumnId: string; expenseColumnId: string } {
  const date = emptyColumn("日期", "date")
  const summary = emptyColumn("摘要")
  const income = emptyColumn("收入", "number")
  const expense = emptyColumn("支出", "number")
  const columns = [date, summary, income, expense]
  return { table: { version: DATA_TABLE_VERSION, columns, rows: [emptyRow(columns)] }, incomeColumnId: income.id, expenseColumnId: expense.id }
}

/** 某一列在某行上的数值。非数字(null / 文本)按 0 求和,但返回 null 让展示层区分「空格」。 */
function numberAt(row: DataRow, column: DataColumn | null): number | null {
  if (column === null) return null
  const value = cellValue(row, column)
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function sumOf(rows: readonly DataRow[], column: DataColumn | null): number {
  let total = 0
  for (const row of rows) {
    const value = numberAt(row, column)
    if (value !== null) total += value
  }
  return total
}

/** 一段行的合计。至少设置收入 / 支出列之一才有意义;都为空时 income / expense 恒 0。 */
export function sumRows(rows: readonly DataRow[], income: DataColumn | null, expense: DataColumn | null): LedgerTotals {
  const incomeTotal = income === null ? 0 : sumOf(rows, income)
  const expenseTotal = expense === null ? 0 : sumOf(rows, expense)
  return { income: incomeTotal, expense: expenseTotal, net: incomeTotal - expenseTotal }
}

/**
 * 逐行累计余额:按**行序**(记账发生序)累计 Σ收入 − Σ支出,键是行 id。
 *
 * 分组只是展示顺序,不改变「这笔发生之后账户里剩多少」—— 所以余额永远按原始行序
 * 算,渲染时每行按 id 查自己的那份,分组节里读到的仍是全账口径的余额。
 */
export function balanceMap(rows: readonly DataRow[], income: DataColumn | null, expense: DataColumn | null): Map<string, number> {
  const map = new Map<string, number>()
  let running = 0
  for (const row of rows) {
    const incomeValue = numberAt(row, income)
    const expenseValue = numberAt(row, expense)
    if (incomeValue !== null) running += incomeValue
    if (expenseValue !== null) running -= expenseValue
    map.set(row.id, running)
  }
  return map
}

// ---- 金额格式化 ----

/** 千分位 + 两位小数,负数带 `-`。`-0` 归一成 `0.00`。 */
export function formatAmount(value: number): string {
  const fixed = (Object.is(value, -0) ? 0 : value).toFixed(2)
  const [whole, decimal] = fixed.split(".")
  const sign = whole !== undefined && whole.startsWith("-") ? "-" : ""
  const digits = sign === "-" ? (whole ?? "0").slice(1) : whole ?? "0"
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  return `${sign}${grouped}.${decimal ?? "00"}`
}

/** 合计行的 ¥ 形态:`¥1,234.50` / `−¥1,234.50`(负号在 ¥ 前,财务惯例)。 */
export function formatYuan(value: number): string {
  return `${value < 0 ? "−" : ""}¥${formatAmount(Math.abs(value))}`
}

/** 收入格:正数带 `+`,负数原样(手输负收入照实显示),零与空留白 —— 零行不值得一个 `+0.00`。 */
export function formatIncome(value: number): string {
  if (value === 0) return ""
  return value > 0 ? `+${formatAmount(value)}` : formatAmount(value)
}

/** 支出格:正数带 `−`(减号,不是连字符),负数原样,零留白。 */
export function formatExpense(value: number): string {
  if (value === 0) return ""
  return value > 0 ? `−${formatAmount(value)}` : formatAmount(value)
}

// ---- 分组与小计 ----

/** 一个账目节:分组键、标题、节内行与节小计。`none` 模式整表一节,标题空串。 */
export interface LedgerSection {
  key: string
  title: string
  rows: readonly DataRow[]
  totals: LedgerTotals
}

export interface LedgerSections {
  sections: readonly LedgerSection[]
  /** 落不进任何节的行(无日期 / 分组列空值)。null = 没有这样的行或不分组。 */
  loose: LedgerSection | null
}

/**
 * 把行按账目口径分节并各配小计。
 *
 * - `none`:整表一节,不画标题,只有底部合计。
 * - `month`:按日期列的 `YYYY-MM-DD` 值派生 `YYYY-MM` 节,节序按月升序 —— 流水账
 *   的自然读法,不需要手排。日期缺失或不像日期的行进 `loose`(标题「无日期」)。
 * - `column`:复用 `dt.groupRows`(与看板列 / 画册节同一套归桶),组序跟首现序;
 *   空值行进 `loose`(标题「未分组」)。
 *
 * 指向的列被删后由调用方落成 `mode: "none"` 的等价调用 —— 渲染时自愈,这里不清洗。
 */
export function ledgerSections(
  rows: readonly DataRow[],
  income: DataColumn | null,
  expense: DataColumn | null,
  group: { mode: LedgerGroupMode; column: DataColumn | null },
): LedgerSections {
  const totals = sumRows(rows, income, expense)

  if (group.mode === "none" || group.column === null) {
    return { sections: [{ key: "", title: "", rows, totals }], loose: null }
  }

  const sectionOf = (key: string, title: string, bucket: readonly DataRow[]): LedgerSection => ({
    key,
    title,
    rows: bucket,
    totals: sumRows(bucket, income, expense),
  })

  if (group.mode === "month") {
    const buckets = new Map<string, DataRow[]>()
    const loose: DataRow[] = []
    for (const row of rows) {
      const value = cellValue(row, group.column)
      const month = typeof value === "string" && /^\d{4}-\d{2}/.test(value) ? value.slice(0, 7) : ""
      if (month === "") {
        loose.push(row)
        continue
      }
      const bucket = buckets.get(month)
      if (bucket === undefined) buckets.set(month, [row])
      else bucket.push(row)
    }
    const sections = [...buckets.keys()].sort().map((month) => sectionOf(month, month, buckets.get(month) ?? []))
    return { sections, loose: loose.length > 0 ? sectionOf("__nodate__", "无日期", loose) : null }
  }

  const { groups: bucketed, loose } = groupRows(rows, group.column)
  const sections = bucketed.map((bucket) => sectionOf(bucket.key, bucket.title, bucket.rows))
  return { sections, loose: loose.length > 0 ? sectionOf("__ungrouped__", "未分组", loose) : null }
}
