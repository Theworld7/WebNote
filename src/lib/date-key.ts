/**
 * `YYYY-MM-DD` 日期键的算术。
 *
 * 表里 date 列的值、月历的格子键、键盘高亮停在哪一天 —— 都是同一个字符串，
 * 所以「往后挪三天」这类算术也只能有一份：月历画格子要它，键盘导航要它，
 * 两处各写一遍日期算术迟早会在跨月 / 月末夹取上分叉。
 *
 * 一律用本地时间的 `Date` 构造年 / 月 / 日，不经 `Date.parse`：那个对
 * `2026-09-15` 按 UTC 解读，东八区下会把日期读回前一天。
 */

function pad2(value: number): string {
  return String(value).padStart(2, "0")
}

/** `Date` → 日期键。 */
export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/** 严格按 `YYYY-MM-DD` 读 —— 与 `dt.parseCellInput` 的 date 口径一致，别的形状当没有。 */
export function parseDateKey(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (match === null) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  if (Number.isNaN(date.getTime())) return null
  // 2 月 31 日这种会被 Date 顺延成 3 月，回读一次确认不是编出来的日期。
  return dateKey(date) === value ? date : null
}

export function todayKey(): string {
  return dateKey(new Date())
}

/** 周一 = 0、周日 = 6 —— 月历是周一起头的，键盘的 Home / End 也按这个口径跳到本周首尾。 */
function weekdayIndex(key: string): number {
  const date = parseDateKey(key)
  if (date === null) return 0
  return (date.getDay() + 6) % 7
}

/** 前后挪几天。跨月跨年交给 `Date` 自己进位。 */
export function shiftDays(key: string, days: number): string {
  const date = parseDateKey(key) ?? new Date()
  return dateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days))
}

/**
 * 前后挪几个月，日子夹到目标月的最后一天（1 月 31 日往后一月是 2 月 28/29 日，
 * 不是被 `Date` 顺延成 3 月 3 日）。
 */
export function shiftMonths(key: string, months: number): string {
  const date = parseDateKey(key) ?? new Date()
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1)
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  return dateKey(new Date(target.getFullYear(), target.getMonth(), Math.min(date.getDate(), lastDay)))
}

/** 本周的周一 / 周日（`Home` / `End` 两个键的落点）。 */
export function weekStart(key: string): string {
  return shiftDays(key, -weekdayIndex(key))
}

export function weekEnd(key: string): string {
  return shiftDays(key, 6 - weekdayIndex(key))
}
