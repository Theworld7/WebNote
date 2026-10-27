<script setup lang="ts">
import type { CreateTarget, FileNode } from "@/types/workspace"
import { computed } from "vue"
import { ChevronRightIcon, CopyIcon, DatabaseIcon, EllipsisIcon, FileDownIcon, FilePlusIcon, FileTextIcon, FileUpIcon, FolderIcon, FolderOpenIcon, FolderPlusIcon, GlobeIcon, PencilIcon, PlusIcon, TrashIcon } from "@lucide/vue"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useToast } from "@/composables/useToast"
import { useWorkspace } from "@/composables/useWorkspace"
import { describeError } from "@/lib/errors"
import { fileStem } from "@/lib/fs/policy"
import { cn } from "@/lib/utils"

const props = defineProps<{
  node: FileNode
  depth: number
}>()

const emit = defineEmits<{
  /** 请求新建：`kind` 决定建笔记还是文件夹，父目录就是这个节点自己。 */
  create: [parentPath: string, kind: CreateTarget["kind"]]
  /** 请求重命名 / 删除这个节点自己。 */
  rename: [path: string, kind: CreateTarget["kind"]]
  remove: [path: string, kind: CreateTarget["kind"]]
}>()

const {
  expandedIds,
  activePath,
  isSearching,
  toggleExpanded,
  openFile,
  draggingPath,
  dropTargetPath,
  fs,
  root,
  exportMarkdown,
  importMarkdownInto,
} = useWorkspace()
const { notify } = useToast()

// 节点的 id 就是完整工作区路径（见 `lib/fs/policy` 的 `folderNode` / `fileNode`）。
// 整合视图把数据表挂到笔记名下，这时「父目录 + 名字」拼不出表的真实路径，只能读 id。
const fullPath = computed(() => props.node.id)

const isFolder = computed(() => props.node.kind === "folder")
/** 数据表节点。与 `isFolder` 一起构成三种形态 —— 它们不重叠。 */
const isTable = computed(() => props.node.kind === "table")
/**
 * 整合视图开着（`refs` 有定义，哪怕是空数组）。判据只看字段定义与否：
 * 空数组表示「这篇没引用表」，后缀照样要隐，不能让它看起来像没开整合。
 */
const isIntegrated = computed(() => props.node.kind === "note" && props.node.refs !== undefined)
/** 笔记名隐去 `.html` / `.htm`；数据表仍带 `.tbl`，两种文件的读法要能分辨。 */
const label = computed(() => (isIntegrated.value ? fileStem(props.node.name) : props.node.name))
const refs = computed(() => props.node.refs ?? [])
const hasRefs = computed(() => refs.value.length > 0)
/** 搜索态下一律展开，否则命中的子项会被折叠藏起来。 */
const isOpen = computed(() => isSearching.value || expandedIds.value.has(props.node.id))
/** 笔记引用的展开态：与文件夹共用 `expandedIds`，但搜索不自动摊开 —— 引用是附属信息，不是命中项。 */
const isRefsOpen = computed(() => expandedIds.value.has(props.node.id))
const isActive = computed(() => !isFolder.value && activePath.value === fullPath.value)

/** 这个节点正在被拖 —— 源行画淡，让用户看清自己拖的是哪个。 */
const isDragging = computed(() => draggingPath.value === fullPath.value)
/** 这个文件夹是当前合法落点。文件行不会有值，所以「能不能落」用户一眼能分辨。 */
const isDropTarget = computed(() => isFolder.value && dropTargetPath.value === fullPath.value)

// 缩进靠 padding 而非嵌套容器的 margin，这样 hover 底色仍是一整行。
const rowStyle = computed(() => ({ paddingLeft: `${6 + props.depth * 16}px` }))

const ROW =
  "mb-0.5 flex h-7 cursor-default items-center gap-1.5 rounded-md pr-1.5 text-[13px] select-none hover:bg-muted group/row"

/** 行尾菜单按钮：hover 才现身，与 `+` 按钮共用一套观感。 */
const MENU_BUTTON =
  "grid size-5 shrink-0 place-items-center rounded text-muted-foreground opacity-0 hover:bg-muted-strong hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100"

/** 落点用描边环而不是填充：与 hover 的底色分属两层，叠加时仍能分辨。 */
const DROP_TARGET = "ring-1 ring-selection-foreground ring-inset"

/** 桌面端才有磁盘路径与系统文件管理器，「复制路径 / 打开所在位置」据此显隐。 */
const isDesktop = computed(() => root.value?.kind === "path")

