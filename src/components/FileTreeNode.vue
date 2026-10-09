<script setup lang="ts">
import type { FileNode } from "@/types/workspace"
import { computed } from "vue"
import { ChevronRightIcon, FileTextIcon, FolderIcon } from "@lucide/vue"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { useWorkspace } from "@/composables/useWorkspace"
import { joinPath } from "@/lib/paths"
import { cn } from "@/lib/utils"

const props = defineProps<{
  node: FileNode
  depth: number
  /** 父级路径前缀，根层为空串。用于拼出 `日记 / 2026-10-08.html` 这样的完整路径。 */
  parentPath: string
}>()

const { expandedIds, activePath, isSearching, toggleFolder, openFile } = useWorkspace()

// 路径格式只由 `joinPath` 决定 —— 树、标签、面包屑三处必须给出同一个键。
const fullPath = computed(() => joinPath(props.parentPath, props.node.name))

const isFolder = computed(() => props.node.kind === "folder")
/** 搜索态下一律展开，否则命中的子项会被折叠藏起来。 */
const isOpen = computed(() => isSearching.value || expandedIds.value.has(props.node.id))
const isActive = computed(() => !isFolder.value && activePath.value === fullPath.value)

// 缩进靠 padding 而非嵌套容器的 margin，这样 hover 底色仍是一整行。
const rowStyle = computed(() => ({ paddingLeft: `${6 + props.depth * 16}px` }))

const ROW = "flex h-7 cursor-default items-center gap-1.5 rounded-md pr-1.5 text-[13px] select-none hover:bg-muted"
</script>

<template>
  <Collapsible v-if="isFolder" :open="isOpen" @update:open="toggleFolder(node.id)">
    <CollapsibleTrigger as-child>
      <div :class="cn(ROW, 'font-medium')" :style="rowStyle">
        <ChevronRightIcon
          :class="cn('size-3 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-90')"
        />
        <FolderIcon class="size-3.5 shrink-0 text-muted-foreground" />
        <span class="min-w-0 flex-1 truncate text-left">{{ node.name }}</span>
      </div>
    </CollapsibleTrigger>
    <CollapsibleContent>
      <FileTreeNode
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :depth="depth + 1"
        :parent-path="fullPath"
      />
    </CollapsibleContent>
  </Collapsible>

  <div
    v-else
    :class="cn(
      ROW,
      isActive ? 'bg-selection font-medium text-selection-foreground' : 'text-foreground/80',
    )"
    :style="rowStyle"
    @click="openFile(fullPath)"
  >
    <FileTextIcon
      :class="cn('size-3.5 shrink-0', isActive ? 'text-selection-foreground' : 'text-muted-foreground')"
    />
    <span class="min-w-0 flex-1 truncate">{{ node.name }}</span>
  </div>
</template>
