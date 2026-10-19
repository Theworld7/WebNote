<script setup lang="ts">
import { ref } from "vue"
import { useWorkspace } from "@/composables/useWorkspace"
import HtmlSourceDrawer from "./HtmlSourceDrawer.vue"

const { crumbs, charCount, activeStyle, setNoteStyle } = useWorkspace()

/** 页面样式的编辑器抽屉。与 HTML 块共用同一个组件，只是语言与标题不同（ADR-0011）。 */
const styleOpen = ref(false)

function commitStyle(css: string) {
  styleOpen.value = false
  setNoteStyle(css)
}
</script>

<!-- 面包屑取代了原先的格式标签（HTML），落在左下角；字数紧随其后，右端是页面样式入口。 -->
<template>
  <div class="flex h-8 flex-none items-center gap-3.5 px-[22px] text-[11px] text-muted-foreground">
    <span class="flex min-w-0 items-center gap-1.5 overflow-hidden">
      <template v-for="(crumb, index) in crumbs" :key="`${crumb.name}-${index}`">
        <span class="truncate" :class="crumb.isFile && 'text-foreground'">{{ crumb.name }}</span>
        <span v-if="!crumb.isFile" class="flex-none text-muted-foreground/45">/</span>
      </template>
    </span>
    <span class="flex-none">{{ charCount }} 字</span>
    <div class="flex-1" />
    <!-- 小圆点表示这篇笔记已经有页面样式：入口本身常驻（不然写过的样式没有回头路）。 -->
    <button
      type="button"
      class="-mr-1.5 flex flex-none items-center gap-1.5 rounded-[4px] px-1.5 py-0.5 transition-colors hover:bg-muted hover:text-foreground"
      title="页面级样式：写进这篇笔记 HTML 的头部（编辑时格式化，保存压成单行）"
      @click="styleOpen = true"
    >
      <span
        class="size-1.5 rounded-full"
        :class="activeStyle.trim() === '' ? 'bg-muted-foreground/25' : 'bg-foreground/55'"
      />
      页面样式
    </button>

    <HtmlSourceDrawer
      :open="styleOpen"
      :source="activeStyle"
      language="css"
      title="页面样式 · CSS"
      @commit="commitStyle"
      @close="styleOpen = false"
    />
  </div>
</template>