/** 只有 HTML 文件给「用浏览器打开」—— 其它扩展名的默认应用不一定是浏览器，菜单不撒谎。 */
const isHtmlFile = computed(() => !isFolder.value && /\.html?$/i.test(props.node.name))

/**
 * 把这个节点的磁盘绝对路径放进剪贴板。
 *
 * 反馈走瞬态提示：菜单点完就关，行内无处显示 ✓，而剪贴板本身在系统里 ——
 * 不给一句「已复制」，用户只能靠再粘贴一次来确认。
 */
async function copyPath() {
  const driver = fs.value
  const current = root.value
  if (driver === null || current === null) return
  const absolute = driver.absolutePath(current, fullPath.value)
  if (absolute === null) return
  try {
    await navigator.clipboard.writeText(absolute)
  } catch (error) {
    // 剪贴板被拒（窗口无焦点、权限策略）时什么都没发生，菜单也已经关了 ——
    // 不说一声，用户会以为路径在剪贴板里。
    notify(`复制路径失败：${describeError(error)}`, "error")
    return
  }
  notify("路径已复制")
}

/** 在系统文件管理器里定位这个节点（选中呈现，不打开内容）。 */
async function revealInFileManager() {
  const driver = fs.value
  const current = root.value
  if (driver === null || current === null) return
  await driver.revealInFileManager(current, fullPath.value)
}

/** 用系统默认浏览器打开这个 HTML 文件（显式走浏览器，不交给 `.html` 的默认应用）。 */
async function openInBrowser() {
  const driver = fs.value
  const current = root.value
  if (driver === null || current === null) return
  await driver.openInBrowser(current, fullPath.value)
}

/** 把这篇笔记导出成 Markdown；取消（`false`）不提示。 */
async function exportAsMarkdown() {
  if (await exportMarkdown(fullPath.value)) notify("已导出为 Markdown")
}

