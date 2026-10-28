/**
 * 版本号比较与两个来源的解析。
 *
 * 这里是**外部数据进来的唯一一道门**：GitHub 的 release JSON、镜像上的 `package.json`
 * 都在这里被解析成应用内认识的那个形状，出去之后所有代码只信它，不再二次判断字段类型。
 *
 * 版本号只认三段数字，允许一个前导 `v`。预发布（`v0.9.0-beta.1`）和任何别的写法都
 * 按「看不懂」返回 `null` —— 看不懂就不提示。宁可漏报一次，也不要把一个预发布版
 * 当成新版本推给用户。
 */

export interface ReleaseInfo {
  /** 去掉前导 `v` 的版本号，直接拿去显示。 */
  version: string
  /** 点按钮落到的页面：那个 release 自己的页；拿不到就退回 releases 列表。 */
  url: string
}

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)$/

/** `0.8.2` / `v0.8.2` → `[0, 8, 2]`；别的形状一律 `null`。 */
export function parseVersion(raw: string): readonly [number, number, number] | null {
  const match = VERSION_RE.exec(raw.trim())
  if (match === null) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** `candidate` 比 `current` 新才为真。任何一边读不懂都不算「有更新」。 */
export function isNewer(candidate: string, current: string): boolean {
  const next = parseVersion(candidate)
  const now = parseVersion(current)
  if (next === null || now === null) return false
  for (let index = 0; index < 3; index += 1) {
    if (next[index] !== now[index]) return next[index] > now[index]
  }
  return false
}

/**
 * `GET /releases/latest` 的响应体 → `ReleaseInfo`。
 *
 * 缺 `tag_name`、`tag_name` 读不懂、或者这次发布是草稿 / 预发布，都返回 `null`：
 * 界面上「有更新」只有一种表示，不该有「有个东西不太像版本号」这一档。
 */
export function parseLatestRelease(payload: unknown, fallbackUrl: string): ReleaseInfo | null {
  if (typeof payload !== "object" || payload === null) return null
  if (Reflect.get(payload, "draft") === true || Reflect.get(payload, "prerelease") === true) return null
  const tag = Reflect.get(payload, "tag_name")
  if (typeof tag !== "string" || parseVersion(tag) === null) return null
  const page = Reflect.get(payload, "html_url")
  const url = typeof page === "string" && page !== "" ? page : fallbackUrl
  return { version: tag.trim().replace(/^v/, ""), url }
}

/**
 * 镜像上的 `package.json` → 版本号。
 *
 * 这条路的出处不同（jsDelivr 上的 main 分支），能拿到的也只有版本号：没有 release 页、
 * 没有草稿与预发布的标记。所以调用方只该拿它回答「有没有更新的版本」，地址仍用列表页。
 * `version` 字段不存在或读不懂一律 `null`。
 */
export function parseManifestVersion(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null
  const version = Reflect.get(payload, "version")
  if (typeof version !== "string" || parseVersion(version) === null) return null
  return version.trim().replace(/^v/, "")
}
