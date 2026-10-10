<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue"
import { TooltipProvider } from "@/components/ui/tooltip"
import { provideWorkspace } from "@/composables/useWorkspace"
import { provideTables } from "@/composables/useTables"
import { provideSettings } from "@/composables/useSettings"
import { useResizableWidth } from "@/composables/useResizableWidth"
import AppSidebar from "@/components/AppSidebar.vue"
import EditorSurface from "@/components/EditorSurface.vue"
import EditorTabBar from "@/components/EditorTabBar.vue"
import PaneResizer from "@/components/PaneResizer.vue"

const { hasDirty, bootstrap, fs, root, attachTableLookup, attachTablePreload, attachTableCreate } =
  provideWorkspace()
// 数据表注册表与工作区**共用同一对 driver / root**：切目录时两者必须一起换语境，
// 各持一份引用迟早对不齐（见 useTables 的注释）。
const tables = provideTables(fs, root)
// 保存笔记时要把引用块写成快照：先把引用到的表读进内存，再同步取值拼 HTML
// （见 attachTableLookup / attachTablePreload 的注释）。
attachTableLookup((path) => tables.peek(path))
attachTablePreload((blocks) => {
  const paths = blocks
    .filter((block) => block.type === "datatable")
    .map((block) => block.path)
    .filter((path) => path !== "")
  return tables.preload(paths)
})
// 新建数据表：写什么内容由注册表这边的知识决定（一张带两列的初始表），
// 工作区只负责把它写到指定路径。见 attachTableCreate 的注释。
attachTableCreate(async (fsDriver, fsRoot, path) => {
  const initial = tables.defaultTable()
  await fsDriver.createNote(fsRoot, path, tables.toJson(initial))
  // 盘上建好了，把内存也填上 —— 否则紧接着打开它还要多读一次盘。
  tables.adopt(path, initial)
})
// 设置与工作区正交：它只装用户偏好，不参与任何笔记读写，所以在根组件独立 provide 一次。
provideSettings()

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
    <div class="flex h-screen overflow-hidden bg-canvas p-2.5">
      <AppSidebar v-if="!sidebarCollapsed" :width="sidebarWidth" />
      <PaneResizer v-if="!sidebarCollapsed" :dragging="dragging" @drag-start="startDrag" />

      <section class="flex min-w-0 flex-1 flex-col gap-2.5">
        <EditorTabBar
          :sidebar-collapsed="sidebarCollapsed"
          @toggle-sidebar="sidebarCollapsed = !sidebarCollapsed"
        />
        <EditorSurface />
      </section>
    </div>
  </TooltipProvider>
</template>
