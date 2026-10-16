import type { InjectionKey } from "vue"
import type { Block, BlockSettingsPatch, BlockType, ChatMessage, CloseStrategy, CreateTarget, FileNode, InlineRun, LayoutMode, OpenTab, TableAlign, TableCell } from "@/types/workspace"
import type { FsRoot, WorkspaceFs } from "@/lib/fs"
import { computed, inject, provide, ref, watch } from "vue"
import { CELL_EXCLUDED_TYPES, cloneBlock, countChars, createBlock, createBlockId, createBookmarkBlock, createDataTableBlock, createGalleryBlock, createKanbanBlock, createLedgerBlock, createStatBlock, isReferenceBlock, isTextualBlock, retypeBlock } from "@/lib/blocks"
import { createLedgerPreset } from "@/lib/ledger"
import type { DataTable } from "@/types/data-table"
import { describeError } from "@/lib/errors"
import { parseHtml, serializeHtml } from "@/lib/html"
import type { DataTableLookup } from "@/lib/html"
import { createWorkspaceFs } from "@/lib/fs"
import { NOTE_EXTENSION, TABLE_EXTENSION, checkName, defaultExpanded, fileStem, isNoteFile, isTableFile } from "@/lib/fs/policy"
import * as table from "@/lib/table"
import { fileName, fromSegments, isUnder, joinPath, migratePath, titleOf, toCrumbs, toSegments } from "@/lib/paths"

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

/** Set 的不可变增删。ref<Set> 内部改动不会触发更新，必须换新对象。 */
function withFlag(source: ReadonlySet<string>, value: string, on: boolean): Set<string> {
  const next = new Set(source)
  if (on) next.add(value)
  else next.delete(value)
  return next
}

/**
 * 把某个目录的**直接子级**换掉，其余节点原样保留。
 *
 * 必须递归下潜才能改到嵌套目录 —— 只在顶层 `map` 一遍的话，`归档 / 子 / x` 这种
 * 目标根本找不到，表现是「移动成功但树里没动」。
 *
 * 两个必须守住的点：
 * 1. **只替换 `parentPath` 那一层的 children**，别的目录（哪怕在它下面）保持原样。
 *    `scanDir` 是单层的，它返回的文件夹一律 `children: []`；若不保住别的目录，
 *    一次根层刷新就会把所有已展开的子树清空 —— 用户眼前正在看的内容会凭空消失。
 * 2. 根（`parentPath === ""`）就是树本身，直接整体替换。
 */
