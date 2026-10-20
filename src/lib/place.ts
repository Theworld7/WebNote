import type { ThemeSettings } from "@/types/workspace"

/**
 * 时区 → 地点。日出日落调度要知道你在哪儿，而这台机器离线、也不该为了一个坐标去弹
 * 定位授权，所以答案来自系统时区：`Intl` 报哪个区，就取那个区的代表城市坐标。
 *
 * 表的粒度是「时区」不是「城市」：同一个时区里选哪座城市，日出日落差几分钟，对
 * 「什么时候换深色」没有意义。用户真在意精度，设置面板里可以把经纬度改成自己的。
 */

/** 一个地点：名字给人看，坐标给太阳位置算。 */
export interface Place {
  latitude: number
  longitude: number
  /** IANA 时区名，界面用来交代「这个坐标是怎么来的」。 */
  zone: string
  /** 城市名，中文。 */
  label: string
}

interface ZonePlace {
  label: string
  latitude: number
  longitude: number
}

/**
 * 代表城市坐标（保留四位小数，够到 ~10 米，远超需求）。按 IANA 名索引。
 *
 * 收的是常见时区，不求穷尽：命不中的落在下面那条「按 UTC 偏移推经度」的兜底上。
 * 中国境内三个法定时区名都收，否则 `Asia/Urumqi` 会被兜底推成东经 90° 之外的高度。
 */
const ZONE_PLACES: Readonly<Record<string, ZonePlace>> = {
  "Asia/Shanghai": { label: "北京", latitude: 39.9042, longitude: 116.4074 },
  "Asia/Chongqing": { label: "重庆", latitude: 29.5630, longitude: 106.5516 },
  "Asia/Harbin": { label: "哈尔滨", latitude: 45.8038, longitude: 126.5350 },
  "Asia/Urumqi": { label: "乌鲁木齐", latitude: 43.8256, longitude: 87.6168 },
  "Asia/Hong_Kong": { label: "中国香港", latitude: 22.3193, longitude: 114.1694 },
  "Asia/Macau": { label: "中国澳门", latitude: 22.1987, longitude: 113.5439 },
  "Asia/Taipei": { label: "中国台北", latitude: 25.0330, longitude: 121.5654 },
  "Asia/Tokyo": { label: "东京", latitude: 35.6762, longitude: 139.6503 },
  "Asia/Seoul": { label: "首尔", latitude: 37.5665, longitude: 126.9780 },
  "Asia/Singapore": { label: "新加坡", latitude: 1.3521, longitude: 103.8198 },
  "Asia/Bangkok": { label: "曼谷", latitude: 13.7563, longitude: 100.5018 },
  "Asia/Jakarta": { label: "雅加达", latitude: -6.2088, longitude: 106.8456 },
  "Asia/Manila": { label: "马尼拉", latitude: 14.5995, longitude: 120.9842 },
  "Asia/Kolkata": { label: "加尔各答", latitude: 22.5726, longitude: 88.3639 },
  "Asia/Karachi": { label: "卡拉奇", latitude: 24.8607, longitude: 67.0011 },
  "Asia/Dubai": { label: "迪拜", latitude: 25.2048, longitude: 55.2708 },
  "Europe/Istanbul": { label: "伊斯坦布尔", latitude: 41.0082, longitude: 28.9784 },
  "Europe/Moscow": { label: "莫斯科", latitude: 55.7558, longitude: 37.6173 },
  "Europe/London": { label: "伦敦", latitude: 51.5074, longitude: -0.1278 },
  "Europe/Paris": { label: "巴黎", latitude: 48.8566, longitude: 2.3522 },
  "Europe/Berlin": { label: "柏林", latitude: 52.5200, longitude: 13.4050 },
  "Europe/Madrid": { label: "马德里", latitude: 40.4168, longitude: -3.7038 },
  "Europe/Rome": { label: "罗马", latitude: 41.9028, longitude: 12.4964 },
  "Africa/Cairo": { label: "开罗", latitude: 30.0444, longitude: 31.2357 },
  "Africa/Lagos": { label: "拉各斯", latitude: 6.5244, longitude: 3.3792 },
  "Africa/Johannesburg": { label: "约翰内斯堡", latitude: -26.2041, longitude: 28.0473 },
  "America/New_York": { label: "纽约", latitude: 40.7128, longitude: -74.0060 },
  "America/Toronto": { label: "多伦多", latitude: 43.6532, longitude: -79.3832 },
  "America/Chicago": { label: "芝加哥", latitude: 41.8781, longitude: -87.6298 },
  "America/Denver": { label: "丹佛", latitude: 39.7392, longitude: -104.9903 },
  "America/Los_Angeles": { label: "洛杉矶", latitude: 34.0522, longitude: -118.2437 },
  "America/Vancouver": { label: "温哥华", latitude: 49.2827, longitude: -123.1207 },
  "America/Mexico_City": { label: "墨西哥城", latitude: 19.4326, longitude: -99.1332 },
  "America/Sao_Paulo": { label: "圣保罗", latitude: -23.5505, longitude: -46.6333 },
  "Australia/Perth": { label: "珀斯", latitude: -31.9523, longitude: 115.8613 },
  "Australia/Sydney": { label: "悉尼", latitude: -33.8688, longitude: 151.2093 },
  "Australia/Melbourne": { label: "墨尔本", latitude: -37.8136, longitude: 144.9631 },
  "Pacific/Auckland": { label: "奥克兰", latitude: -36.8485, longitude: 174.7633 },
  "UTC": { label: "格林尼治", latitude: 51.4779, longitude: -0.0015 },
}

/**
 * 系统时区对应的地点。
 *
 * 命中表就用表；没命中就按 UTC 偏移推经度（每 15° 一小时，偏移已含夏令时），
 * 纬度取赤道 —— 赤道上全年昼长约 12 小时，猜错的代价只是「切换时刻不随季节漂」，
 * 而不是漂到离谱的时刻。界面会把这种兜底如实标出来，用户可以去改坐标。
 */
export function systemPlace(): Place {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const known = ZONE_PLACES[zone]
  if (known !== undefined) return { ...known, zone }

  // getTimezoneOffset 是「本地比 UTC 慢多少分钟」，东区为负，符号反过来才是经度。
  const offsetMinutes = -new Date().getTimezoneOffset()
  return {
    latitude: 0,
    longitude: Math.max(-180, Math.min(180, offsetMinutes / 4)),
    zone: zone === "" ? "UTC" : zone,
    label: "系统时区（未收录）",
  }
}

/** 偏好里同时填了经纬度就算手动指定，否则退回系统时区。 */
export function resolvePlace(theme: ThemeSettings): Place {
  const fallback = systemPlace()
  if (theme.latitude === null || theme.longitude === null) return fallback
  // 时区名留着：设置面板要能同时交代「现在是自定义坐标」和「这台机器在哪个区」。
  return { latitude: theme.latitude, longitude: theme.longitude, zone: fallback.zone, label: "自定义" }
}
