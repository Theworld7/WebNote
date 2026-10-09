<script setup lang="ts">
import { computed } from "vue"
import { TriangleAlertIcon, XIcon } from "@lucide/vue"
import { useWorkspace } from "@/composables/useWorkspace"
import BlockEditor from "./BlockEditor.vue"
import EditorHome from "./EditorHome.vue"
import EditorStatusBar from "./EditorStatusBar.vue"

const { activeTab, isLoadingDocument, fsError, dismissError } = useWorkspace()

/**
 * 只有真拿到正文才挂 BlockEditor。
 *
 * 载入中也挂的话，会先用空文档渲染一遍再跳成真内容 —— 闪一下，而且拖拽 / 粘贴那套
 * 处理器会挂在一个马上就要被替换的文档上。
 */
const hasDocument = computed(() => activeTab.value !== null && !isLoadingDocument.value)
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-block bg-card shadow-block">
    <!-- 读写错误条。常驻在编辑区顶部而不是只在空态里 —— 保存失败时正开着文档，
         那条错误若不显示出来，用户会以为已经存好了。 -->
    <div
      v-if="fsError !== ''"
      class="flex flex-none items-center gap-2 bg-destructive/8 px-[22px] py-1.5 text-[12px] text-destructive"
    >
      <TriangleAlertIcon class="size-3.5 shrink-0" />
      <span class="min-w-0 flex-1 truncate">{{ fsError }}</span>
      <button
        type="button"
        class="flex size-4 shrink-0 items-center justify-center rounded-[4px] opacity-60 hover:opacity-100"
        aria-label="关闭提示"
        @click="dismissError"
      >
        <XIcon class="size-3.5" />
      </button>
    </div>

    <EditorHome v-if="!hasDocument" />
    <BlockEditor v-else />

    <EditorStatusBar v-if="hasDocument" />
  </div>
</template>
