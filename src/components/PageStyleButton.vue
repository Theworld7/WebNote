<script setup lang="ts">
import { ref } from "vue"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useWorkspace } from "@/composables/useWorkspace"
import HtmlSourceDrawer from "./HtmlSourceDrawer.vue"

/**
 * 页面级样式的入口 + 它那个抽屉。
 *
 * 抽成一个组件是因为**入口搬家了而抽屉没搬**：按钮住在窗口 chrome 里（ADR-0024），
 * 抽屉仍 Teleport 进笔记编辑区（`data-editor-surface`）—— 它是编辑区的一半宽，
 * 不是窗口的一半。两处各写一份「按钮 + 抽屉 + 提交收口」很容易漏掉「提交后关抽屉」
 * 或者「小圆点跟着有没有样式变色」这类细节，所以只留一处。
 *
 * 自检页（`design/page-style-check.html`）挂的也是这个组件 —— 测的是真入口，
 * 不是替身。
 */
const { activeStyle, setNoteStyle } = useWorkspace()

const open = ref(false)

function commit(css: string) {
  open.value = false
  setNoteStyle(css)
}
</script>

<template>
  <!-- 小圆点表示这篇笔记已经有页面样式：入口本身常驻（不然写过的样式没有回头路）。 -->
  <Tooltip>
    <TooltipTrigger as-child>
      <button
        type="button"
        class="flex h-6 flex-none items-center gap-1.5 rounded-[4px] px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        @mousedown.prevent
        @click="open = true"
      >
        <span
          class="size-1.5 flex-none rounded-full"
          :class="activeStyle.trim() === '' ? 'bg-muted-foreground/25' : 'bg-foreground/55'"
        />
        页面样式
      </button>
    </TooltipTrigger>
    <TooltipContent>页面级样式：写进这篇笔记 HTML 的头部（编辑时格式化，保存压成单行）</TooltipContent>
  </Tooltip>

  <HtmlSourceDrawer
    :open="open"
    :source="activeStyle"
    language="css"
    title="页面样式 · CSS"
    @commit="commit"
    @close="open = false"
  />
</template>
