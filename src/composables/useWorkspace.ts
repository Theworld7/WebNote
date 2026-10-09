import type { InjectionKey } from "vue"
import type { Block, BlockType, CloseStrategy, FileNode, InlineRun, OpenTab, TableCell } from "@/types/workspace"
import type { FsRoot, WorkspaceFs } from "@/lib/fs"
import { computed, inject, provide, ref } from "vue"
import { cloneBlock, countChars, createBlock, createBlockId, isTextualBlock, retypeBlock } from "@/lib/blocks"
import { parseHtml, serializeHtml } from "@/lib/html"
import { createWorkspaceFs } from "@/lib/fs"
import { defaultExpanded } from "@/lib/fs/policy"
import * as table from "@/lib/table"
import { fileName, titleOf, toCrumbs } from "@/lib/paths"

/**
 * 工作区状态。
 *
 * 接真实文件系统后这里的状态机有三条与 mock 时代不同的规矩：
 *
 * 1. **文档按需读**。树是启动时扫出来的（只要文件名），正文要等标签被打开才去读盘。
 *    `documents` 因此是「已读进来的那部分」，`loadedPaths` 才是「哪些读过了」的真源 ——
 *    不能拿 `documents[path]` 是否存在来判断，空文档（全删光只剩一个空块）也是合法值。
 * 2. **只有写盘成功才清脏态**。以前无条件清；接了真文件之后那等于把「写失败」谎报成「已保存」。
 * 3. **换库 = 换语境**。切工作区时标签、文档、展开状态全部作废，否则会残留指向新树里
 *    不存在的路径。
 */

/** 关键词过滤：文件按名字匹配；文件夹命中自身或任一后代时保留。 */
function filterNodes(nodes: readonly FileNode[], keyword: string): FileNode[] {
  const result: FileNode[] = []
  for (const node of nodes) {
    if (node.name.toLowerCase().includes(keyword)) {
      result.push(node)
      continue
    }
    if (node.kind !== "folder" || !node.children) continue
    const children = filterNodes(node.children, keyword)
    if (children.length > 0) result.push({ ...node, children })
  }
  return result
}

/** 把 unknown 错误压成一句能直接显示给用户的话。 */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  return String(error)
}

/** Set 的不可变增删。ref<Set> 内部改动不会触发更新，必须换新对象。 */
function withFlag(source: ReadonlySet<string>, value: string, on: boolean): Set<string> {
  const next = new Set(source)
  if (on) next.add(value)
  else next.delete(value)
  return next
}

