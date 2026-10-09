<script setup lang="ts">
import { computed } from "vue"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useWorkspace } from "@/composables/useWorkspace"
import FileTreeNode from "./FileTreeNode.vue"

const { tree, hasRoot, scanning, isSearching } = useWorkspace()

/**
 * 树为空时的说明。
 *
 * 三种空各有各的原因，混成一句「暂无笔记」会让人以为是 bug ——
 * 尤其「目录里没有 .html」这种，用户多半是把 markdown 目录选进来了。
 */
const message = computed(() => {
  if (scanning.value) return "正在读取目录…"
  // 这里不再说「还没有打开目录」—— 编辑区空态已经说过一遍了。
  // 侧栏的位置更该指出动作，所以只说该点哪儿。
  if (!hasRoot.value) return "点上方「打开文件夹」挑一个目录"
  if (tree.value.length > 0) return ""
  if (isSearching.value) return "没有匹配的笔记"
  return "这个目录里没有 .html 笔记"
})
</script>

<template>
  <ScrollArea class="min-h-0 flex-1">
    <div class="px-1.5 pb-2">
      <p v-if="message !== ''" class="px-2 py-3 text-[12px] leading-relaxed text-muted-foreground">
        {{ message }}
      </p>
      <template v-else>
        <FileTreeNode
          v-for="node in tree"
          :key="node.id"
          :node="node"
          :depth="0"
          parent-path=""
        />
      </template>
    </div>
  </ScrollArea>
</template>
