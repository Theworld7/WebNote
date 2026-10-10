<script setup lang="ts">
import { computed } from "vue"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useWorkspace } from "@/composables/useWorkspace"
import { closestTreeRow } from "@/lib/dom"
import FileTreeNode from "./FileTreeNode.vue"

const { tree, hasRoot, scanning, isSearching, draggingPath, dropTargetPath, moveFileTo, dismissError } =
  useWorkspace()

/** 新建请求往上冒给 `AppSidebar` —— 对话框挂在那儿，树本身不开弹窗。 */
const emit = defineEmits<{
  create: [parentPath: string, kind: "note" | "folder"]
}>()

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

/**
 * 拖拽事件统一挂在容器上，靠冒泡接管 —— 与 `BlockEditor` 同一个模式。
 *
 * 逐个节点挂监听的话，落点判定要写在节点里，而节点不知道「别的行在哪」。
 */
const containsWebnotePath = (transfer: DataTransfer | null): boolean =>
  transfer !== null && [...transfer.types].includes("application/x-webnote-path")

/**
 * 落点解析。只有**文件夹行**能接。
 *
 * 拖到文件行上不 preventDefault、不高亮，让浏览器判定为非法落点 —— 用户看到「没反应」
 * 就知道那儿放不了，比放进去之后才发现移错了地方好。
 */
function targetFolder(event: DragEvent): string | null {
  const target = event.target
  if (!(target instanceof Element)) return null
  const row = closestTreeRow(target)
  if (row === null || row.kind !== "folder") return null
  if (row.path === draggingPath.value) return null
  return row.path
}

function onDragOver(event: DragEvent) {
  if (draggingPath.value === "" || !containsWebnotePath(event.dataTransfer)) return
  const folder = targetFolder(event)
  dropTargetPath.value = folder ?? ""
  if (folder === null) return
  // 只有 preventDefault 过的 dragover 才允许 drop。
  event.preventDefault()
  if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "move"
}

/** 离开容器时清掉落点。用 relatedTarget 判断，避免在行之间移动时反复闪。 */
function onDragLeave(event: DragEvent) {
  const next = event.relatedTarget
  if (next instanceof Node && event.currentTarget instanceof Node && event.currentTarget.contains(next)) {
    return
  }
  dropTargetPath.value = ""
}

async function onDrop(event: DragEvent) {
  const from = draggingPath.value
  const folder = targetFolder(event)
  draggingPath.value = ""
  dropTargetPath.value = ""
  if (from === "" || folder === null) return
  event.preventDefault()
  dismissError()
  await moveFileTo(from, folder)
}
</script>

<template>
  <ScrollArea class="min-h-0 flex-1">
    <!-- 左右内边距与上方「工作区行 / 搜索框」的 px-2.5 对齐：树行 hover 底色与搜索框同宽，
         右缘也正好让开 ScrollArea 的 2.5 宽滚动条，避免行圆角被滑块压住。 -->
    <div
      class="min-h-full px-2.5 pb-2"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
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
          @create="(parentPath, kind) => emit('create', parentPath, kind)"
        />
      </template>
    </div>
  </ScrollArea>
</template>
