<script setup lang="ts">
import type { TreeTarget } from "@/types/workspace"
import { computed } from "vue"
import {
  ArrowLeftToLineIcon,
  ArrowRightToLineIcon,
  CopyIcon,
  FileDownIcon,
  FolderOpenIcon,
  GlobeIcon,
  PencilIcon,
  TrashIcon,
  XIcon,
} from "@lucide/vue"
import { ContextMenuItem } from "@/components/ui/context-menu"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { useToast } from "@/composables/useToast"
import { useTreeDialogs } from "@/composables/useTreeDialogs"
import { useWorkspace } from "@/composables/useWorkspace"
import { describeError } from "@/lib/errors"
import { exportSummaryText } from "@/lib/markdown"

/**
 * 一个文件 / 文件夹的操作项 —— 文件树行的 `⋯`、文件树行的右键菜单、编辑器标签的右键
 * 菜单**共用这一份**。三处各写一遍的话，改一个动作就得记着改三处，漏一处就是「同一
 * 个文件，右键和点 `⋯` 能做的事不一样」。
 *
 * `surface` 只决定用哪套菜单项外壳（两套菜单组件各自不认对方的 context），动作与顺序
 * 完全一致：`dropdown` 给 `DropdownMenuContent`，`context` 给 `ContextMenuContent`。
 *
 * 唯一的例外是 `fromTab`：「关闭其他 / 左侧 / 右侧」是**标签**的事，树上那一行没有
 * 左右邻居，给它摆三条点了不动的菜单项只是噪音。所以这三条只在标签的菜单里出现，
 * 排在文件那一套之前（关标签是右键标签时最先想找的动作）。
 */
const props = defineProps<{
  path: string
  kind: TreeTarget["kind"]
  /** 节点名。只有 HTML 判断要看扩展名，读它比拿路径再切一次稳。 */
  name: string
  surface: "dropdown" | "context"
  /** 这份菜单是不是开在编辑器标签上（决定要不要多出那三条关闭动作）。 */
  fromTab?: boolean
}>()

const Item = computed(() => (props.surface === "context" ? ContextMenuItem : DropdownMenuItem))

const { fs, root, exportMarkdown, exportMarkdownTree, tabs, closeTabsBeside } = useWorkspace()
const { notify } = useToast()
const { requestRename, requestRemove } = useTreeDialogs()

const isFolder = computed(() => props.kind === "folder")
/** 桌面端才有磁盘路径与系统文件管理器，「复制路径 / 打开所在位置」据此显隐。 */
const isDesktop = computed(() => root.value?.kind === "path")
/** 只有 HTML 文件给「用浏览器打开」—— 其它扩展名的默认应用不一定是浏览器，菜单不撒谎。 */
const isHtmlFile = computed(() => !isFolder.value && /\.html?$/i.test(props.name))

/**
 * 三条关闭动作开不开：左右两侧没有标签、或总共就开着一颗时，那一条无从下手。
 * 灰着比藏起来好 —— 藏起来会让人以为「这里没有这个功能」。
 */
const isTab = computed(() => props.fromTab === true)
const tabIndex = computed(() => tabs.value.findIndex((tab) => tab.path === props.path))
const canCloseOthers = computed(() => isTab.value && tabs.value.length > 1)
const canCloseLeft = computed(() => isTab.value && tabIndex.value > 0)
const canCloseRight = computed(() => isTab.value && tabIndex.value !== -1 && tabIndex.value < tabs.value.length - 1)

/**
 * 把这个节点的磁盘绝对路径放进剪贴板。
 *
 * 反馈走瞬态提示：菜单点完就关，行内无处显示 ✓，而剪贴板本身在系统里 ——
 * 不给一句「已复制」，用户只能靠再粘贴一次来确认。
 */