/** 从这个文件夹导入 Markdown 文件，作为一篇新笔记。 */
async function importMarkdown() {
  if (await importMarkdownInto(fullPath.value)) notify("已导入 Markdown")
}

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
  <Collapsible v-if="isFolder" :open="isOpen" @update:open="toggleExpanded(node.id)">
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
              :class="MENU_BUTTON"
              aria-label="新建"
              @click.stop
            >
              <PlusIcon class="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem class="gap-2 text-[13px]" @select="emit('create', fullPath, 'note')">
              <FilePlusIcon class="size-3.5 text-muted-foreground" />
              <span>新建笔记</span>
            </DropdownMenuItem>
            <DropdownMenuItem class="gap-2 text-[13px]" @select="emit('create', fullPath, 'table')">
              <DatabaseIcon class="size-3.5 text-muted-foreground" />
              <span>新建数据表</span>
            </DropdownMenuItem>
            <DropdownMenuItem class="gap-2 text-[13px]" @select="emit('create', fullPath, 'folder')">
              <FolderPlusIcon class="size-3.5 text-muted-foreground" />
              <span>新建文件夹</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem class="gap-2 text-[13px]" @select="importMarkdown">
              <FileUpIcon class="size-3.5 text-muted-foreground" />
              <span>从 Markdown 导入</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <!-- 与文件行同一套 `⋯` 菜单：重命名 / 删除从这里走，「新建」独立在左侧的 `+`。 -->
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <button
              type="button"
              draggable="false"
              :class="MENU_BUTTON"
              aria-label="更多操作"
              @click.stop
            >
              <EllipsisIcon class="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <template v-if="isDesktop">
              <DropdownMenuItem class="gap-2 text-[13px]" @select="copyPath">
                <CopyIcon class="size-3.5 text-muted-foreground" />
                <span>复制路径</span>
              </DropdownMenuItem>
              <DropdownMenuItem class="gap-2 text-[13px]" @select="revealInFileManager">
                <FolderOpenIcon class="size-3.5 text-muted-foreground" />
                <span>打开所在位置</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </template>
            <DropdownMenuItem class="gap-2 text-[13px]" @select="emit('rename', fullPath, 'folder')">
              <PencilIcon class="size-3.5 text-muted-foreground" />
              <span>重命名</span>
            </DropdownMenuItem>
            <DropdownMenuItem class="gap-2 text-[13px]" @select="emit('remove', fullPath, 'folder')">
              <TrashIcon class="size-3.5 text-muted-foreground" />
              <span>删除</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </CollapsibleTrigger>
    <CollapsibleContent class="tree-children">
      <FileTreeNode
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :depth="depth + 1"
        @create="(parent, kind) => emit('create', parent, kind)"
        @rename="(path, kind) => emit('rename', path, kind)"
        @remove="(path, kind) => emit('remove', path, kind)"
      />
    </CollapsibleContent>
  </Collapsible>

  <!-- 文件行（笔记 / 数据表）。整合视图把引用表挂在笔记名下，所以行外面套一层
       Collapsible —— 但触发区**不是**整行：点行要打开文件，只有右端的箭头才折叠。 -->
  <Collapsible v-else :open="isRefsOpen">
    <div
      draggable="true"
      :class="cn(
        ROW,
        isActive ? 'bg-selection font-medium text-selection-foreground' : 'text-foreground/80',
        isDragging && 'opacity-50',
      )"
      :style="rowStyle"
      :data-tree-kind="node.kind"
      :data-tree-path="fullPath"
      @dragstart="startDrag"
      @dragend="draggingPath = ''"
      @click="openFile(fullPath)"
    >
      <!-- 数据表一个图标、笔记一个：树上两行同名文件时，这是唯一的区分线索。 -->
      <DatabaseIcon
        v-if="isTable"
        :class="cn('size-3.5 shrink-0', isActive ? 'text-selection-foreground' : 'text-muted-foreground')"
      />
      <FileTextIcon
        v-else
        :class="cn('size-3.5 shrink-0', isActive ? 'text-selection-foreground' : 'text-muted-foreground')"
      />
      <span class="min-w-0 flex-1 truncate">{{ label }}</span>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <!-- `draggable=false` 与文件夹行的 `+` 同一个坑：不关掉拖拽继承，按住按钮
               会启动整行拖拽而不是点开菜单。 -->
          <button
            type="button"
            draggable="false"
            :class="MENU_BUTTON"
            aria-label="更多操作"
            @click.stop
          >
            <EllipsisIcon class="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <template v-if="isDesktop">
            <DropdownMenuItem class="gap-2 text-[13px]" @select="copyPath">
              <CopyIcon class="size-3.5 text-muted-foreground" />
              <span>复制路径</span>
            </DropdownMenuItem>
            <DropdownMenuItem class="gap-2 text-[13px]" @select="revealInFileManager">
              <FolderOpenIcon class="size-3.5 text-muted-foreground" />
              <span>打开所在位置</span>
            </DropdownMenuItem>
            <DropdownMenuItem v-if="isHtmlFile" class="gap-2 text-[13px]" @select="openInBrowser">
              <GlobeIcon class="size-3.5 text-muted-foreground" />
              <span>用浏览器打开</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </template>
          <DropdownMenuItem v-if="isHtmlFile" class="gap-2 text-[13px]" @select="exportAsMarkdown">
            <FileDownIcon class="size-3.5 text-muted-foreground" />
            <span>导出为md</span>
          </DropdownMenuItem>
          <DropdownMenuItem class="gap-2 text-[13px]" @select="emit('rename', fullPath, node.kind)">
            <PencilIcon class="size-3.5 text-muted-foreground" />
            <span>重命名</span>
          </DropdownMenuItem>
          <DropdownMenuItem class="gap-2 text-[13px]" @select="emit('remove', fullPath, node.kind)">
            <TrashIcon class="size-3.5 text-muted-foreground" />
            <span>删除</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <!-- 引用展开箭头：常显（不随 hover），因为它是「这篇笔记下挂着东西」的唯一线索。
           点它只折叠/展开，`@click.stop` 挡住行本身的“打开文件”。 -->
      <button
        v-if="hasRefs"
        type="button"
        draggable="false"
        class="grid size-5 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted-strong hover:text-foreground"
        :aria-expanded="isRefsOpen"
        :aria-label="isRefsOpen ? '收起引用的数据表' : '展开引用的数据表'"
        @click.stop="toggleExpanded(node.id)"
      >
        <ChevronRightIcon
          :class="cn('size-3.5 transition-transform', isRefsOpen && 'rotate-90')"
        />
      </button>
    </div>
    <CollapsibleContent v-if="hasRefs">
      <FileTreeNode
        v-for="child in refs"
        :key="child.id"
        :node="child"
        :depth="depth + 1"
        @create="(parent, kind) => emit('create', parent, kind)"
        @rename="(path, kind) => emit('rename', path, kind)"
        @remove="(path, kind) => emit('remove', path, kind)"
      />
    </CollapsibleContent>
  </Collapsible>
</template>
