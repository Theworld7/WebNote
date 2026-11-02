<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from "vue"
import { TooltipProvider } from "@/components/ui/tooltip"
import { provideWorkspace } from "@/composables/useWorkspace"
import { provideTables } from "@/composables/useTables"
import { provideSettings } from "@/composables/useSettings"
import { provideTheme } from "@/composables/useTheme"
import { useUpdateCheck } from "@/composables/useUpdateCheck"
import { useResizableWidth } from "@/composables/useResizableWidth"
import { useSidebarLayout } from "@/composables/useSidebarLayout"
import AppSidebar from "@/components/AppSidebar.vue"
import CloseWindowDialog from "@/components/CloseWindowDialog.vue"
import EditorSurface from "@/components/EditorSurface.vue"
import PaneResizer from "@/components/PaneResizer.vue"
import TitleBar from "@/components/TitleBar.vue"
import ToastStack from "@/components/ToastStack.vue"
import { suppressPageContextMenu } from "@/lib/dom"
import { isTauriRuntime } from "@/lib/fs"

const { hasDirty, bootstrap, fs, root, activePath, attachTableRegistry, attachIntegrateTables, attachAutoSave, save, attachCloseGuard, requestWindowClose, persistSession } =
  provideWorkspace()
// 数据表注册表与工作区**共用同一对 driver / root**：切目录时两者必须一起换语境，
// 各持一份引用迟早对不齐（见 useTables 的注释）。
const tables = provideTables(fs, root)
// 工作区要用注册表做的六件事，一次交齐（见 `TableRegistry` 的注释）：保存笔记时
// 先 preload 再 peek 出快照、flush 改过的表；丢弃标签时 reload；新建 `.tbl` 时 create；
// 标签脏不脏问 dirtyPaths。
// 缺省内容由注册表的知识决定（一张带两列的空表），`initial` 是调用方指定的初始内容
// （账目块的预置四列），没指定才落默认表。
attachTableRegistry({
  preload: (paths) => tables.preload(paths),
  peek: (path) => tables.peek(path),
  flush: (path) => tables.flush(path),
  reload: (path) => tables.reload(path),
  dirtyPaths: () => tables.dirtyPaths(),
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
// 离开即保存：开关同样由设置递进工作区（切标签 / 失焦 / 关窗时写盘）。
attachAutoSave(settings.autoSave)

const { width: sidebarWidth, dragging, startDrag } = useResizableWidth()

/**
 * 侧栏的可见性。宽屏是布局里的一栏（收起偏好落盘），窄屏是一张盖在编辑区上的浮层
 * （默认不出现，不落盘）—— 两套语义都在 `useSidebarLayout` 里，见那边的注释。
 */
const { overlay, open: overlayOpen, hidden: sidebarHidden, toggle: toggleSidebar, close: closeOverlay } = useSidebarLayout()

/**
 * 窄屏挑完一篇笔记就把浮层收起来：手机上点树行的目的就是看正文，不该再多点一下遮罩。
 * 判据是 `activePath` 变了 —— 打开、切换、新建落成标签都会经过它。宽屏下这行只是个空写的
 * 赋值，浮层本来就关着。
 */
watch(activePath, closeOverlay)

/**
 * 新版本检测。挂在根组件而不是那颗按钮里：它是一次启动只发生一次的查网动作，
 * 按钮只负责「有结果就画出来」。查不到就什么都不发生（见 `useUpdateCheck`）。
 */
const { checkOnLaunch } = useUpdateCheck()

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

/**
 * 浏览器端的「要关了」。会话快照在这里定格 —— 桌面端走的是 `confirmWindowClose`
 * 那条路，两边不重叠：那边 Rust 拦在前面，压根走不到这里。Tauri 里 webview 卸载
 * 也会派发一次 `beforeunload`，重写一次同值，无害。
 */
function onBeforeUnload(event: BeforeUnloadEvent) {
  persistSession()
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
  // 浮层开着时 Esc 是关闭它的第一直觉键，先吃掉，不让它冒到别处（比如关菜单）。
  if (event.key === "Escape" && overlayOpen.value) {
    closeOverlay()
    return
  }
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return
  if (event.key.toLowerCase() !== "s") return
  event.preventDefault()
  void save()
}

onMounted(() => {
  window.addEventListener("beforeunload", onBeforeUnload)
  window.addEventListener("keydown", onKeyDown)
  window.addEventListener("contextmenu", suppressPageContextMenu)
  // 工作区要在挂载后再进 —— 它要异步挑运行时驱动（Tauri / 浏览器），还可能去恢复上次的目录。
  void bootstrap()
  // 不去 await：查网慢一点不该拖住首屏，按钮什么时候出来都行。
  checkOnLaunch()

  if (!isTauriRuntime()) return
  void (async () => {
    const { listen } = await import("@tauri-apps/api/event")
    const unlisten = await listen("webnote-close-blocked", () => void requestWindowClose())
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
  window.removeEventListener("contextmenu", suppressPageContextMenu)
})
</script>

<template>
  <TooltipProvider>
    <!-- 窗口无系统装饰，chrome 是自绘的一条 44px 标题栏（品牌 / 全局动作 / 文档信息 /
         窗口按钮，见 ADR-0024）；标签在编辑卡片自己的第一行里（ADR-0033）。chrome 贴着
         窗口上沿，下面的卡片区才留内边距。侧栏的可见性要跨这两块用（chrome 里的按钮改它，
         下面的侧栏读它），所以在根组件取一份（状态本身在 `useSidebarLayout` 里）。 -->
    <div class="flex h-screen flex-col overflow-hidden bg-canvas">
      <TitleBar :sidebar-collapsed="sidebarHidden" @toggle-sidebar="toggleSidebar" />

      <!-- 不给 gap：左右两区之间的间隔只由 PaneResizer 的 w-3 一处承担，
           再叠 gap 会让它变成 12 + 10 + 10 = 32px。折叠侧栏时两者都不渲染，编辑区直接占满。
           窄屏（<900）两栏都不进布局 —— 侧栏改走下面的浮层，编辑区独占整行。 -->
      <div class="flex min-h-0 flex-1 px-2.5 pb-2.5 pt-1">
        <template v-if="!overlay">
          <AppSidebar v-if="!sidebarHidden" :width="sidebarWidth" />
          <PaneResizer v-if="!sidebarHidden" :dragging="dragging" @drag-start="startDrag" />
        </template>
        <EditorSurface />
      </div>
    </div>

    <!-- 窄屏的侧栏浮层：盖在编辑区上，不占布局。顶边让开 44px 的标题栏（+ 卡片区的 4px
         上内边距），那颗折叠按钮才不会被压在底下 —— 开着的时候再按一次就是关掉。
         点遮罩、按 Esc、挑完一篇笔记都会收起；进出各 150ms，减少动效偏好下不播。 -->
    <Transition
      enter-active-class="transition-opacity duration-150 motion-reduce:transition-none"
      enter-from-class="opacity-0"
      leave-active-class="transition-opacity duration-100 motion-reduce:transition-none"
      leave-to-class="opacity-0"
    >
      <div
        v-if="overlay && overlayOpen"
        class="reduce-transparency:bg-black/45 supports-backdrop-filter:backdrop-blur-xs reduce-transparency:backdrop-blur-none fixed inset-x-0 top-12 bottom-0 z-40 bg-black/25"
        @click="closeOverlay"
      />
    </Transition>
    <Transition
      enter-active-class="transition duration-150 ease-out motion-reduce:transition-none"
      enter-from-class="-translate-x-3 opacity-0"
      leave-active-class="transition duration-100 ease-in motion-reduce:transition-none"
      leave-to-class="-translate-x-3 opacity-0"
    >
      <div v-if="overlay && overlayOpen" class="fixed top-12 bottom-2.5 left-2.5 z-50 flex">
        <AppSidebar overlay :width="sidebarWidth" />
      </div>
    </Transition>

    <CloseWindowDialog />
    <ToastStack />
  </TooltipProvider>
</template>
