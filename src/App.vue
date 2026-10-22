<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue"
import { TooltipProvider } from "@/components/ui/tooltip"
import { provideWorkspace } from "@/composables/useWorkspace"
import { provideTables } from "@/composables/useTables"
import { provideSettings } from "@/composables/useSettings"
import { provideTheme } from "@/composables/useTheme"
import { useResizableWidth } from "@/composables/useResizableWidth"
import AppSidebar from "@/components/AppSidebar.vue"
import EditorSurface from "@/components/EditorSurface.vue"
import EditorTabBar from "@/components/EditorTabBar.vue"
import PaneResizer from "@/components/PaneResizer.vue"
import TitleBar from "@/components/TitleBar.vue"

const { hasDirty, bootstrap, fs, root, attachTableRegistry, attachIntegrateTables } = provideWorkspace()
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

const { width: sidebarWidth, dragging, startDrag } = useResizableWidth()
const sidebarCollapsed = ref(false)

/**
 * 关窗兜底：只要还有脏标签，就交给浏览器弹系统确认框。
 *
 * 注意这不覆盖 Tauri 的原生关窗 —— WebView 的 beforeunload 不保证能阻断原生窗口关闭，
 * 那边得在 Rust 侧监听 CloseRequested 再 prevent_default。留到下一轮做。
 */
function onBeforeUnload(event: BeforeUnloadEvent) {
  if (!hasDirty.value) return
  event.preventDefault()
  event.returnValue = ""
}

onMounted(() => {
  window.addEventListener("beforeunload", onBeforeUnload)
  // 工作区要在挂载后再进 —— 它要异步挑运行时驱动（Tauri / 浏览器），还可能去恢复上次的目录。
  void bootstrap()
})

onBeforeUnmount(() => window.removeEventListener("beforeunload", onBeforeUnload))
</script>

<template>
  <TooltipProvider>
    <!-- 窗口无系统装饰，标题栏是自绘的第一行：它贴着窗口上沿，下面的浮岛区才留内边距。
         侧栏折叠状态要跨这两块用（标题栏里的按钮改它，下面的侧栏读它），所以留在根组件。 -->
    <div class="flex h-screen flex-col overflow-hidden bg-canvas">
      <TitleBar :sidebar-collapsed="sidebarCollapsed" @toggle-sidebar="sidebarCollapsed = !sidebarCollapsed" />

      <!-- 不给 gap：左右两区之间的间隔只由 PaneResizer 的 w-3 一处承担，
           再叠 gap 会让它变成 12 + 10 + 10 = 32px。折叠侧栏时两者都不渲染，编辑区直接占满。 -->
      <div class="flex min-h-0 flex-1 px-2.5 pb-2.5 pt-1">
        <AppSidebar v-if="!sidebarCollapsed" :width="sidebarWidth" />
        <PaneResizer v-if="!sidebarCollapsed" :dragging="dragging" @drag-start="startDrag" />

        <section class="flex min-w-0 flex-1 flex-col gap-2.5">
          <EditorTabBar />
          <EditorSurface />
        </section>
      </div>
    </div>
  </TooltipProvider>
</template>
