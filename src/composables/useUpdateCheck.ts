import type { ReleaseInfo } from "@/lib/update"
import { readonly, ref } from "vue"
import { openExternalUrl } from "@/lib/open-external"
import { isNewer, parseLatestRelease } from "@/lib/update"

/**
 * 「有新版本」的检测：启动时问一次 GitHub 的 `releases/latest`，比当前版本新就把
 * 那条 release 记下来，chrome 上据此长出一颗按钮。
 *
 * 三条边界：
 *
 * 1. **失败就是没有**。离线、被限流（403）、仓库还没有 release（404）、JSON 读不懂 ——
 *    全都只是「没检测到」，不弹错也不占位。一个查不到更新的笔记应用不该看起来像坏了。
 * 2. **结果不落盘**。一次启动问一次，缓存反而会让刚装完新版的用户继续看到提示。
 * 3. **只提示，不代劳**。应用不做增量下载，按钮把用户送到那个 release 的页面，
 *    安装包怎么拿归系统浏览器和用户自己。
 */
const REPO = "Theworld7/WebNote"
const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`
/** 拿不到单个 release 的地址时的落点。 */
const RELEASES_PAGE = `https://github.com/${REPO}/releases`

/** 只有「确实有更新」时非空：界面上不存在「已是最新」这个常驻状态。 */
const latest = ref<ReleaseInfo | null>(null)
let started = false

async function check(): Promise<void> {
  if (started) return
  started = true
  try {
    const response = await fetch(LATEST_RELEASE_API, {
      headers: { Accept: "application/vnd.github+json" },
    })
    if (!response.ok) return
    const release = parseLatestRelease(await response.json(), RELEASES_PAGE)
    if (release !== null && isNewer(release.version, __APP_VERSION__)) latest.value = release
  } catch (error: unknown) {
    console.warn("[webnote] 检查新版本失败", error)
  }
}

function open(): void {
  void openExternalUrl(latest.value?.url ?? RELEASES_PAGE).catch((error: unknown) => {
    console.warn("[webnote] 打不开新版本的下载页面", error)
  })
}

export function useUpdateCheck() {
  return { latest: readonly(latest), check, open }
}
