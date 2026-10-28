import type { ReleaseInfo } from "@/lib/update"
import { readonly, ref } from "vue"
import { openExternalUrl } from "@/lib/open-external"
import { isNewer, parseLatestRelease, parseManifestVersion } from "@/lib/update"

/**
 * 「有没有新版本」这件事的唯一去处：启动时自动查一次（结论只用来决定标题栏画不画那颗
 * 按钮），设置面板里还能手动再查一次（结论要摊成一句话给人看）。
 *
 * 五条边界：
 *
 * 1. **失败就是没有**。离线、被限流（403）、仓库还没有 release（404）、JSON 读不懂 ——
 *    全都只是「没查到」，不弹错也不占位。一个查不到更新的笔记应用不该看起来像坏了。
 * 2. **结果不落盘**。一次启动查一次，缓存反而会让刚装完新版的用户继续看到提示。
 * 3. **连点不重复扣额度**。第一次 200 带回来的 ETag 存住，之后每次请求都带上
 *    `If-None-Match`：GitHub 回 304，而 304 不计入匿名限额。手动那颗按钮因此可以
 *    随便点，最多第一次是真查。
 * 4. **只提示，不代劳**。应用不做增量下载，按钮把用户送到那个 release 的页面，
 *    安装包怎么拿归系统浏览器和用户自己。
 * 5. **主路不通就走镜像**。见 `MIRROR_MANIFEST`。
 */
const REPO = "Theworld7/WebNote"
const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`
/**
 * 主路之外的第二个出处：jsDelivr 直读 main 上的 `package.json`。
 *
 * 为什么非要有它：匿名 API 的 60 次/小时是**按出口 IP** 算的，而国内开加速器时这个
 * 出口往往是许多人共用的中继 —— 实测 `x-ratelimit-remaining: 0`，每次启动都 403。
 * 加速器修的是「连不上」，修不了「被限流」，换节点也一样。这个镜像不限额、带
 * `Access-Control-Allow-Origin: *`，代价是分支引用最长有十几小时缓存，且只给得出
 * 版本号（给不出 release 页），所以它只做兜底、地址退回列表页。
 */
const MIRROR_MANIFEST = `https://cdn.jsdelivr.net/gh/${REPO}@main/package.json`
/** 拿不到单个 release 的地址时的落点。 */
const RELEASES_PAGE = `https://github.com/${REPO}/releases`

/** 一次检查的结论。`newer` 的细节（哪个版本、落到哪）在 `latest` 里。 */
export type UpdateOutcome = "newer" | "current" | "failed"

/** 只有「确实有更新」时非空：界面上不存在「已是最新」这个常驻状态。 */
const latest = ref<ReleaseInfo | null>(null)
/** 最近一次检查的结论。`null` 表示这一次启动还没查过 —— 面板据此什么话都不说。 */
const outcome = ref<UpdateOutcome | null>(null)
const checking = ref(false)

/** 上一次 200 带回来的回执，用来把下一次问成条件请求。 */
let etag: string | null = null
/** 共用中的请求：启动那一次和手动那一次撞上时不重复问。 */
let inFlight: Promise<UpdateOutcome> | null = null
let launched = false

function outcomeOf(): UpdateOutcome {
  return latest.value === null ? "current" : "newer"
}

/**
 * 主路：`releases/latest`。返回 `null` 专指「这条路没给出结论」，该去问镜像了 ——
 * 与 `"failed"` 分开，因为后者是「问过了，两条路都不行」。
 */
async function askApi(): Promise<UpdateOutcome | null> {
  try {
    const headers: Record<string, string> = { Accept: "application/vnd.github+json" }
    if (etag !== null) headers["If-None-Match"] = etag
    const response = await fetch(LATEST_RELEASE_API, { headers })
    // 304：GitHub 说跟上次一模一样，上一次的结论直接沿用。
    if (response.status === 304) return outcomeOf()
    if (!response.ok) return null
    const release = parseLatestRelease(await response.json(), RELEASES_PAGE)
    etag = response.headers.get("ETag")
    latest.value = release !== null && isNewer(release.version, __APP_VERSION__) ? release : null
    return outcomeOf()
  } catch (error: unknown) {
    console.warn("[webnote] 主路（GitHub API）没问成", error)
    return null
  }
}

/**
 * 兜底：镜像上的版本号。
 *
 * 只往「有更新」的方向下结论：镜像最长会滞后十几小时，它说「没有更新的」，可能只是
 * 还没看到；这时不该把主路先前查到的那颗按钮收回去。地址一律退回列表页 —— 这里拼不出
 * 一个确认存在的 release 页，宁可多点一下，也不给一个 404。
 */
async function askMirror(): Promise<UpdateOutcome> {
  try {
    const response = await fetch(MIRROR_MANIFEST, { cache: "no-store" })
    if (!response.ok) return "failed"
    const version = parseManifestVersion(await response.json())
    if (version === null) return "failed"
    if (isNewer(version, __APP_VERSION__)) latest.value = { version, url: RELEASES_PAGE }
    return outcomeOf()
  } catch (error: unknown) {
    console.warn("[webnote] 兜底（镜像）也没问成", error)
    return "failed"
  }
}

async function request(): Promise<UpdateOutcome> {
  const primary = await askApi()
  return primary ?? (await askMirror())
}

function query(): Promise<UpdateOutcome> {
  if (inFlight !== null) return inFlight
  inFlight = (async () => {
    checking.value = true
    try {
      outcome.value = await request()
      return outcome.value
    } finally {
      checking.value = false
      inFlight = null
    }
  })()
  return inFlight
}

/** 启动时那一次：一个进程只问一次，结论只影响标题栏。 */
function checkOnLaunch(): void {
  if (launched) return
  launched = true
  void query()
}

/** 手动检查：每次都真的去问一次（有回执时问成条件请求，见文件头第 3 条）。 */
function checkNow(): Promise<UpdateOutcome> {
  return query()
}

function open(): void {
  void openExternalUrl(latest.value?.url ?? RELEASES_PAGE).catch((error: unknown) => {
    console.warn("[webnote] 打不开新版本的下载页面", error)
  })
}

export function useUpdateCheck() {
  return {
    /** 当前装的是哪一版（package.json 的版本，构建时注入）。 */
    version: __APP_VERSION__,
    latest: readonly(latest),
    outcome: readonly(outcome),
    checking: readonly(checking),
    checkOnLaunch,
    checkNow,
    open,
  }
}
