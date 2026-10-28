<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import { TooltipProvider } from "@/components/ui/tooltip"
import { provideWorkspace } from "@/composables/useWorkspace"
import { provideTables } from "@/composables/useTables"
import { provideSettings } from "@/composables/useSettings"
import { provideTheme } from "@/composables/useTheme"
import { useUpdateCheck } from "@/composables/useUpdateCheck"
import { useResizableWidth } from "@/composables/useResizableWidth"
import AppSidebar from "@/components/AppSidebar.vue"
import CloseWindowDialog from "@/components/CloseWindowDialog.vue"
import EditorSurface from "@/components/EditorSurface.vue"
import PaneResizer from "@/components/PaneResizer.vue"
import TitleBar from "@/components/TitleBar.vue"
import ToastStack from "@/components/ToastStack.vue"
import { isTauriRuntime } from "@/lib/fs"

const { hasDirty, bootstrap, fs, root, attachTableRegistry, attachIntegrateTables, save, attachCloseGuard, requestWindowClose } =
  provideWorkspace()
// 数据表注册表与工作区**共用同一对 driver / root**：切目录时两者必须一起换语境，
// 各持一份引用迟早对不齐（见 useTables 的注释）。
const tables = provideTables(fs, root)
// 工作区要用注册表做的五件事，一次交齐（见 `TableRegistry` 的注释）：保存笔记时
// 先 preload 再 peek 出快照、flush 改过的表；丢弃标签时 reload；新建 `.tbl` 时 create。
// 缺省内容由注册表的知识决定（一张带两列的空表），`initial` 是调用方指定的初始内容
// （账目块的预置四列），没指定才落默认表。
attachTableRegistry({
  preload: (paths) => tables.preload(paths),
  peek: (path) => tables.peek(path),
  flush: (path) => tables.flush(path),
  reload: (path) => tables.reload(path),
  create: async (fsDriver, fsRoot, path, initial) => {
    const start = initial ?? tables.defaultTable()
    await fsDriver.createNote(fsRoot, path, tables.toJson(start))
    // 盘上建好了，把内存也填上 —— 否则紧接着打开它还要多读一次盘。
    tables.adopt(path, start)
  },
})
// 设置与工作区正交：它只装用户偏好，不参与任何笔记读写，所以在根组件独立 provide 一次。
// 接上 driver / root 这对引用后，偏好才多落一份到工作区根的 webnote.json（换目录重读）。
const settings = provideSettings()
settings.attachStore(fs, root)
// 文件树的整合视图是「设置驱动的呈现」：工作区先创建、不认识设置，所以把偏好 ref 递进去。
attachIntegrateTables(settings.integrateTables)
// 配色推导读上面那份偏好，所以在它之后 provide；它顺手把 `.dark` 挂到 <html> 上，
// 之后标签栏那颗按钮与设置面板都从这里取同一份状态。
provideTheme(settings)
// 关窗守卫：桌面端 Rust 层要凭这个开关决定拦不拦关窗，所以脏态一变就同步过去。
attachCloseGuard(hasDirty)

const { width: sidebarWidth, dragging, startDrag } = useResizableWidth()

/**
 * 新版本检测。挂在根组件而不是那颗按钮里：它是一次启动只发生一次的查网动作，
 * 按钮只负责「有结果就画出来」。查不到就什么都不发生（见 `useUpdateCheck`）。
 */
const { check: checkUpdate } = useUpdateCheck()

/**
 * 侧栏折叠，两个来源分开存：
 *
 * - `userCollapsed` 是用户的选择，落 localStorage，跨会话记住；
 * - `autoCollapsed` 只是「窗口现在太窄」的镜像，不落盘 —— 宽回来它自己就解除了，
 *   用户的偏好不该被一次窄窗口改写。
 *
 * 手点按钮时先看 `autoCollapsed`：窄窗口下按它是「临时展开」，只解除自动折叠；
 * 正常宽度下按它才真的写偏好。否则窄窗口里点一下就会被下一次 resize 折回去。
 */
const SIDEBAR_COLLAPSED_KEY = "webnote:sidebar-collapsed"
/** 窄于这个宽度就自动收起侧栏 —— 侧栏加上拖拽条要吃掉 244px，再窄编辑区就只剩一行。 */
const AUTO_COLLAPSE_AT = 900