async function copyPath(): Promise<void> {
  const driver = fs.value
  const current = root.value
  if (driver === null || current === null) return
  const absolute = driver.absolutePath(current, props.path)
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
async function revealInFileManager(): Promise<void> {
  const driver = fs.value
  const current = root.value
  if (driver === null || current === null) return
  await driver.revealInFileManager(current, props.path)
}

/** 用系统默认浏览器打开这个 HTML 文件（显式走浏览器，不交给 `.html` 的默认应用）。 */
async function openInBrowser(): Promise<void> {
  const driver = fs.value
  const current = root.value
  if (driver === null || current === null) return
  await driver.openInBrowser(current, props.path)
}

/** 把这篇笔记导出成 Markdown；取消（`false`）不提示。 */
async function exportAsMarkdown(): Promise<void> {
  if (await exportMarkdown(props.path)) notify("已导出为 Markdown")
}

/**
 * 把这个文件夹（含子文件夹）整批导出成 Markdown。
 *
 * 与单篇导出不同，这里选的是**目标文件夹**而不是文件名：一篇一个「另存为」没人受得了。
 * 目录结构照搬，所以同名笔记各在各的层级里。
 */
async function exportFolderAsMarkdown(): Promise<void> {
  const summary = await exportMarkdownTree(props.path)
  if (summary === null) return
  notify(exportSummaryText(summary), summary.failed.length > 0 ? "error" : "success")
}

/** 三条关闭动作共用一次跳转：给哪一侧，就把锚点交给工作区那一份实现。 */
async function closeBeside(side: "left" | "right" | "others"): Promise<void> {
  await closeTabsBeside(props.path, side)
}

const itemClass = "gap-2 text-13"
</script>

<template>
  <!-- 标签专有的三条：同一条文件菜单，多出一截「关掉这一片」。
       灰着而不是藏起来 —— 藏起来会让人以为这里没有这个功能。 -->
  <template v-if="isTab">
    <component :is="Item" :class="itemClass" :disabled="!canCloseOthers" @select="closeBeside('others')">
      <XIcon class="size-3.5 text-muted-foreground" />
      <span>关闭其他</span>
    </component>
    <component :is="Item" :class="itemClass" :disabled="!canCloseLeft" @select="closeBeside('left')">
      <ArrowLeftToLineIcon class="size-3.5 text-muted-foreground" />
      <span>关闭左侧</span>
    </component>
    <component :is="Item" :class="itemClass" :disabled="!canCloseRight" @select="closeBeside('right')">
      <ArrowRightToLineIcon class="size-3.5 text-muted-foreground" />
      <span>关闭右侧</span>
    </component>
    <div class="bg-border -mx-1 my-1 h-px" />
  </template>

  <template v-if="isFolder">
    <template v-if="isDesktop">
      <component :is="Item" :class="itemClass" @select="copyPath">
        <CopyIcon class="size-3.5 text-muted-foreground" />
        <span>复制路径</span>
      </component>
      <component :is="Item" :class="itemClass" @select="revealInFileManager">
        <FolderOpenIcon class="size-3.5 text-muted-foreground" />
        <span>打开所在位置</span>
      </component>
      <div class="bg-border -mx-1 my-1 h-px" />
    </template>
    <component :is="Item" :class="itemClass" @select="exportFolderAsMarkdown">
      <FileDownIcon class="size-3.5 text-muted-foreground" />
      <span>导出为 Markdown…</span>
    </component>
    <div class="bg-border -mx-1 my-1 h-px" />
    <component :is="Item" :class="itemClass" @select="requestRename(path, 'folder')">
      <PencilIcon class="size-3.5 text-muted-foreground" />
      <span>重命名</span>
    </component>
    <component :is="Item" :class="itemClass" @select="requestRemove(path, 'folder')">
      <TrashIcon class="size-3.5 text-muted-foreground" />
      <span>删除</span>
    </component>
  </template>

  <template v-else>
    <template v-if="isDesktop">
      <component :is="Item" :class="itemClass" @select="copyPath">
        <CopyIcon class="size-3.5 text-muted-foreground" />
        <span>复制路径</span>
      </component>
      <component :is="Item" :class="itemClass" @select="revealInFileManager">
        <FolderOpenIcon class="size-3.5 text-muted-foreground" />
        <span>打开所在位置</span>
      </component>
      <component v-if="isHtmlFile" :is="Item" :class="itemClass" @select="openInBrowser">
        <GlobeIcon class="size-3.5 text-muted-foreground" />
        <span>用浏览器打开</span>
      </component>
      <div class="bg-border -mx-1 my-1 h-px" />
    </template>
    <component v-if="isHtmlFile" :is="Item" :class="itemClass" @select="exportAsMarkdown">
      <FileDownIcon class="size-3.5 text-muted-foreground" />
      <span>导出为 Markdown</span>
    </component>
    <component :is="Item" :class="itemClass" @select="requestRename(path, kind)">
      <PencilIcon class="size-3.5 text-muted-foreground" />
      <span>重命名</span>
    </component>
    <component :is="Item" :class="itemClass" @select="requestRemove(path, kind)">
      <TrashIcon class="size-3.5 text-muted-foreground" />
      <span>删除</span>
    </component>
  </template>
</template>
