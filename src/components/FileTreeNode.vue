<script setup lang="ts">
import type { FileNode } from "@/types/workspace"
import { computed } from "vue"
import { ChevronRightIcon, FilePlusIcon, FileTextIcon, FolderIcon, FolderPlusIcon, PlusIcon } from "@lucide/vue"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useWorkspace } from "@/composables/useWorkspace"
import { joinPath } from "@/lib/paths"
import { cn } from "@/lib/utils"

const props = defineProps<{
  node: FileNode
  depth: number
  /** 父级路径前缀，根层为空串。用于拼出 `日记 / 2026-10-08.html` 这样的完整路径。 */
  parentPath: string
}>()

const emit = defineEmits<{
  /** 请求新建：`kind` 决定建笔记还是文件夹，父目录就是这个节点自己。 */
  create: [parentPath: string, kind: "note" | "folder"]
}>()

const { expandedIds, activePath, isSearching, toggleFolder, openFile, draggingPath, dropTargetPath } =
  useWorkspace()

// 路径格式只由 `joinPath` 决定 —— 树、标签、面包屑三处必须给出同一个键。
const fullPath = computed(() => joinPath(props.parentPath, props.node.name))

const isFolder = computed(() => props.node.kind === "folder")
/** 搜索态下一律展开，否则命中的子项会被折叠藏起来。 */
const isOpen = computed(() => isSearching.value || expandedIds.value.has(props.node.id))
const isActive = computed(() => !isFolder.value && activePath.value === fullPath.value)

/** 这个节点正在被拖 —— 源行画淡，让用户看清自己拖的是哪个。 */
const isDragging = computed(() => draggingPath.value === fullPath.value)
/** 这个文件夹是当前合法落点。文件行不会有值，所以「能不能落」用户一眼能分辨。 */
const isDropTarget = computed(() => isFolder.value && dropTargetPath.value === fullPath.value)

// 缩进靠 padding 而非嵌套容器的 margin，这样 hover 底色仍是一整行。
const rowStyle = computed(() => ({ paddingLeft: `${6 + props.depth * 16}px` }))

const ROW = "flex h-7 cursor-default items-center gap-1.5 rounded-md pr-1.5 text-[13px] select-none hover:bg-muted group/row"

/** 落点用描边环而不是填充：与 hover 的底色分属两层，叠加时仍能分辨。 */
const DROP_TARGET = "ring-1 ring-selection-foreground ring-inset"

/** 文件行可拖，且拖的是「这个文件」。路径作为 `dataTransfer` 载荷由 FileTree 写。 */
function startDrag(event: DragEvent) {
  draggingPath.value = fullPath.value
  if (event.dataTransfer === null) return
  event.dataTransfer.effectAllowed = "move"
  // 自定义类型让接收方能与「拖入图片文件」区分开；`text/plain` 是 WebView 的兼容兜底
  // ——不写点数据某些 WebView 不给 dragover（BlockEditor 踩过同一个坑）。
  event.dataTransfer.setData("application/x-webnote-path", fullPath.value)
  event.dataTransfer.setData("text/plain", fullPath.value)
}
</script>

<template>
  <Collapsible v-if="isFolder" :open="isOpen" @update:open="toggleFolder(node.id)">
    <!-- 触发区是**整行**：原来就是整行可点，把 trigger 收到内层会让缩进区与
         「行右缘的空白」点不动 —— 用户会以为折叠坏了。`+` 按钮用 `@click.stop`
         把自己摘出去，既不折叠也不影响行。 -->
    <CollapsibleTrigger as-child>
      <div
        :class="cn(ROW, 'font-medium', isDropTarget && DROP_TARGET)"
        :style="rowStyle"
        :data-tree-kind="'folder'"
        :data-tree-path="fullPath"
      >
        <ChevronRightIcon
          :class="cn('size-3 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-90')"
        />
        <FolderIcon class="size-3.5 shrink-0 text-muted-foreground" />
        <span class="min-w-0 flex-1 truncate text-left">{{ node.name }}</span>
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <!-- `draggable=false`：HTML5 的 draggable 会继承，行上开了可拖之后
                 在按钮上按住往下走会启动拖拽而不是点击，菜单就永远点不开。 -->
            <button
              type="button"
              draggable="false"
              class="grid size-5 shrink-0 place-items-center rounded text-muted-foreground opacity-0 hover:bg-muted-strong hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100"
              aria-label="新建"
              @click.stop
            >
              <PlusIcon class="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem class="gap-2 text-[13px]" @select="emit('create', fullPath, 'note')">
              <FilePlusIcon class="size-3.5 text-muted-foreground" />
              <span>新建笔记</span>
            </DropdownMenuItem>
            <DropdownMenuItem class="gap-2 text-[13px]" @select="emit('create', fullPath, 'folder')">
              <FolderPlusIcon class="size-3.5 text-muted-foreground" />
              <span>新建文件夹</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </CollapsibleTrigger>
    <CollapsibleContent>
      <FileTreeNode
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :depth="depth + 1"
        :parent-path="fullPath"
        @create="(parent, kind) => emit('create', parent, kind)"
      />
    </CollapsibleContent>
  </Collapsible>

  <div
    v-else
    draggable="true"
    :class="cn(
      ROW,
      isActive ? 'bg-selection font-medium text-selection-foreground' : 'text-foreground/80',
      isDragging && 'opacity-50',
    )"
    :style="rowStyle"
    :data-tree-kind="'file'"
    :data-tree-path="fullPath"
    @dragstart="startDrag"
    @dragend="draggingPath = ''"
    @click="openFile(fullPath)"
  >
    <FileTextIcon
      :class="cn('size-3.5 shrink-0', isActive ? 'text-selection-foreground' : 'text-muted-foreground')"
    />
    <span class="min-w-0 flex-1 truncate">{{ node.name }}</span>
  </div>
</template>
