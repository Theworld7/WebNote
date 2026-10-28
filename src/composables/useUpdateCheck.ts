import type { ReleaseInfo } from "@/lib/update"
import { readonly, ref } from "vue"
import { openExternalUrl } from "@/lib/open-external"
import { isNewer, parseLatestRelease } from "@/lib/update"

/**
 * 「有没有新版本」这件事的唯一去处：启动时自动查一次（结论只用来决定标题栏画不画那颗
 * 按钮），设置面板里还能手动再查一次（结论要摊成一句话给人看）。
 *
 * 四条边界：
 *
 * 1. **失败就是没有**。离线、被限流（403）、仓库还没有 release（404）、JSON 读不懂 ——
 *    全都只是「没查到」，不弹错也不占位。一个查不到更新的笔记应用不该看起来像坏了。
 * 2. **结果不落盘**。一次启动查一次，缓存反而会让刚装完新版的用户继续看到提示。
 * 3. **连点不重复扣额度**。第一次 200 带回来的 ETag 存住，之后每次请求都带上
 *    `If-None-Match`：GitHub 回 304，而 304 不计入匿名限额。手动那颗按钮因此可以
 *    随便点，最多第一次是真查。
 * 4. **只提示，不代劳**。应用不做增量下载，按钮把用户送到那个 release 的页面，
 *    安装包怎么拿归系统浏览器和用户自己。
 */
const REPO = "Theworld7/WebNote"
const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`
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

async function request(): Promise<UpdateOutcome> {
  try {
    const headers: Record<string, string> = { Accept: "application/vnd.github+json" }
    if (etag !== null) headers["If-None-Match"] = etag
    const response = await fetch(LATEST_RELEASE_API, { headers })
    // 304：GitHub 说跟上次一模一样，上一次的结论直接沿用。
    if (response.status === 304) return outcomeOf()
    if (!response.ok) return "failed"
    const release = parseLatestRelease(await response.json(), RELEASES_PAGE)
    etag = response.headers.get("ETag")
    latest.value = release !== null && isNewer(release.version, __APP_VERSION__) ? release : null
    return outcomeOf()
  } catch (error: unknown) {
    console.warn("[webnote] 检查新版本失败", error)
    return "failed"
  }
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
