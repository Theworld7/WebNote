<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue"
import { TooltipProvider } from "@/components/ui/tooltip"
import { provideWorkspace } from "@/composables/useWorkspace"
import { useResizableWidth } from "@/composables/useResizableWidth"
import AppSidebar from "@/components/AppSidebar.vue"
import EditorSurface from "@/components/EditorSurface.vue"
import EditorTabBar from "@/components/EditorTabBar.vue"
import PaneResizer from "@/components/PaneResizer.vue"

const { hasDirty, bootstrap } = provideWorkspace()

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