function replaceChildren(nodes: FileNode[], parentPath: string, children: FileNode[]): FileNode[] {
  if (parentPath === "") return children
  return nodes.map((node) => {
    if (node.kind !== "folder") return node
    if (node.id === parentPath) return { ...node, children }
    if (node.children === undefined) return node
    const next = replaceChildren(node.children, parentPath, children)
    return next === node.children ? node : { ...node, children: next }
  })
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

  /**
   * 树拖拽的共享状态。
   *
   * 放这里而不是 `FileTree` 局部：`FileTreeNode` 是递归组件，逐层透传这两个值会让
   * 递归签名继续膨胀，且落点变化要跨层重渲染。与 `expandedIds` / `activePath` 同一个模式。
   *
   * `draggingPath` 为空串表示没有拖拽在途 —— 用空串而不是 null，与 `activePath` 一致。
   */
  const draggingPath = ref("")
  const dropTargetPath = ref("")

  const isSearching = computed(() => query.value.trim().length > 0)

  /** 搜索结果。非搜索态下原样返回，由 FileTree 按 expandedIds 决定折叠。 */
  const visibleTree = computed<FileNode[]>(() => {
    if (!isSearching.value) return tree.value
    return filterNodes(tree.value, query.value.trim().toLowerCase())
  })

  /**
   * 工作区里全部数据表的路径。
   *
   * 走**原始**树而不是 `visibleTree` —— 画册块插入对话框要在没有搜索干扰时列出全量表，
   * 搜索进行中也不该跟着变。文件树扫描只认 `.html/.htm/.tbl`，所以这里的每一项都是表。
   */
  const tablePaths = computed<string[]>(() => {
    const paths: string[] = []
    const walk = (nodes: readonly FileNode[]) => {
      for (const node of nodes) {
        if (node.kind === "table") paths.push(node.id)
        walk(node.children ?? [])
      }
    }
    walk(tree.value)
    return paths
  })

  const activeTab = computed<OpenTab | null>(
    () => tabs.value.find((tab) => tab.path === activePath.value) ?? null,
  )

  const activeDocument = computed<Block[]>(() => documents.value[activePath.value] ?? [])

  /**
   * 当前标签是不是一个数据表。
   *
   * 编辑器据此分派到两种界面之一 —— 笔记是块编辑器，数据表是表格编辑器。分开而不是
   * 让一个组件内部判分支：两者的状态、保存语义、快捷键全都不同，糅在一起会立刻变成
   * 一个到处是 `if` 的组件。
   */
  const isActiveTable = computed(() => activePath.value !== "" && isTableFile(fileName(activePath.value)))

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
    history.clear()
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

  /**
   * 重扫整棵树：应用外改动文件后手动同步用。
   *
   * 与 `adoptRoot` 的分别是**不清工作区语境** —— 标签、展开状态、搜索词都保留，
   * 重扫只替换树的形状；扫失败也保留旧树，刷新不该把还能显示的东西抹掉。
   * 已打开且无未保存改动的笔记换上新盘内容：当前激活的读成功才整体替换（不闪空），
   * 后台标签只清缓存，下次激活经 `loadDocument` 重读。改过的标签一字不动 ——
   * 未保存的工作不归刷新管；数据表的内容由 `useTables` 管，这里也不碰。
   */
  async function refreshTree() {
    const driver = fs.value
    const current = root.value
    if (driver === null || current === null || scanning.value) return
    scanning.value = true
    try {
      tree.value = await driver.scanTree(current)
      for (const tab of tabs.value) {
        if (tab.dirty || isTableFile(fileName(tab.path)) || !loadedPaths.value.has(tab.path)) continue
        if (tab.path === activePath.value) {
          try {
            documents.value[tab.path] = parseHtml(await driver.readNote(current, tab.path))
          } catch (error) {
            fsError.value = `刷新「${fileName(tab.path)}」失败：${describeError(error)}`
          }
        } else {
          loadedPaths.value = withFlag(loadedPaths.value, tab.path, false)
          delete documents.value[tab.path]
        }
      }
    } catch (error) {
      fsError.value = `读取目录失败：${describeError(error)}`
    } finally {
      scanning.value = false
    }
  }

  function dismissError() {
    fsError.value = ""
  }

  // ---- 文档 ----

  /**
   * 引用块 → 快照表格时用的数据来源。
   *
   * 由 `App.vue` 在 `provideTables` 之后接上（`attachTableLookup`）。之所以走一层间接：
   * 数据表注册表要用工作区的 driver / root，所以它依赖工作区；而保存笔记时又需要读
   * 数据表，于是工作区反过来要用它 —— 直接互相 import 会成环。用这个钩子把「用」的
   * 方向反转过来，两边各自是单向依赖。
   *
   * 缺省返回 `null`：没有接上时（自检页、单元测试）引用块写成提示态，不抛错。
   */
  const tableLookup = ref<DataTableLookup>(() => null)

  function attachTableLookup(lookup: DataTableLookup) {
    tableLookup.value = lookup
  }

  /**
   * 「把这篇笔记引用到的表都读进内存」。
   *
   * 与 `tableLookup` 分成两个钩子，因为方向不同：这个是异步的**前置动作**（读盘），
   * 那个是同步的**取值**（拼 HTML）。合成一个就得让 `blocksToHtml` 变成异步，
   * 而它是纯函数（见 `mermaidHtml` 的注释）。
   *
   * 缺省实现什么都不做：没接上时（自检页）引用块写成提示态，不影响其它块。
   */
  const preloadTables = ref<(blocks: readonly Block[]) => Promise<void>>(async () => {})

  function attachTablePreload(preload: (blocks: readonly Block[]) => Promise<void>) {
    preloadTables.value = preload
  }

  /**
   * 「把一张改过的数据表落盘」与「把一张表退回盘上真相」。
   *
   * 与上面两个钩子同一理由：工作区不能反向 import 注册表。保存标签前要把改过的表
   * 先写掉（快照取的就是内存那份，`.tbl` 不跟着落盘，盘上就有两份互相矛盾的真相），
   * 丢弃标签时要把它改过的表退回盘上 —— 这两个动作都是注册表的知识，由 `App.vue` 接上。
   * 缺省实现什么都不做：没接上时（自检页）保存/丢弃不影响其它流程。
   */
  const flushTable = ref<(path: string) => Promise<string | null>>(async () => null)

  function attachTableFlush(flush: (path: string) => Promise<string | null>) {
    flushTable.value = flush
  }

  const reloadTable = ref<(path: string) => Promise<void>>(async () => {})

  function attachTableReload(reload: (path: string) => Promise<void>) {
    reloadTable.value = reload
  }

  /**
   * 新建数据表文件时要写什么内容、怎么写。
   *
   * 与上面两个钩子同一个理由（避免工作区 ↔ 注册表互相 import 成环），只是方向不同：
   * 这里工作区是**调用方**，而内容是注册表那边的知识（一张带两列的 `DataTable`）。
   * 所以把「怎么造」与「怎么写」也做成钩子，由 `App.vue` 在 provide 之后接上。
   *
   * 拿到 `driver` 与 `root` 当参数而不是自己去取：调用点（`createInto`）已经握有
   * 它们，而写盘必须在**同一个 driver** 上发生 —— 传进来比再查一次更不容易漂。
   *
   * `null` 表示没接上 —— 那时新建数据表会失败并给出一句明确的错，而不是写一个空文件。
   */
  const tableWriter = ref<
    ((driver: WorkspaceFs, root: FsRoot, path: string, initial?: DataTable) => Promise<void>) | null
  >(null)

  function attachTableCreate(
    writer: (driver: WorkspaceFs, root: FsRoot, path: string, initial?: DataTable) => Promise<void>,
  ) {
    tableWriter.value = writer
  }

  /**
   * 读一篇笔记并解析。
   *
   * 失败也要落一个空块并标记已加载：否则标签打开后是一片虚无、每次激活还重试一次，
   * 错误提示会反复刷。读失败的真实原因留在 `fsError` 里给用户看。
   *
   * **数据表文件不走这里**：它不是块列表，解析成块没有意义。打开它由数据表编辑器
   * 自己读（`useTables.acquire`），工作区这边只负责把它记成一个已打开的标签。
   */
  async function loadDocument(path: string) {
    const driver = fs.value
    const current = root.value
    if (driver === null || current === null) return
    if (loadedPaths.value.has(path)) return
    if (isTableFile(fileName(path))) {
      // 记账但不解析 —— 数据表的正文由 `useTables` 管，不放进 `documents`。
      // 放进来的话「一篇笔记 = 一个块列表」这条不变式就被污染了。
      loadedPaths.value = withFlag(loadedPaths.value, path, true)
      return
    }

    loadingPaths.value = withFlag(loadingPaths.value, path, true)
    try {
      const source = await driver.readNote(current, path)
      // 重新读盘 = 语境重开，旧历史对新内容是错位的，必须一并作废；基线随即定格 ——
      // 不等静默窗口，否则「打开即改」的头一笔编辑会并进读盘事件里，撤销不到它。
      history.delete(path)
      documents.value[path] = parseHtml(source)
      historyOf(path)
    } catch (error) {
      history.delete(path)
      documents.value[path] = [createBlock("text")]
      historyOf(path)
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
    if (!tabs.value.some((tab) => tab.path === path)) tabs.value.push({ path, dirty: false, dirtyTables: [] })
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
    } else {
      // 丢弃：把它改过的表退回盘上真相。否则改动还挂在注册表内存里，之后任何一次
      // 保存都会把它们无声写出去 —— 「不保存」就不能只是不保存笔记那份。
      const tab = tabs.value.find((item) => item.path === path)
      for (const tablePath of tab?.dirtyTables ?? []) await reloadTable.value(tablePath)
      // 笔记正文同样要退回盘上真相：documents 里还挂着带未保存修改的块，缓存不清，
      // 重新打开只会读到内存这份 —— 「丢弃」对正文就成了空话。历史一并作废：
      // 重读盘 = 语境重开，旧历史对新内容是错位的（同 loadDocument）。
      loadedPaths.value = withFlag(loadedPaths.value, path, false)
      delete documents.value[path]
      history.delete(path)
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
   *
   * 先把这个标签改过的数据表落盘（经 `flushTable` 钩子），再落笔记本身：
   * 引用块快照取的就是内存那份，`.tbl` 不跟着写，盘上就有两份互相矛盾的「真相」。
   * 任何一张表写失败就整体中止 —— 部分成功会让「保存」失去全有全无的直觉，
   * 宁可让用户再点一次。数据表标签没有块列表，保存就是那一次落盘。
   */
  async function saveTab(path: string) {
    const driver = fs.value
    const current = root.value
    if (driver === null || current === null) return
    const tab = tabs.value.find((item) => item.path === path)
    if (tab === undefined) return

    for (const tablePath of tab.dirtyTables) {
      const error = await flushTable.value(tablePath)
      if (error !== null) {
        fsError.value = `保存数据表「${fileName(tablePath)}」失败：${error}`
        return
      }
    }

    const blocks = documents.value[path]
    if (blocks === undefined) {
      tab.dirtyTables = []
      tab.dirty = false
      return
    }

    // 引用块要写成快照，所以它引用的表必须已经在内存里。`preload` 由 App.vue 接上
    // （注册表的 `acquire`），它负责把还没读过的表读进来。读不回来（文件没了）不算
    // 错误 —— 那种情况快照本来就要写成提示态。
    await preloadTables.value(blocks)

    // 引用块在这里被写成**快照**（当前的表格内容），不是指针 —— 导出的文件要能在
    // 没有那个 `.tbl` 的地方双击打开（ADR-0005）。这一步是同步的纯查询：表已经由
    // 数据表注册表读进内存了，这里只是把内容拼进去。
    const html = serializeHtml(blocks, { title: titleOf(path) }, tableLookup.value)
    try {
      await driver.writeNote(current, path, html)
    } catch (error) {
      fsError.value = `保存「${fileName(path)}」失败：${describeError(error)}`
      return
    }
    // 写成功了才清脏态。
    tab.dirty = false
    tab.dirtyTables = []
  }

  /** 保存按钮：保存当前激活标签。 */
  async function save() {
    await saveTab(activePath.value)
  }

  /**
   * 自检页用的接缝：直接把一份 `WorkspaceFs` 与本例的根挂上来。
   *
   * 存在的理由只有一个 —— 浏览器端 `pickRoot()` 依赖用户手势与真实目录选择器，
   * 探针里拿不到；而 `create-check.html` 要验证的恰恰是「创建动作怎么编排磁盘与树」，
   * 与用哪种 driver 无关。桌面端的真实链路仍由 `pnpm tauri dev` 覆盖。
   */
  async function attachForTest(driver: WorkspaceFs, next: FsRoot) {
    fs.value = driver
    await adoptRoot(next)
  }

  // ---- 新建（见 ADR-0001 / ADR-0002）----

  /**
   * 新建动作的公共骨架：先写盘 → 再单层重扫父目录 → 替换树里那一层 → 展开父节点。
   *
   * 顺序不能调换。写盘放在最前面，失败路径上就没有任何状态被污染过，
   * 因此不需要「回滚」这个概念 —— 而回滚一次 `splice` + 一次重排本身就是易错代码。
   * 重扫期间**不置位 `scanning`**：那个 ref 的语义是「整棵树正在读取」，
   * 侧栏根名与编辑区空态都在消费它，单层刷新复用它会让整个界面闪一下。
   */
  async function createInto(parentPath: string, name: string, kind: CreateTarget["kind"]): Promise<boolean> {
    const driver = fs.value
    const current = root.value
    if (driver === null || current === null) return false

    const reason = checkName(name)
    if (reason !== null) {
      fsError.value = `新建失败：${reason}`
      return false
    }

    // 补后缀只在「文件且没写后缀」时做一次。文件夹名原样用 —— 用户给文件夹起名
    // `日记.html` 是他的自由，不该被解释成一篇笔记。
    const isFolder = kind === "folder"
    const extension = kind === "table" ? TABLE_EXTENSION : NOTE_EXTENSION
    const hasKnownExtension = isNoteFile(name) || isTableFile(name)
    const fileName = isFolder || hasKnownExtension ? name : `${name}${extension}`
    const path = joinPath(parentPath, fileName)
    /**
     * 冲突检测问**两个**路径。
     *
     * 用户看到的是「日记」这个名字，而磁盘上是 `日记.html` 或目录 `日记` —— 两回事。
     * 只查补完后缀的那个（文件侧）会漏掉同名文件夹；只查原名（文件夹侧）会漏掉
     * `日记.html`。两边都问一次，才是用户以为的那个「已存在」。
     *
     * 数据表按同一口径查：`客户.tbl` 与 `客户.html` 是两个**不同的文件**（ADR-0005
     * 撤回了「树上合并同名两项」的想法），所以这里也必须真的问一次，而不是靠后缀
     * 不同就放行 —— 否则新建 `客户.tbl` 而 `客户.html` 已存在时用户会看到两个同名项，
     * 那正是他要求撤回的那种困惑。
     */
    const barePath = isFolder ? joinPath(parentPath, fileStem(name)) : joinPath(parentPath, name)

    try {
      if ((await driver.exists(current, path)) || (await driver.exists(current, barePath))) {
        fsError.value = `新建失败：已存在「${fileName}」`
        return false
      }
      if (isFolder) {
        await driver.createFolder(current, path)
      } else if (kind === "table") {
        // 初始内容由数据表那边给（一张带两列的空表）。这里不直接 import 注册表 ——
        // 方向是注册表依赖工作区，反过来引用会成环。走 `tableWriter` 这个钩子。
        const write = tableWriter.value
        if (write === null) throw new Error("数据表写入通道未接上")
        await write(driver, current, path)
      } else {
        await driver.createNote(current, path, serializeHtml([createBlock("text")], { title: titleOf(path) }))
      }
    } catch (error) {
      fsError.value = `新建「${fileName}」失败：${describeError(error)}`
      return false
    }

    // 盘上已经建好了，从这里往下都是纯前端状态同步，不会再失败。
    try {
      tree.value = replaceChildren(tree.value, parentPath, await driver.scanDir(current, parentPath))
    } catch (error) {
      // 树没刷出来不影响盘上的事实，报一句让用户手动重开目录即可。
      fsError.value = `新建成功，但刷新目录失败：${describeError(error)}`
    }
    if (parentPath !== "") expandedIds.value = withFlag(expandedIds.value, parentPath, true)
    if (!isFolder) openFile(path)
    return true
  }

  /** 在 `parentPath` 下新建一篇笔记。 */
  function createNoteIn(parentPath: string, name: string): Promise<boolean> {
    return createInto(parentPath, name, "note")
  }

  /** 在 `parentPath` 下新建一个文件夹。 */
  function createFolderIn(parentPath: string, name: string): Promise<boolean> {
    return createInto(parentPath, name, "folder")
  }

  /** 在 `parentPath` 下新建一个数据表。 */
  function createTableIn(parentPath: string, name: string): Promise<boolean> {
    return createInto(parentPath, name, "table")
  }

  // ---- 移动（见 ADR-0003）----

/** 取一个路径的父目录。根层节点返回空串。 */
  function parentOfPath(path: string): string {
    const segments = toSegments(path)
    return fromSegments(segments.slice(0, -1))
  }

  /**
   * 把一条路径迁移牵连到的**所有**以路径为键的前端状态一起换键。
   *
   * `migratePath` 同时覆盖等值与前缀两种情况，所以整个目录改名时它下面开着的
   * 标签、读进内存的文档、展开着的子目录一起跟着走，不会留下悬空键。
   */
  function migrateKeys(from: string, to: string) {
    tabs.value = tabs.value.map((tab) => ({
      ...tab,
      path: migratePath(tab.path, from, to),
      // 标签记名的脏数据表也要跟着换：`.tbl` 在改名的目录下时，旧键已经写不回去了。
      dirtyTables: tab.dirtyTables.map((path) => migratePath(path, from, to)),
    }))
    activePath.value = migratePath(activePath.value, from, to)
    expandedIds.value = new Set([...expandedIds.value].map((id) => migratePath(id, from, to)))
    loadedPaths.value = new Set([...loadedPaths.value].map((path) => migratePath(path, from, to)))
    loadingPaths.value = new Set([...loadingPaths.value].map((path) => migratePath(path, from, to)))
    documents.value = Object.fromEntries(
      Object.entries(documents.value).map(([path, blocks]) => [migratePath(path, from, to), blocks]),
    )
  }

  /**
   * 把 `from`（一个 Note）移到 `destFolder`（空串 = 工作区根）。
   *
   * 只搬文件，不搬文件夹，也不表达到同级顺序 —— 磁盘目录没有顺序（ADR-0003）。
   *
   * 与 `createInto` 同一个骨架：先动盘 → 再刷树 → 最后同步前端状态。失败路径不污染任何
   * 状态，所以没有回滚。区别是移动会影响**两个**目录，两边都要重扫。
   */
  async function moveFileTo(from: string, destFolder: string): Promise<boolean> {
    const driver = fs.value
    const current = root.value
    if (driver === null || current === null) return false

    const name = fileName(from)
    if (parentOfPath(from) === destFolder) return false

    const to = joinPath(destFolder, name)
    try {
      if (await driver.exists(current, to)) {
        fsError.value = `移动失败：目标位置已有「${name}」`
        return false
      }
      await driver.move(current, from, to)
    } catch (error) {
      fsError.value = `移动「${name}」失败：${describeError(error)}`
      return false
    }

    // 盘上已经搬完了，从这里往下是纯前端同步。两个父目录都要重扫。
    //
    // 顺序有讲究：**先刷源、后刷目标**都得避开「整体替换根层」这一步毁掉已加载的子树。
    // `replaceChildren` 现在只动命中那一层，所以两个方向都安全。
    const sourceParent = parentOfPath(from)
    try {
      for (const dir of new Set([sourceParent, destFolder])) {
        tree.value = replaceChildren(tree.value, dir, await driver.scanDir(current, dir))
      }
    } catch (error) {
      fsError.value = `移动成功，但刷新目录失败：${describeError(error)}`
    }
    if (destFolder !== "") expandedIds.value = withFlag(expandedIds.value, destFolder, true)

    /**
     * 键迁移。五个以路径为键的状态必须一起换，否则会留下指向旧路径的悬空项：
     * 标签还开着但文档取不到、已加载集判定「没读过」而重读、激活项指向不存在的标签。
     */
    migrateKeys(from, to)

    return true
  }

  // ---- 重命名与删除 ----

  /**
   * 当前有未落盘改动的数据表路径。
   *
   * 改名/删目录对脏数据表是危险的：表的内容以**旧路径**记在注册表里，路径一变，
   * 之后任何一次保存都会把改动写向一个已经不存在的位置 —— 浏览器端 `writeNote` 甚至会
   * 把删掉的文件原样写回来。所以这两个动作前置拦下受影响的脏表，让用户先保存或丢弃。
   */
  function dirtyTablePaths(): Set<string> {
    const dirty = new Set<string>()
    for (const tab of tabs.value) {
      if (tab.dirty && isTableFile(fileName(tab.path))) dirty.add(tab.path)
      for (const tablePath of tab.dirtyTables) dirty.add(tablePath)
    }
    return dirty
  }

  /**
   * 把一个文件或文件夹改名（只换名字，不换父级）。
   *
   * 与 `createInto` 同一个骨架：校验 → 前置查冲突 → 动盘 → 刷树 → 换键。冲突口径也
   * 同一条（ADR-0002）：补完后缀的路径与用户输入的裸名字都查，重名直接拒绝。
   *
   * 名字没变视为成功 —— 对话框正常关闭，不动盘也不刷树。
   */
  async function renameFile(path: string, name: string, kind: CreateTarget["kind"]): Promise<boolean> {
    const driver = fs.value
    const current = root.value
    if (driver === null || current === null) return false

    const reason = checkName(name)
    if (reason !== null) {
      fsError.value = `重命名失败：${reason}`
      return false
    }

    // 后缀补全与 `createInto` 同一条规则：文件夹名原样用，文件没写后缀补上。
    const isFolder = kind === "folder"
    const extension = kind === "table" ? TABLE_EXTENSION : NOTE_EXTENSION
    const hasKnownExtension = isNoteFile(name) || isTableFile(name)
    const finalName = isFolder || hasKnownExtension ? name : `${name}${extension}`
    const to = joinPath(parentOfPath(path), finalName)
    if (to === path) return true

    for (const tablePath of dirtyTablePaths()) {
      if (!isUnder(tablePath, path)) continue
      fsError.value = `重命名失败：「${fileName(tablePath)}」有未保存的修改，先保存或丢弃再试`
      return false
    }

    const barePath = isFolder ? joinPath(parentOfPath(path), fileStem(name)) : joinPath(parentOfPath(path), name)
    try {
      if ((await driver.exists(current, to)) || (await driver.exists(current, barePath))) {
        fsError.value = `重命名失败：已存在「${finalName}」`
        return false
      }
      await driver.rename(current, path, to)
    } catch (error) {
      fsError.value = `重命名「${fileName(path)}」失败：${describeError(error)}`
      return false
    }

    try {
      tree.value = replaceChildren(tree.value, parentOfPath(path), await driver.scanDir(current, parentOfPath(path)))
    } catch (error) {
      fsError.value = `重命名成功，但刷新目录失败：${describeError(error)}`
    }
    migrateKeys(path, to)
    return true
  }

  /**
   * 删除一个文件或文件夹（文件夹连同其下全部内容）。
   *
   * 受影响标签直接关闭（含脏的 —— 未保存的修改随确认框里的说明一并丢弃）；
   * 脏数据表则在动盘之前拦下，理由见 `dirtyTablePaths`。
   */
  async function deleteFile(path: string): Promise<boolean> {
    const driver = fs.value
    const current = root.value
    if (driver === null || current === null) return false

    for (const tablePath of dirtyTablePaths()) {
      if (!isUnder(tablePath, path)) continue
      fsError.value = `删除失败：「${fileName(tablePath)}」有未保存的修改，先保存或丢弃再试`
      return false
    }

    try {
      await driver.remove(current, path)
    } catch (error) {
      fsError.value = `删除「${fileName(path)}」失败：${describeError(error)}`
      return false
    }

    const parent = parentOfPath(path)
    try {
      tree.value = replaceChildren(tree.value, parent, await driver.scanDir(current, parent))
    } catch (error) {
      fsError.value = `删除成功，但刷新目录失败：${describeError(error)}`
    }

    // 盘上已经删掉了，从这里往下是纯前端清理：关标签、清文档缓存、摘掉各集合里的键。
    for (const tab of [...tabs.value]) {
      if (isUnder(tab.path, path)) closeTab(tab.path)
    }
    for (const key of Object.keys(documents.value)) {
      if (isUnder(key, path)) delete documents.value[key]
    }
    loadedPaths.value = new Set([...loadedPaths.value].filter((key) => !isUnder(key, path)))
    loadingPaths.value = new Set([...loadingPaths.value].filter((key) => !isUnder(key, path)))
    expandedIds.value = new Set([...expandedIds.value].filter((key) => !isUnder(key, path)))
    return true
  }

  function markDirty(dirty = true) {
    const tab = activeTab.value
    if (tab) tab.dirty = dirty
  }

  /**
   * 数据表内容被改：记到**当前激活标签**名下，与笔记编辑共用同一个保存出口。
   * 在笔记里改（引用块 / 画册）记到那篇笔记头上，在数据表编辑页改记到表自己头上 ——
   * 谁的界面里发生的改动归谁，关标签时的保存 / 丢弃提示才有准确的归属。
   */
  function markTableDirty(tablePath: string) {
    const tab = activeTab.value
    if (tab === null) return
    if (!tab.dirtyTables.includes(tablePath)) tab.dirtyTables.push(tablePath)
    tab.dirty = true
  }

  // ---- 撤销 / 重做 ----

  /**
   * 文档级历史，按路径各记一份。快照存深拷贝而不是 JSON 字符串 —— 恢复时直接把
   * `Block[]` 塞回 `documents`，不经 `JSON.parse` 的 any，类型门不破。
   *
   * 记录走「基线推进」：基线是上一次定格的状态，深观察等到编辑静默（500ms 无新改动）
   * 后把基线压进 `past`、基线换成现状。连续打字因此合并成一步；块级操作（插入 / 删除 /
   * 拖拽 / 转换）各自落在自己的静默段里，天然各成一步。上限 100 步，够回溯一段工作流。
   *
   * 撤销 / 重做把块整体换回旧快照，但块 id 不变 —— BlockItem 的 contenteditable 是
   * 非受控的，props 原地换对象不会重画 DOM。`restoreTick` 供编辑器拼进 `:key`，
   * 撤销后整表重挂，强制按数据重画。
   */
  type DocHistory = { past: Block[][]; future: Block[][]; baseline: Block[] }

  const history = new Map<string, DocHistory>()
  const restoreTick = ref(0)
  const HISTORY_LIMIT = 100
  let historyTimer: number | undefined

  /** 当前文档的独立深拷。 */
  function snapshotOf(path: string): Block[] {
    return (documents.value[path] ?? []).map((block) => cloneBlock(block, block.id))
  }

  /** 取路径的历史，没有就现开一份 —— 基线取当下的快照，首笔改动从它起算。 */
  function historyOf(path: string): DocHistory {
    const existing = history.get(path)
    if (existing !== undefined) return existing
    const fresh: DocHistory = { past: [], future: [], baseline: snapshotOf(path) }
    history.set(path, fresh)
    return fresh
  }

  /** 把「当前相对基线的变化」定格成一步。相同则不动（撤销回写、无变化触发）。 */
  function recordHistory(path: string) {
    const entry = historyOf(path)
    const current = snapshotOf(path)
    if (JSON.stringify(current) === JSON.stringify(entry.baseline)) return
    entry.past.push(entry.baseline)
    if (entry.past.length > HISTORY_LIMIT) entry.past.shift()
    entry.baseline = current
    entry.future = []
  }

  watch(
    () => documents.value[activePath.value],
    () => {
      // 带上触发那一刻的路径：定时器到点时用户可能已切走标签，记错文档就乱套了。
      const path = activePath.value
      if (path === "") return
      window.clearTimeout(historyTimer)
      historyTimer = window.setTimeout(() => recordHistory(path), 500)
    },
    { deep: true },
  )

  function undo() {
    // 静默计时还没到就按撤销：先把手里这段编辑定格，否则它会整段被跳过。
    window.clearTimeout(historyTimer)
    historyTimer = undefined
    const path = activePath.value
    if (path === "") return
    recordHistory(path)
    const entry = history.get(path)
    if (entry === undefined || entry.past.length === 0) return
    const previous = entry.past.pop()
    if (previous === undefined) return
    entry.future.push(snapshotOf(path))
    entry.baseline = previous.map((block) => cloneBlock(block, block.id))
    documents.value[path] = previous
    markDirty()
    restoreTick.value += 1
  }

  function redo() {
    window.clearTimeout(historyTimer)
    historyTimer = undefined
    const path = activePath.value
    if (path === "") return
    recordHistory(path)
    const entry = history.get(path)
    if (entry === undefined || entry.future.length === 0) return
    const next = entry.future.pop()
    if (next === undefined) return
    entry.past.push(snapshotOf(path))
    entry.baseline = next.map((block) => cloneBlock(block, block.id))
    documents.value[path] = next
    markDirty()
    restoreTick.value += 1
  }

  // ---- 块级操作。全部收敛在这里，组件只负责触发与聚焦 ----

  /**
   * 按 id 定位一个块：返回它**所在的块列表与下标**。
   *
   * 顶层文档找不着就下潜到布局块的格子里找 —— 格子各自持有块列表（ADR-0007），
   * 而增删改的写法都是「拿到列表引用后 splice」，所以定位出列表引用，格子内块的
   * 一切操作就与顶层块共用同一套函数，不需要平行的第二套 API。
   *
   * 异步回调里块可能已被删除，返回 null 是正常路径而非异常（与 `activeBlock` 同一立场）。
   */
  function locateBlock(id: string): { list: Block[]; index: number } | null {
    const blocks = activeDocument.value
    const index = blocks.findIndex((item) => item.id === id)
    if (index !== -1) return { list: blocks, index }
    for (const block of blocks) {
      if (block.type !== "layout") continue
      for (const cell of block.cells) {
        const at = cell.findIndex((item) => item.id === id)
        if (at !== -1) return { list: cell, index: at }
      }
    }
    return null
  }

  /**
   * 在当前文档里按 id 取块。
   *
   * 一律走它而不是自己 `find`：图片读文件、表格单元格回读这类**异步**回调里，
   * 块可能在 await 期间已被删除，拿到 undefined 是正常路径而非异常。
   * 格子内的块（布局块容器里）同样找得到。
   */
  function activeBlock(id: string): Block | undefined {
    const at = locateBlock(id)
    return at === null ? undefined : at.list[at.index]
  }

  function setBlockRuns(id: string, runs: InlineRun[]) {
    const block = activeBlock(id)
    if (block === undefined || !isTextualBlock(block)) return
    block.runs = runs
    markDirty()
  }

  /**
   * 把 `[from, to]` 的块区间整体换成一个块：类型 `type`、正文 `runs`，返回新块 id。
   * 跨块删除用它 —— 不能拆成「转类型 + 改 runs + 逐个删」走 id 型 API：
   * `retypeBlock` 会换新 id（`createBlockId`），后面的调用按旧 id 找不到块就静默落空。
   * 一次 splice 一拍完成，撤销历史里自然是一步。
   */
  function mergeBlockRange(from: number, to: number, type: BlockType, runs: InlineRun[]): string {
    const blocks = activeDocument.value
    const source = blocks[from]
    if (source === undefined || to < from) return ""
    const merged = retypeBlock(source, type)
    // 调用方传入的类型只会是正文类型（锚/焦块的类型或 text），runs 一定是它的形态。
    if (isTextualBlock(merged)) merged.runs = runs
    blocks.splice(from, to - from + 1, merged)
    markDirty()
    return merged.id
  }

  /**
   * 更新引用块(画册 / 书签 / 看板)的展示设置。改动的是**笔记文档**
   * （块属性随笔记保存，ADR-0006），不是 `.tbl` —— 多篇笔记引用同一张表时，
   * 各自的展示设置互不相干。patch 只带改动的键：菜单里每档设置各管各的，
   * 不必整包重建。
   *
   * 曾经每种引用块一个逐字相同的 update 函数,每加一种块就多一个名字进公共
   * interface;现在一个函数收口,patch 形状见 `BlockSettingsPatch`,
   * `isReferenceBlock` 守卫保证设置写不进别的块。
   */
  function updateBlockSettings(id: string, patch: BlockSettingsPatch) {
    const block = activeBlock(id)
    if (block === undefined || !isReferenceBlock(block)) return
    Object.assign(block, patch)
    markDirty()
  }

  function toggleBlockChecked(id: string) {
    const block = activeBlock(id)
    if (block === undefined || block.type !== "todo") return
    block.checked = !block.checked
    markDirty()
  }

  /** 往**指定**的块列表插入新块，越界夹到两端。顶层与格子共用这一条路。 */
  function insertIntoList(list: Block[], index: number, type: BlockType): string {
    const block = createBlock(type)
    const at = Math.min(Math.max(index, 0), list.length)
    list.splice(at, 0, block)
    markDirty()
    return block.id
  }

  /** 在 `index` 处插入新块，越界夹到两端。拖入图片要按落点插，不能只支持「追加」。 */
  function insertBlockAt(index: number, type: BlockType): string {
    return insertIntoList(activeDocument.value, index, type)
  }

  /**
   * 在当前笔记里插入一个数据表引用块。
   *
   * 与其它块的区别是它**不能只造一个空块**：引用块必须指向一个真实存在的 `.tbl`，
   * 否则插进去就是一个永远读不到的提示态。所以这里同时做两件事：
   *
   * - `path` 为空时：在当前笔记旁边**新建**一个 `.tbl`，默认名取当前笔记的名字主干
   *   （`客户.html` 里新建 → `客户.tbl`），撞名则不新建、直接引用已存在的那个。
   * - `path` 非空时：直接引用它（工作区里已经有的表）。
   *
   * 返回新建块的 id，调用方（菜单）拿它做聚焦。
   */
  async function insertDataTableBlock(index: number, target = ""): Promise<string> {
    const blocks = activeDocument.value
    const notePath = activePath.value

    let path = target
    if (path === "") {
      const resolved = await resolveDataTableForNote(notePath)
      // 解析不出来（没有工作区、用户取消、写盘失败）就不插块 —— 留一个读不到的
      // 引用块比什么都不做更糟，用户会以为已经建好了。
      path = resolved.path
      if (path === "") return ""
    }

    const block = createDataTableBlock(path)
    const at = Math.min(Math.max(index, 0), blocks.length)
    blocks.splice(at, 0, block)
    markDirty()
    return block.id
  }

  /**
   * 在当前笔记里插入一个画册块。
   *
   * 与 `insertDataTableBlock` 同构,差别在入口:画册块由**对话框**先行确定目标 ——
   * - `target` 非空:直接引用工作区里已有的那张表。
   * - `target` 为空:按 `stem`(用户在对话框里起的名)在当前笔记旁边新建一张,
   *   撞名则直接引用已有的 —— 与数据表的新建规则同一条,「再给我一份同名副本」
   *   不会是任何人的本意。
   */
  async function insertGalleryBlock(index: number, target = "", stem = ""): Promise<string> {
    const blocks = activeDocument.value
    const notePath = activePath.value

    let path = target
    if (path === "") {
      path = (await resolveDataTableForNote(notePath, stem)).path
      if (path === "") return ""
    }

    const block = createGalleryBlock(path)
    const at = Math.min(Math.max(index, 0), blocks.length)
    blocks.splice(at, 0, block)
    markDirty()
    return block.id
  }

  /**
   * 在当前笔记里插入一个书签块。与 `insertGalleryBlock` 完全同构：
   * 先有表才有块，`target` 为空时按 `stem` 新建、撞名直接引用。
   */
  async function insertBookmarkBlock(index: number, target = "", stem = ""): Promise<string> {
    const blocks = activeDocument.value
    const notePath = activePath.value

    let path = target
    if (path === "") {
      path = (await resolveDataTableForNote(notePath, stem)).path
      if (path === "") return ""
    }

    const block = createBookmarkBlock(path)
    const at = Math.min(Math.max(index, 0), blocks.length)
    blocks.splice(at, 0, block)
    markDirty()
    return block.id
  }

  /**
   * 在当前笔记里插入一个看板块。与 `insertBookmarkBlock` 完全同构:
   * 先有表才有块,`target` 为空时按 `stem` 新建、撞名直接引用。
   */
  async function insertKanbanBlock(index: number, target = "", stem = ""): Promise<string> {
    const blocks = activeDocument.value
    const notePath = activePath.value

    let path = target
    if (path === "") {
      path = (await resolveDataTableForNote(notePath, stem)).path
      if (path === "") return ""
    }

    const block = createKanbanBlock(path)
    const at = Math.min(Math.max(index, 0), blocks.length)
    blocks.splice(at, 0, block)
    markDirty()
    return block.id
  }

  /** 在当前笔记里插入一个统计块。与看板块同构:先有表才有块,`target` 为空时按 `stem` 新建、撞名直接引用。 */
  async function insertStatBlock(index: number, target = "", stem = ""): Promise<string> {
    const blocks = activeDocument.value
    const notePath = activePath.value

    let path = target
    if (path === "") {
      path = (await resolveDataTableForNote(notePath, stem)).path
      if (path === "") return ""
    }

    const block = createStatBlock(path)
    const at = Math.min(Math.max(index, 0), blocks.length)
    blocks.splice(at, 0, block)
    markDirty()
    return block.id
  }

  /**
   * 在当前笔记里插入一个账目块。与看板块同构(先有表才有块,`target` 为空时按 `stem`
   * 新建、撞名直接引用),差别在**新建**那一步:预置 `日期 / 摘要 / 收入 / 支出` 四列
   * 写盘,并把收入 / 支出列指到预置列上 —— 三种记账场景开箱即录,不用先去设置里挑列。
   * 撞名引用已有表时不指列(id 对不上别人的列),视图走「未设置」提示态让用户自己挑。
   */
  async function insertLedgerBlock(index: number, target = "", stem = ""): Promise<string> {
    const blocks = activeDocument.value
    const notePath = activePath.value

    let block = createLedgerBlock(target)
    if (target === "") {
      const preset = createLedgerPreset()
      const resolved = await resolveDataTableForNote(notePath, stem, preset.table)
      if (resolved.path === "") return ""
      // 只有真的新建才按预置列指好金额列;撞名引用的是别人的表,id 对不上。
      block = resolved.created
        ? createLedgerBlock(resolved.path, preset.incomeColumnId, preset.expenseColumnId)
        : createLedgerBlock(resolved.path)
    }

    const at = Math.min(Math.max(index, 0), blocks.length)
    blocks.splice(at, 0, block)
    markDirty()
    return block.id
  }

  /**
   * 把已有块**原地转换**成数据表引用块或画册块,返回新块 id(失败返回空串)。
   *
   * 转换与插入遵守同一条规则:**先有文件才能指**。`/` 菜单与手柄的「转换为」走的是
   * 这条路,不接规则的话落下的就是 `path` 为空串的引用块 —— 视图会永远停在
   * 「正在读取」。解析不出路径就不转换,原块保持原样。
   */
  async function convertBlockToFileType(
    id: string,
    type: "datatable" | "gallery" | "bookmark" | "kanban" | "ledger" | "stat",
    target = "",
    stem = "",
  ): Promise<string> {
    const blocks = activeDocument.value
    const index = blocks.findIndex((item) => item.id === id)
    if (index === -1) return ""

    let path = target
    if (path === "") {
      path = (await resolveDataTableForNote(activePath.value, stem)).path
      if (path === "") return ""
    }

    const block =
      type === "gallery"
        ? createGalleryBlock(path)
        : type === "bookmark"
          ? createBookmarkBlock(path)
          : type === "kanban"
            ? createKanbanBlock(path)
            : type === "ledger"
              ? createLedgerBlock(path)
              : type === "stat"
                ? createStatBlock(path)
                : createDataTableBlock(path)
    blocks[index] = block
    markDirty()
    return block.id
  }

  /**
   * 给一篇笔记找一张可引用的表。
   *
   * 规则只有两条，且**撞名不新建**：`客户.html` 里插数据表时，如果 `客户.tbl` 已经
   * 存在，就引用它 —— 用户的意思显然是「我那张表」，而不是「再给我一份同名副本」。
   * 这正是「在 Note 中创建数据表」的一个自然特例。
   *
   * `stem` 可指定名字主干：画册块的「新建表…」允许用户自己起名，不跟笔记同名。
   *
   * `initial` 可指定新建时的初始内容（账目块的预置四列从这里来）；撞名引用已有表时
   * 它被无视 —— 不能往别人已有的表里塞列。返回 `created` 让调用方区分两种落点：
   * 只有**真的新建**才谈得上「按预置列指好金额列」，撞名引用留给用户自己挑。
   */
  async function resolveDataTableForNote(notePath: string, stem = "", initial?: DataTable): Promise<{ path: string; created: boolean }> {
    const driver = fs.value
    const current = root.value
    if (driver === null || current === null) return { path: "", created: false }

    const parent = parentOfPath(notePath)
    const name = stem === "" ? fileStem(fileName(notePath)) : stem
    const candidate = joinPath(parent, `${name}${TABLE_EXTENSION}`)

    try {
      if (await driver.exists(current, candidate)) return { path: candidate, created: false }
    } catch (error) {
      fsError.value = `检查数据表失败：${describeError(error)}`
      return { path: "", created: false }
    }

    const write = tableWriter.value
    if (write === null) {
      fsError.value = "数据表写入通道未接上"
      return { path: "", created: false }
    }
    try {
      await write(driver, current, candidate, initial)
    } catch (error) {
      fsError.value = `新建数据表「${name}${TABLE_EXTENSION}」失败：${describeError(error)}`
      return { path: "", created: false }
    }

    // 盘上建好了，把它刷进树 —— 不刷的话用户看不到新文件，会以为是失败了。
    try {
      tree.value = replaceChildren(tree.value, parent, await driver.scanDir(current, parent))
    } catch (error) {
      fsError.value = `数据表已建好，但刷新目录失败：${describeError(error)}`
    }
    return { path: candidate, created: true }
  }

  function insertBlockAfter(id: string, type: BlockType): string {
    const at = locateBlock(id)
    // 找不到（块已被删）退化为追加到文档末尾 —— 与原型行为一致。
    if (at === null) return insertIntoList(activeDocument.value, activeDocument.value.length, type)
    return insertIntoList(at.list, at.index + 1, type)
  }

  /** 与 `insertBlockAfter` 对偶：插在当前块前面，共用同一条定位与兜底路径。 */
  function insertBlockBefore(id: string, type: BlockType): string {
    const at = locateBlock(id)
    if (at === null) return insertIntoList(activeDocument.value, activeDocument.value.length, type)
    return insertIntoList(at.list, at.index, type)
  }

  function appendBlock(type: BlockType): string {
    return insertBlockAt(activeDocument.value.length, type)
  }

  function changeBlockType(id: string, type: BlockType) {
    const at = locateBlock(id)
    const current = at === null ? undefined : at.list[at.index]
    if (at === null || current === undefined) return
    // 一层容器（ADR-0007）：格子内不再嵌布局块。UI 菜单在格子内已把它滤掉，
    // 这里再挡一道是防程序化路径（快捷键、未来的批量操作）漏进来。
    if (type === "layout" && at.list !== activeDocument.value) return
    at.list[at.index] = retypeBlock(current, type)
    markDirty()
  }

  function duplicateBlock(id: string) {
    const at = locateBlock(id)
    const source = at === null ? undefined : at.list[at.index]
    if (at === null || source === undefined) return
    at.list.splice(at.index + 1, 0, cloneBlock(source, createBlockId()))
    markDirty()
  }

  /**
   * 把一个块移进布局格子（拖拽落格的唯一写入口）。
   *
   * 允许谁进格子由 `CELL_EXCLUDED_TYPES` 单独说了算 —— 与格子内插入菜单的过滤是
   * 同一份名单（当前放行 stat），不另立第二份会腐烂的清单。容器块（一层容器）
   * 与布局块自己不能进格子；已在目标格子里的块没有「再进一次」的语义，放过。
   */
  function moveBlockIntoCell(layoutId: string, cellIndex: number, blockId: string) {
    const layout = activeBlock(layoutId)
    if (layout === undefined || layout.type !== "layout") return
    if (blockId === layoutId) return
    const cell = layout.cells[cellIndex]
    if (cell === undefined) return

    const at = locateBlock(blockId)
    const block = at === null ? undefined : at.list[at.index]
    if (at === null || block === undefined) return
    if (CELL_EXCLUDED_TYPES.some((type) => type === block.type)) return
    if (at.list === cell) return

    at.list.splice(at.index, 1)
    cell.push(block)
    markDirty()
  }

  /**
   * 给统计块换指向的数据表。列 id 属于旧表 —— 换表必须一并清掉求和列，
   * 让视图退回「未选择」，而不是拿旧表的列 id 去新表里碰运气。
   */
  function bindStatTable(id: string, path: string) {
    const block = activeBlock(id)
    if (block === undefined || block.type !== "stat") return
    block.path = path
    block.columnId = ""
    delete block.filterColumnId
    delete block.filterValue
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

  // ---- 聊天记录 ----

  /**
   * 整体替换聊天记录块的消息列表。
   *
   * 消息没有单独的「改一条」通道 —— 编辑以气泡为粒度（改文本 / 换角色 / 删除 /
   * 追加），每次都从视图算出完整的新列表交回来，与表格几何操作「整体回写」同一立场。
   */
  function setChatMessages(id: string, messages: ChatMessage[]) {
    const block = activeBlock(id)
    if (block === undefined || block.type !== "chat") return
    block.messages = messages
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

  /** 设置某一列的对齐。整列一起写 —— 对齐在模型里是列属性，UI 也只给「列」这一档。 */
  function setTableColumnAlign(id: string, column: number, align: TableAlign) {
    applyTable(id, (rows) => table.setColumnAlign(rows, column, align))
  }

  function removeBlock(id: string) {
    const at = locateBlock(id)
    if (at === null) return
    at.list.splice(at.index, 1)
    // 顶层文档至少保留一个空块，否则光标无处落；格子删空同样补一个空文本块，
    // 否则格子成了无处聚焦的空壳，序列化出来的空 section 也无处落光标。
    if (at.list.length === 0) at.list.push(createBlock("text"))
    markDirty()
  }

  // ---- 布局块 ----

  /**
   * 选定布局方式（网格/弹性）。`cells` 为空说明是刚插入的未初始化块，
   * 顺手铺两个格子（各含一个空文本块）—— 光标有处落，选择器不再出现。
   * 已有格子的块切模式只换容器排布，格子内容原样保留。
   */
  function setLayoutMode(id: string, mode: LayoutMode) {
    const block = activeBlock(id)
    if (block === undefined || block.type !== "layout") return
    block.mode = mode
    if (block.cells.length === 0) block.cells = [createLayoutCell(), createLayoutCell()]
    markDirty()
  }

  /** 一个新格子：一个空文本块起底 —— 空格子无处聚焦，也没法敲回车往上长。 */
  function createLayoutCell(): Block[] {
    return [createBlock("text")]
  }

  /** 改网格列数（2..4）。档位由设置菜单保证，这里照单收下。 */
  function setLayoutColumns(id: string, columns: number) {
    const block = activeBlock(id)
    if (block === undefined || block.type !== "layout") return
    block.columns = columns
    markDirty()
  }

  /** 末尾追加一个格子。 */
  function addLayoutCell(id: string) {
    const block = activeBlock(id)
    if (block === undefined || block.type !== "layout") return
    block.cells.push(createLayoutCell())
    markDirty()
  }

  /**
   * 删一个格子（默认末尾，传入下标则删那一格）。只剩一格时拒绝 ——
   * 布局块至少要有一个格子，删光了它就成了无法进入的空壳。
   * 删掉的格子内容随格子一起消失：删除是明确的破坏性动作，不搞「内容上提」的猜法。
   */
  function removeLayoutCell(id: string, index = Number.MAX_SAFE_INTEGER) {
    const block = activeBlock(id)
    if (block === undefined || block.type !== "layout" || block.cells.length <= 1) return
    const at = Math.min(Math.max(index, 0), block.cells.length - 1)
    block.cells.splice(at, 1)
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
    isActiveTable,
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
    refreshTree,
    dismissError,
    attachForTest,
    // 读写通道与根目录：数据表注册表（`useTables`）要用同一对，否则两个 composable
    // 会各自持有一份驱动引用，切目录时对不齐。
    fs,
    root,
    attachTableLookup,
    attachTablePreload,
    attachTableFlush,
    attachTableReload,
    attachTableCreate,
    // file actions
    openFile,
    activateTab,
    closeTab,
    requestCloseTab,
    resolveClose,
    cancelPendingClose,
    toggleFolder,
    save,
    saveTab,
    markDirty,
    markTableDirty,
    createNoteIn,
    createFolderIn,
    createTableIn,
    moveFileTo,
    renameFile,
    deleteFile,
    // tree drag state
    draggingPath,
    dropTargetPath,
    // block actions
    setBlockRuns,
    mergeBlockRange,
    toggleBlockChecked,
    insertBlockAfter,
    insertBlockBefore,
    insertBlockAt,
    insertDataTableBlock,
    insertGalleryBlock,
    insertBookmarkBlock,
    insertKanbanBlock,
    insertLedgerBlock,
    insertStatBlock,
    convertBlockToFileType,
    updateBlockSettings,
    tablePaths,
    appendBlock,
    changeBlockType,
    duplicateBlock,
    removeBlock,
    moveBlock,
    moveBlockIntoCell,
    bindStatTable,
    // layout actions
    setLayoutMode,
    setLayoutColumns,
    addLayoutCell,
    removeLayoutCell,
    // image actions
    setImageSource,
    // mermaid actions
    setMermaidSource,
    // chat actions
    setChatMessages,
    // table actions
    defineTable,
    setTableCellRuns,
    insertTableRow,
    removeTableRow,
    insertTableColumn,
    removeTableColumn,
    setTableHeaderRow,
    setTableColumnAlign,
    // undo / redo
    undo,
    redo,
    restoreTick,
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