function createWorkspace() {
  /**
   * 平台驱动。启动前为 null —— 它是异步挑出来的（桌面端那份要动态引入）。
   * 所有需要它的动作一律先守卫后使用，不做非空断言。
   */
  const fs = ref<WorkspaceFs | null>(null)
  const root = ref<FsRoot | null>(null)
  const rootName = ref("")
  const tree = ref<FileNode[]>([])
  const scanning = ref(false)
  const fsError = ref("")

  const query = ref("")
  const expandedIds = ref(new Set<string>())
  const tabs = ref<OpenTab[]>([])
  const activePath = ref("")
  const documents = ref<Record<string, Block[]>>({})
  /** 已经读过盘的路径。与 `documents` 分开，见文件头第 1 条。 */
  const loadedPaths = ref(new Set<string>())
  const loadingPaths = ref(new Set<string>())

  /** 待确认关闭的脏标签路径。null 表示没有挂起的关闭动作（确认框关闭）。 */
  const pendingClosePath = ref<string | null>(null)

  const isSearching = computed(() => query.value.trim().length > 0)

  /** 搜索结果。非搜索态下原样返回，由 FileTree 按 expandedIds 决定折叠。 */
  const visibleTree = computed<FileNode[]>(() => {
    if (!isSearching.value) return tree.value
    return filterNodes(tree.value, query.value.trim().toLowerCase())
  })

  const activeTab = computed<OpenTab | null>(
    () => tabs.value.find((tab) => tab.path === activePath.value) ?? null,
  )

  const activeDocument = computed<Block[]>(() => documents.value[activePath.value] ?? [])

  const crumbs = computed(() => toCrumbs(activePath.value))

  const charCount = computed(() => countChars(activeDocument.value))

  const isDirty = computed(() => activeTab.value?.dirty ?? false)

  /** 是否存在任何未保存的标签。关窗兜底用它判断要不要拦。 */
  const hasDirty = computed(() => tabs.value.some((tab) => tab.dirty))

  const isClosePending = computed(() => pendingClosePath.value !== null)

  const pendingCloseLabel = computed(() => fileName(pendingClosePath.value ?? ""))

  const hasRoot = computed(() => root.value !== null)

  /** 没有工作区、或工作区里一篇笔记都没有 —— 编辑区据此显示引导而不是空白。 */
  const isEditorEmpty = computed(
    () => !hasRoot.value || (!scanning.value && visibleTree.value.length === 0 && query.value === ""),
  )

  const isLoadingDocument = computed(() => loadingPaths.value.has(activePath.value))

  const fsHint = computed(() => fs.value?.hint ?? "")

  // ---- 工作区 ----

  /**
   * 启动引导：挑驱动，能恢复就恢复。
   *
   * 恢复失败不是错误 —— 目录被移动或删除都是用户自己动过盘，静默回落到「请选择目录」。
   */
  async function bootstrap() {
    try {
      const driver = await createWorkspaceFs()
      fs.value = driver
      if (!driver.canRestore) return
      const restored = await driver.restoreRoot()
      if (restored !== null) await adoptRoot(restored)
    } catch (error) {
      fsError.value = `初始化文件系统失败：${describeError(error)}`
    }
  }

  /** 接受一个根：清空旧语境 → 扫树 → 默认展开根层。 */
  async function adoptRoot(next: FsRoot) {
    const driver = fs.value
    if (driver === null) return

    root.value = next
    rootName.value = driver.rootName(next)
    tabs.value = []
    activePath.value = ""
    documents.value = {}
    loadedPaths.value = new Set()
    loadingPaths.value = new Set()
    expandedIds.value = new Set()
    query.value = ""
    fsError.value = ""

    scanning.value = true
    try {
      const nodes = await driver.scanTree(next)
      tree.value = nodes
      expandedIds.value = new Set(defaultExpanded(nodes))
    } catch (error) {
      tree.value = []
      fsError.value = `读取目录失败：${describeError(error)}`
    } finally {
      scanning.value = false
    }
  }

  /** 「打开文件夹」/「换目录」按钮。用户取消则什么都不做。 */
  async function openRoot() {
    const driver = fs.value
    if (driver === null) return
    try {
      const picked = await driver.pickRoot()
      if (picked !== null) await adoptRoot(picked)
    } catch (error) {
      fsError.value = `打开目录失败：${describeError(error)}`
    }
  }

  function dismissError() {
    fsError.value = ""
  }

  // ---- 文档 ----

  /**
   * 读一篇笔记并解析。
   *
   * 失败也要落一个空块并标记已加载：否则标签打开后是一片虚无、每次激活还重试一次，
   * 错误提示会反复刷。读失败的真实原因留在 `fsError` 里给用户看。
   */
  async function loadDocument(path: string) {
    const driver = fs.value
    const current = root.value
    if (driver === null || current === null) return
    if (loadedPaths.value.has(path)) return

    loadingPaths.value = withFlag(loadingPaths.value, path, true)
    try {
      const source = await driver.readNote(current, path)
      documents.value[path] = parseHtml(source)
    } catch (error) {
      documents.value[path] = [createBlock("text")]
      fsError.value = `打开「${fileName(path)}」失败：${describeError(error)}`
    } finally {
      loadedPaths.value = withFlag(loadedPaths.value, path, true)
      loadingPaths.value = withFlag(loadingPaths.value, path, false)
    }
  }

  function activateTab(path: string) {
    activePath.value = path
    void loadDocument(path)
  }

  function openFile(path: string) {
    if (!tabs.value.some((tab) => tab.path === path)) tabs.value.push({ path, dirty: false })
    activateTab(path)
  }

  function closeTab(path: string) {
    const index = tabs.value.findIndex((tab) => tab.path === path)
    if (index === -1) return
    tabs.value.splice(index, 1)
    if (activePath.value !== path) return
    // 关掉的是当前标签：落到右邻，没有右邻则落到左邻，都没有就清空。
    const next = tabs.value[index] ?? tabs.value[index - 1]
    activePath.value = next ? next.path : ""
  }

  /**
   * 关标签入口。干净的标签直接关；脏标签挂起，等 `resolveClose()` 拿到用户选择再关。
   *
   * 拦截策略选定为「只在关标签时拦」：切标签属于高频动作，静默保留脏态不打断。
   */
  function requestCloseTab(path: string) {
    const tab = tabs.value.find((item) => item.path === path)
    if (!tab) return
    if (!tab.dirty) {
      closeTab(path)
      return
    }
    pendingClosePath.value = path
  }

  /**
   * 确认框的结果。
   *
   * 先把挂起态清掉再 await 保存 —— 否则确认框要等写盘回来才消失，慢盘上会像卡住了。
   * 保存失败则**不关**：关掉等于把没写成功的修改丢掉，那比让确认框多停一会儿糟得多。
   */
  async function resolveClose(strategy: CloseStrategy) {
    const path = pendingClosePath.value
    if (path === null) return
    pendingClosePath.value = null

    if (strategy === "save") {
      await saveTab(path)
      const tab = tabs.value.find((item) => item.path === path)
      if (tab?.dirty === true) return
    }
    closeTab(path)
  }

  /** 取消关闭（按钮、Esc、点遮罩都走这里）。 */
  function cancelPendingClose() {
    pendingClosePath.value = null
  }

  function toggleFolder(id: string) {
    const next = new Set(expandedIds.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    expandedIds.value = next
  }

  /**
   * 保存指定标签，真写盘。
   *
   * 必须按路径定位而不是操作当前激活标签 —— 关掉一个**非激活**的脏标签时，
   * 要保存的是它，不能误清当前标签的脏态。
   */
  async function saveTab(path: string) {
    const driver = fs.value
    const current = root.value
    const blocks = documents.value[path]
    if (driver === null || current === null || blocks === undefined) return

    const html = serializeHtml(blocks, { title: titleOf(path) })
    try {
      await driver.writeNote(current, path, html)
    } catch (error) {
      fsError.value = `保存「${fileName(path)}」失败：${describeError(error)}`
      return
    }
    // 写成功了才清脏态。
    const tab = tabs.value.find((item) => item.path === path)
    if (tab) tab.dirty = false
  }

  /** 保存按钮：保存当前激活标签。 */
  async function save() {
    await saveTab(activePath.value)
  }

  function markDirty(dirty = true) {
    const tab = activeTab.value
    if (tab) tab.dirty = dirty
  }

  // ---- 块级操作。全部收敛在这里，组件只负责触发与聚焦 ----

  /**
   * 在当前文档里按 id 取块。
   *
   * 一律走它而不是自己 `find`：图片读文件、表格单元格回读这类**异步**回调里，
   * 块可能在 await 期间已被删除，拿到 undefined 是正常路径而非异常。
   */
  function activeBlock(id: string): Block | undefined {
    return activeDocument.value.find((item) => item.id === id)
  }

  function setBlockRuns(id: string, runs: InlineRun[]) {
    const block = activeBlock(id)
    if (block === undefined || !isTextualBlock(block)) return
    block.runs = runs
    markDirty()
  }

  function toggleBlockChecked(id: string) {
    const block = activeBlock(id)
    if (block === undefined || block.type !== "todo") return
    block.checked = !block.checked
    markDirty()
  }

  /** 在 `index` 处插入新块，越界夹到两端。拖入图片要按落点插，不能只支持「追加」。 */
  function insertBlockAt(index: number, type: BlockType): string {
    const blocks = activeDocument.value
    const block = createBlock(type)
    const at = Math.min(Math.max(index, 0), blocks.length)
    blocks.splice(at, 0, block)
    markDirty()
    return block.id
  }

  function insertBlockAfter(id: string, type: BlockType): string {
    const blocks = activeDocument.value
    const index = blocks.findIndex((item) => item.id === id)
    return insertBlockAt(index === -1 ? blocks.length : index + 1, type)
  }

  function appendBlock(type: BlockType): string {
    return insertBlockAt(activeDocument.value.length, type)
  }

  function changeBlockType(id: string, type: BlockType) {
    const blocks = activeDocument.value
    const index = blocks.findIndex((item) => item.id === id)
    const current = index === -1 ? undefined : blocks[index]
    if (current === undefined) return
    blocks[index] = retypeBlock(current, type)
    markDirty()
  }

  function duplicateBlock(id: string) {
    const blocks = activeDocument.value
    const index = blocks.findIndex((item) => item.id === id)
    if (index === -1) return
    const source = blocks[index]
    if (source === undefined) return
    blocks.splice(index + 1, 0, cloneBlock(source, createBlockId()))
    markDirty()
  }

  // ---- 图片 ----

  /** 换图。`src` 是 URL 或 data URI（本地文件走 `readImageFile`）。 */
  function setImageSource(id: string, src: string) {
    const block = activeBlock(id)
    if (block === undefined || block.type !== "image") return
    block.src = src
    markDirty()
  }

  // ---- Mermaid ----

  /**
   * 改图源码。
   *
   * 这里**不校验语法**：用户打到一半的源码是常态，此时拦下来等于不让人保存。
   * 画不出来由渲染层显示错误态，源码照存。
   */
  function setMermaidSource(id: string, source: string) {
    const block = activeBlock(id)
    if (block === undefined || block.type !== "mermaid") return
    block.source = source
    markDirty()
  }

  // ---- 表格 ----

  /**
   * 表格几何操作的统一出口：取块、跑纯函数、整体回写。
   *
   * `table.ts` 里的函数都用「旧数组进、新数组出」，回写这一步只在这里做一次，
   * 组件层就不用记哪个操作是原地改、哪个是替换。
   */
  function applyTable(id: string, transform: (rows: TableCell[][]) => TableCell[][]): void {
    const block = activeBlock(id)
    if (block === undefined || block.type !== "table") return
    block.rows = transform(block.rows)
    markDirty()
  }

  /** 给空表格定尺寸（网格选择器选中后调）。已有内容的表不会被覆盖。 */
  function defineTable(id: string, columns: number, rows: number, header: boolean) {
    const block = activeBlock(id)
    if (block === undefined || block.type !== "table") return
    if (block.rows.length > 0) return
    block.rows = table.createGrid(columns, rows, header)
    markDirty()
  }

  /** 改单元格内容。行列越界直接忽略 —— 焦点回调可能在行列被删之后才到。 */
  function setTableCellRuns(id: string, row: number, column: number, runs: InlineRun[]) {
    const block = activeBlock(id)
    if (block === undefined || block.type !== "table") return
    const cell = block.rows[row]?.[column]
    if (cell === undefined) return
    cell.runs = runs
    markDirty()
  }

  function insertTableRow(id: string, at: number) {
    applyTable(id, (rows) => table.insertRow(rows, at))
  }

  function removeTableRow(id: string, at: number) {
    applyTable(id, (rows) => table.removeRow(rows, at))
  }

  function insertTableColumn(id: string, at: number) {
    applyTable(id, (rows) => table.insertColumn(rows, at))
  }

  function removeTableColumn(id: string, at: number) {
    applyTable(id, (rows) => table.removeColumn(rows, at))
  }

  function setTableHeaderRow(id: string, header: boolean) {
    applyTable(id, (rows) => table.setHeaderRow(rows, header))
  }

  function removeBlock(id: string) {
    const blocks = activeDocument.value
    const index = blocks.findIndex((item) => item.id === id)
    if (index === -1) return
    blocks.splice(index, 1)
    // 文档至少保留一个空块，否则光标无处落。
    if (blocks.length === 0) blocks.push(createBlock("text"))
    markDirty()
  }

  /**
   * 拖拽排序。
   *
   * `to` 是**移除前**数组里的插入下标（0..length），所以往后拖时目标位要减 1 才能
   * 抵消源块被摘走造成的左移 —— 否则每次向后拖都会少挪一格。
   */
  function moveBlock(from: number, to: number) {
    const blocks = activeDocument.value
    if (from < 0 || from >= blocks.length || to < 0 || to > blocks.length) return
    if (to === from || to === from + 1) return
    const [moved] = blocks.splice(from, 1)
    if (!moved) return
    const target = Math.min(Math.max(to > from ? to - 1 : to, 0), blocks.length)
    blocks.splice(target, 0, moved)
    markDirty()
  }

  return {
    // state
    tree: visibleTree,
    query,
    isSearching,
    expandedIds,
    tabs,
    activePath,
    // derived
    activeTab,
    activeDocument,
    crumbs,
    charCount,
    isDirty,
    hasDirty,
    isClosePending,
    pendingCloseLabel,
    isLoadingDocument,
    isEditorEmpty,
    hasRoot,
    rootName,
    scanning,
    fsHint,
    fsError,
    // workspace actions
    bootstrap,
    openRoot,
    dismissError,
    // file actions
    openFile,
    activateTab,
    closeTab,
    requestCloseTab,
    resolveClose,
    cancelPendingClose,
    toggleFolder,
    save,
    markDirty,
    // block actions
    setBlockRuns,
    toggleBlockChecked,
    insertBlockAfter,
    insertBlockAt,
    appendBlock,
    changeBlockType,
    duplicateBlock,
    removeBlock,
    moveBlock,
    // image actions
    setImageSource,
    // mermaid actions
    setMermaidSource,
    // table actions
    defineTable,
    setTableCellRuns,
    insertTableRow,
    removeTableRow,
    insertTableColumn,
    removeTableColumn,
    setTableHeaderRow,
  }
}

export type Workspace = ReturnType<typeof createWorkspace>

const WORKSPACE_KEY: InjectionKey<Workspace> = Symbol("webnote-workspace")

/** 在 App.vue 调用一次；子树里用 `useWorkspace()` 取同一份状态。 */
export function provideWorkspace(): Workspace {
  const workspace = createWorkspace()
  provide(WORKSPACE_KEY, workspace)
  return workspace
}

export function useWorkspace(): Workspace {
  const workspace = inject(WORKSPACE_KEY)
  if (!workspace) throw new Error("useWorkspace() 必须在 provideWorkspace() 的子树内调用")
  return workspace
}
