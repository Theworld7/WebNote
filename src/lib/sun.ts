/**
 * 日出日落（NOAA 近似式）。纯函数：不联网、不读系统时钟、不碰 DOM。
 *
 * 算法与 DuoSwitch 的 `suncalc.rs` 是同一份：天顶角 90.833°（含大气折射与日面半径），
 * 用分数年（gamma）逼近太阳赤纬与均时差。中纬度误差约 ±1 分钟 —— 回答「几点该换
 * 深色」绰绰有余，不值得为它上 VSOP87。
 *
 * 时间口径：传入的是**当地日历日**（年月日），太阳位置按 UTC 算，再把时刻转成本地
 * `Date`。时区偏移与夏令时都交给运行环境，这里不自己算 —— 自己算必然错一档。
 */

/** 含折射与日面半径修正的天顶角（度）。太阳中心低于地平线这么多时算「落」。 */
const ZENITH_DEG = 90.833

/** 极昼 / 极夜。非极区没有这一档。 */
export type PolarKind = "day" | "night"

/** 当地某一天的日出日落。极昼极夜时两个时刻都是 `null`，由 `polar` 说明是哪一种。 */
export interface SunTimes {
  sunrise: Date | null
  sunset: Date | null
  polar: PolarKind | null
}

/** 当地日历日。只带年月日 —— 时刻一律由 `Date` 表达，不在这里重复。 */
export interface CalendarDay {
  year: number
  /** 1..12，跟 `getMonth()` 的 0 起差一位，包一层免得调用方各自 +1。 */
  month: number
  day: number
}

/** `Date` → 它所在的当地日历日。 */
export function dayOf(date: Date): CalendarDay {
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() }
}

/** 当地日历日的 00:00（本地时区）。 */
export function startOfDay(day: CalendarDay): Date {
  return new Date(day.year, day.month - 1, day.day, 0, 0, 0, 0)
}

/**
 * 加减天数。走 `Date` 的日进位而不是自己算每月天数 —— 跨月、跨年、闰年都不必判断。
 * 用中午 12 点做基准：夏令时切换发生在凌晨，锚在正午不会被「02:00 不存在」这种事挪掉一天。
 */
export function addDays(day: CalendarDay, delta: number): CalendarDay {
  const anchor = new Date(day.year, day.month - 1, day.day, 12, 0, 0, 0)
  anchor.setDate(anchor.getDate() + delta)
  return dayOf(anchor)
}

/** 年内第几天（1 起）。按 UTC 算，不受本地时区与夏令时影响。 */
function dayOfYear(day: CalendarDay): number {
  const start = Date.UTC(day.year, 0, 1)
  const current = Date.UTC(day.year, day.month - 1, day.day)
  return Math.round((current - start) / 86_400_000) + 1
}

/**
 * 给定当地日历日与经纬度（东经、北纬为正），返回当日日出与日落。
 *
 * 经纬度非法时返回「什么都没有」而不是抛错：调用方拿到的是偏好值，坏值只该让
 * 调度退化成不切换，不该让界面挂掉。
 */
export function sunTimes(day: CalendarDay, latitude: number, longitude: number): SunTimes {
  const none: SunTimes = { sunrise: null, sunset: null, polar: null }
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90) return none
  if (!Number.isFinite(longitude) || Math.abs(longitude) > 180) return none

  const latRad = (latitude * Math.PI) / 180

  // 分数年：一年按 365 天等分，太阳赤纬与均时差都只跟它有关。
  const gamma = ((2 * Math.PI) / 365) * (dayOfYear(day) - 1)
  const cos = Math.cos
  const sin = Math.sin

  // 均时差（分钟）：真太阳时与平太阳时的差，±16 分钟，忽略它日出时刻会系统性偏。
  const equationOfTime =
    229.18 *
    (0.000075 +
      0.001868 * cos(gamma) -
      0.032077 * sin(gamma) -
      0.014615 * cos(2 * gamma) -
      0.040849 * sin(2 * gamma))

  // 太阳赤纬（弧度）。
  const declination =
    0.006918 -
    0.399912 * cos(gamma) +
    0.070257 * sin(gamma) -
    0.006758 * cos(2 * gamma) +
    0.000907 * sin(2 * gamma) -
    0.002697 * cos(3 * gamma) +
    0.00148 * sin(3 * gamma)

  const denominator = cos(latRad) * cos(declination)
  const cosOmega = (cos((ZENITH_DEG * Math.PI) / 180) - sin(latRad) * sin(declination)) / denominator

  // |cosω| > 1 意味着当天太阳不升或不落。符号说明是哪一种：
  // 小于 -1 是「太阳一直在天上」（极昼），大于 1 是「一直在地平线下」（极夜）。
  // 正南北极（cos(lat) = 0）让这个比值成为 ±Infinity，正好落进这两支 —— 不必单独判。
  if (cosOmega < -1) return { sunrise: null, sunset: null, polar: "day" }
  if (cosOmega > 1) return { sunrise: null, sunset: null, polar: "night" }

  const omegaDeg = (Math.acos(cosOmega) * 180) / Math.PI
  // 太阳正午的 UTC 小时数：经度每 15° 偏一小时，再扣掉均时差。
  const solarNoonUtc = 12 - longitude / 15 - equationOfTime / 60

  const utcMidnight = Date.UTC(day.year, day.month - 1, day.day)
  const atUtcHours = (hours: number): Date => new Date(utcMidnight + Math.round(hours * 3600) * 1000)

  return {
    sunrise: atUtcHours(solarNoonUtc - omegaDeg / 15),
    sunset: atUtcHours(solarNoonUtc + omegaDeg / 15),
    polar: null,
  }
}
