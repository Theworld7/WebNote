import type { Theme, ThemeMode, ThemeSettings } from "@/types/workspace"
import type { Place } from "./place"
import type { CalendarDay } from "./sun"
import { addDays, dayOf, startOfDay, sunTimes } from "./sun"

/**
 * 「现在该是什么配色」的推导。全是纯函数：给一个时刻，算出答案，不订阅时钟、不碰 DOM。
 *
 * 立场来自 DuoSwitch 的调度器：**不做「到点执行」的定时器，而是每次问一句
 * 「以此刻反推，我该是什么样」**。休眠唤醒、系统时间被改、时钟漂移都不需要额外处理，
 * 醒来后第一次问就自然纠正过来；定时器那套一旦错过一秒就永久错位。
 *
 * 第二个立场：自动模式下**每个时段槽只断言一次**。用户在槽内手动改了主题，就认他这个
 * 选择，不再夺回（`ManualOverride` 记下改动发生在哪个槽）。下一个槽（次日日出 / 下一次
 * 日落 / 系统外观翻转）到来，覆盖自动作废。
 */

/** 一次配色跳变：某个时刻起应当是什么主题。`at` 同时是这个时段槽的身份证。 */
export interface Transition {
  at: number
  theme: Theme
}

/** 手动覆盖：改成的主题，以及改的时候处在哪个时段槽。槽一变它就过期。 */
export interface ManualOverride {
  theme: Theme
  slot: string
}

/** 全部主题模式。读取偏好时按这张表收窄，未知值退回默认。 */
export const THEME_MODES: readonly ThemeMode[] = ["light", "dark", "system", "fixed", "sun"]

/** `"HH:mm"` —— `<input type="time">` 的原生格式，也是配置文件里存的样子。 */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

/** `"HH:mm"` → 当日分钟数；格式不对返回 `null`（调度跳过这条规则，不猜）。 */
export function minutesOf(time: string): number | null {
  if (!TIME_PATTERN.test(time)) return null
  const [hours, minutes] = time.split(":")
  return Number(hours) * 60 + Number(minutes)
}

/**
 * 某一天的全部跳变点，按时刻升序。
 *
 * 手动模式与 `system` 不产生跳变 —— 它们的答案不来自日历，调用方（`displayFor`）
 * 自己分派，这里只管两种「看时刻」的模式。
 */
export function transitionsOn(settings: ThemeSettings, place: Place, day: CalendarDay): Transition[] {
  if (settings.mode !== "fixed" && settings.mode !== "sun") return []

  const midnight = startOfDay(day).getTime()
  const out: Transition[] = []

  if (settings.mode === "fixed") {
    const rules: { time: string; theme: Theme }[] = [
      { time: settings.lightAt, theme: "light" },
      { time: settings.darkAt, theme: "dark" },
    ]
    for (const rule of rules) {
      const minutes = minutesOf(rule.time)
      if (minutes === null) continue
      out.push({ at: midnight + minutes * 60_000, theme: rule.theme })
    }
  } else {
    const times = sunTimes(day, place.latitude, place.longitude)
    // 极昼 / 极夜：一整天不跳变，零点给一个恒定答案 —— 否则「今天没有跳变」会让
    // 回溯逻辑去翻好几天前的旧槽，那才是真正的错。
    if (times.polar === "day") return [{ at: midnight, theme: "light" }]
    if (times.polar === "night") return [{ at: midnight, theme: "dark" }]
    if (times.sunrise !== null) out.push({ at: times.sunrise.getTime(), theme: "light" })
    if (times.sunset !== null) out.push({ at: times.sunset.getTime(), theme: "dark" })
  }

  return out.sort((left, right) => left.at - right.at)
}

/** 回溯的最远天数。周末 / 极地那种「某天没有跳变」的情形，靠它沿用上一个有效槽。 */
const LOOKBACK_DAYS = 8

/** 此刻生效的那个时段槽：最近一个不晚于现在的跳变点。 */
export function scheduledAt(settings: ThemeSettings, place: Place, now: Date): Transition | null {
  const today = dayOf(now)
  const stamp = now.getTime()
  for (let back = 0; back <= LOOKBACK_DAYS; back += 1) {
    const transitions = transitionsOn(settings, place, addDays(today, -back))
    for (let index = transitions.length - 1; index >= 0; index -= 1) {
      const candidate = transitions[index]
      if (candidate.at <= stamp) return candidate
    }
  }
  return null
}

/** 下一个跳变点。界面用来说「什么时候会自动换回来」。 */
export function nextTransition(settings: ThemeSettings, place: Place, now: Date): Transition | null {
  if (settings.mode !== "fixed" && settings.mode !== "sun") return null
  const today = dayOf(now)
  const stamp = now.getTime()
  for (let ahead = 0; ahead <= LOOKBACK_DAYS; ahead += 1) {
    const candidate = transitionsOn(settings, place, addDays(today, ahead)).find((item) => item.at > stamp)
    if (candidate !== undefined) return candidate
  }
  return null
}

/**
 * 当前该显示什么，顺带给出它属于哪个时段槽。
 *
 * `slot` 是手动覆盖的失效依据：它是这个槽的稳定身份，槽一变（时刻不同、系统外观翻转、
 * 模式改动）就换一个值，于是旧的覆盖自然过期，不需要另设清理逻辑。
 */
export interface Display {
  theme: Theme
  slot: string
}

export function displayFor(
  settings: ThemeSettings,
  place: Place,
  now: Date,
  system: Theme,
): Display {
  if (settings.mode === "light") return { theme: "light", slot: "manual:light" }
  if (settings.mode === "dark") return { theme: "dark", slot: "manual:dark" }
  // 跟随系统：槽就是系统外观本身 —— 系统翻一次，用户的手动覆盖也就该让位。
  if (settings.mode === "system") return { theme: system, slot: `system:${system}` }

  const slot = scheduledAt(settings, place, now)
  if (slot === null) return { theme: "light", slot: "empty" }
  return { theme: slot.theme, slot: `at:${slot.at}` }
}

/** 把手动覆盖叠在推导结果上。覆盖只在自己那个槽里有效。 */
export function applyOverride(display: Display, override: ManualOverride | null): Theme {
  if (override === null || override.slot !== display.slot) return display.theme
  return override.theme
}