const userCollapsed = ref(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1")
const autoCollapsed = ref(false)
const collapsed = computed(() => userCollapsed.value || autoCollapsed.value)

/** 只在**跨过**阈值时改状态：每次 resize 都写会把用户刚展开的侧栏又折回去。 */
let wasNarrow = false
function syncAutoCollapse() {
  const narrow = window.innerWidth < AUTO_COLLAPSE_AT
  if (narrow === wasNarrow) return
  wasNarrow = narrow
  autoCollapsed.value = narrow
}

function toggleSidebar() {
  if (autoCollapsed.value) {
    autoCollapsed.value = false
    return
  }
  userCollapsed.value = !userCollapsed.value
  window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, userCollapsed.value ? "1" : "0")
}

/**
 * 关窗兜底，分两条路：
 *
 * - 浏览器（`pnpm dev`）：交给系统的 beforeunload 确认框，那是唯一的出口；
 * - 桌面端：原生关窗由 Rust 侧拦（`CloseGuard`），它发 `webnote-close-blocked`
 *   过来，这里转成应用内的确认框 —— 系统那一套在无装饰窗口里不可靠，也没法做
 *   「全部保存并关闭」。
 */
let unlistenCloseBlocked: (() => void) | null = null
let disposed = false

function onBeforeUnload(event: BeforeUnloadEvent) {
  if (!hasDirty.value) return
  event.preventDefault()
  event.returnValue = ""
}

/**
 * Ctrl/Cmd+S 保存当前标签。
 *
 * 之前保存只有「点标签上那颗图标」一个入口，而那颗图标只在有脏改动时才现身 ——
 * 用户改完一篇笔记，没有任何常规动作可做。这个快捷键是桌面编辑器的肌肉记忆，
 * 所以在根组件挂一次，连输入框里也接管：那时想存的仍是当前笔记，不是浏览器
 * 那张「保存网页」。
 */
function onKeyDown(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return
  if (event.key.toLowerCase() !== "s") return
  event.preventDefault()
  void save()
}

onMounted(() => {
  window.addEventListener("beforeunload", onBeforeUnload)
  window.addEventListener("keydown", onKeyDown)
  window.addEventListener("resize", syncAutoCollapse)
  // 挂载时就量一次：上次关窗时窗口可能是窄的，恢复出来的宽度不一定会派发 resize。
  syncAutoCollapse()
  // 工作区要在挂载后再进 —— 它要异步挑运行时驱动（Tauri / 浏览器），还可能去恢复上次的目录。
  void bootstrap()
  // 不去 await：查网慢一点不该拖住首屏，按钮什么时候出来都行。
  void checkUpdate()

  if (!isTauriRuntime()) return
  void (async () => {
    const { listen } = await import("@tauri-apps/api/event")
    const unlisten = await listen("webnote-close-blocked", () => requestWindowClose())
    // 监听还没装上组件就卸载了（热更新时常见）：立刻退订，否则会往一个死掉的实例里发。
    if (disposed) unlisten()
    else unlistenCloseBlocked = unlisten
  })()
})

onBeforeUnmount(() => {
  disposed = true
  unlistenCloseBlocked?.()
  window.removeEventListener("beforeunload", onBeforeUnload)
  window.removeEventListener("keydown", onKeyDown)
  window.removeEventListener("resize", syncAutoCollapse)
})
</script>

<template>
  <TooltipProvider>
    <!-- 窗口无系统装饰，chrome 是自绘的两行：标题栏 + 标签行（品牌 / 全局动作 / 文档信息 /
         窗口按钮在上，标签在下，见 ADR-0024 与 ADR-0029）：它们贴着窗口上沿，下面的卡片区
         才留内边距。侧栏折叠状态要跨这两块用（chrome 里的按钮改它，下面的侧栏读它），
         所以留在根组件。 -->
    <div class="flex h-screen flex-col overflow-hidden bg-canvas">
      <TitleBar :sidebar-collapsed="collapsed" @toggle-sidebar="toggleSidebar" />

      <!-- 不给 gap：左右两区之间的间隔只由 PaneResizer 的 w-3 一处承担，
           再叠 gap 会让它变成 12 + 10 + 10 = 32px。折叠侧栏时两者都不渲染，编辑区直接占满。 -->
      <div class="flex min-h-0 flex-1 px-2.5 pb-2.5 pt-1">
        <AppSidebar v-if="!collapsed" :width="sidebarWidth" />
        <PaneResizer v-if="!collapsed" :dragging="dragging" @drag-start="startDrag" />
        <EditorSurface />
      </div>
    </div>

    <CloseWindowDialog />
    <ToastStack />
  </TooltipProvider>
</template>
