import type { InjectionKey, Ref } from "vue"
import type { Block, BlockSettingsPatch, BlockType, ChatMessage, CloseStrategy, CreateTarget, FileNode, InlineRun, LayoutMode, OpenTab, PlaylistSource, TableAlign, TableCell } from "@/types/workspace"
import type { FsRoot, WorkspaceFs } from "@/lib/fs"
import { computed, inject, provide, ref, watch } from "vue"
import { CELL_EXCLUDED_TYPES, REFERENCE_INSERT_SPEC, cloneBlock, countChars, createBlock, createBlockId, isReferenceBlock, isTextualBlock, refPathsOf, retypeBlock } from "@/lib/blocks"
import type { ReferenceBlock, ReferenceBlockType } from "@/lib/blocks"
import type { DataTable } from "@/types/data-table"
import { describeError } from "@/lib/errors"
import { parseNote, serializeHtml } from "@/lib/html"
import type { DataTableLookup } from "@/lib/html"
import { createWorkspaceFs } from "@/lib/fs"
import { linkTargetOf } from "@/lib/link"
import { openExternalUrl } from "@/lib/open-external"
import { createPlaylistPreset, createPlaylistSource } from "@/lib/playlist"
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

/** 深度优先遍历整棵树（含递归目录）。整合视图与引用扫描共用同一条走法。 */
function eachNode(nodes: readonly FileNode[], visit: (node: FileNode) => void): void {
  for (const node of nodes) {
    visit(node)
    if (node.kind === "folder") eachNode(node.children ?? [], visit)
  }
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

/**
 * 工作区要用数据表注册表做的五件事 —— 一条**端口**。
 *
 * 注册表要用工作区的 driver / root（它依赖工作区），而保存笔记时要读表（工作区反过来
 * 要用它），直接互相 import 会成环。`App.vue` 在两边都建好之后把适配器递进来一次，
 * 依赖方向于是各自单向；自检页不接，五项各自退化成「什么都不做」，引用块写成提示态。
 *
 * 五项的顺序不能合：
 * - `preload` 是异步的**前置动作**（读盘），`peek` 是同步的**取值**（拼快照）——
 *   合成一个就得让 `blocksToHtml` 变成异步，而它是纯函数。
 * - `flush` / `reload` / `create` 是写盘动作：保存前落盘、丢弃时退回盘上真相、新建表。
 */
export interface TableRegistry {
  /** 把一批表读进内存。保存前调用，让随后的 `peek` 拿得到内容。 */
  preload(paths: readonly string[]): Promise<void>
  /** 同步取一张表的内容。读不到（没读过、文件没了）返回 `null`。 */
  peek(path: string): DataTable | null
  /** 把一张改过的表落盘。返回错误描述；`null` 表示写成功或本来就没改过。 */
  flush(path: string): Promise<string | null>
  /** 把一张表退回盘上真相 —— 丢弃标签时用。 */
  reload(path: string): Promise<void>
  /** 新建一张 `.tbl`。`initial` 缺省时由注册表给默认内容。 */
  create(driver: WorkspaceFs, root: FsRoot, path: string, initial?: DataTable): Promise<void>
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
  /**
   * 每篇笔记的页面级 CSS（`<head>` 里 `<style data-note-style>` 的内容，按路径各一份）。
   *
   * 与 `documents` 分开存而不是塞进块列表：它是**文档级**的东西，不是块 —— 塞进块列表
   * 就得为它造一个「不是块」的块类型，解析器、拖拽、菜单全要为它开特例（见 ADR-0011）。
   * 生命周期与 `documents` 严格对齐：一起读、一起存、一起丢、一起改名。
   */
  const styles = ref<Record<string, string>>({})
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
   * 整合数据表视图的引用映射：笔记路径 → 它引用的 `.tbl` 路径。
   *
   * 只在偏好打开时维护。树形状一变就重算（见 `attachIntegrateTables`）；
   * 盘上解析结果按路径缓存一份，避免每次新建 / 移动都把整个库重读一遍。
   * 已打开且读过盘的笔记以内存里的块为准 —— 用户刚改过的引用不必等保存就生效。
   */
  const noteTableRefs = ref<Record<string, string[]>>({})

  /** 引用扫描的盘上缓存。换库、手动刷新时整份作废。 */
  const refCache = new Map<string, string[]>()

  /** 偏好 ref 在 `App.vue` 里经 `attachIntegrateTables` 接上；没接上就是关闭态。 */
  let integrateEnabled: Ref<boolean> | null = null

  /** 扫描代币：树在扫描期间又变了，旧结果直接丢弃。 */
  let refsEpoch = 0

  /**
   * 重算「笔记 → 引用的表」。只收当前树里真实存在的表 —— 引用失效（表被移走或删了）
   * 不往树上挂幽灵行，与引用块渲染成提示态是同一立场。
   */
  async function refreshNoteTableRefs() {
    const epoch = ++refsEpoch
    const driver = fs.value
    const current = root.value
    if (integrateEnabled?.value !== true || driver === null || current === null) {
      noteTableRefs.value = {}
      return
    }

    const notes: string[] = []
    const tables = new Set<string>()
    eachNode(tree.value, (node) => {
      if (node.kind === "note") notes.push(node.id)
      else if (node.kind === "table") tables.add(node.id)
    })

    const live = new Set(notes)
    for (const path of refCache.keys()) if (!live.has(path)) refCache.delete(path)

    const next: Record<string, string[]> = {}
    for (const path of notes) {
      if (epoch !== refsEpoch) return
      const open = documents.value[path]
      let refs: string[] | undefined = open === undefined ? refCache.get(path) : refPathsOf(open)
      if (refs === undefined) {
        try {
          refs = refPathsOf(parseNote(await driver.readNote(current, path)).blocks)
        } catch {
          // 读不回来（权限、外部删除）就跳过这篇 —— 整棵树不该因为一篇坏文件长不出来。
          continue
        }
        refCache.set(path, refs)
      }
      const resolved = refs.filter((tablePath) => tables.has(tablePath))
      if (resolved.length > 0) next[path] = resolved
    }
    if (epoch !== refsEpoch) return
    noteTableRefs.value = next
  }

  /**
   * 接上「整合数据表视图」这个偏好。与 `attachStore` 同一个模式：工作区在根组件里
   * 先于设置创建，不能直接 `inject` 设置，只能由 `App.vue` 把 ref 递进来。
   */
  function attachIntegrateTables(enabled: Ref<boolean>) {
    integrateEnabled = enabled
    // 偏好切换与树变化都重算；`immediate` 兜「启动时偏好已是开」的情况。
    watch([enabled, tree], () => void refreshNoteTableRefs(), { immediate: true })
  }

  /**
   * 真正给文件树看的树。
   *
   * 整合视图只改**呈现**：被任何笔记引用的表从原位置摘掉，挂到引用它的笔记名下
   * （同一张表可以被多篇笔记各挂一份）；笔记节点始终带 `refs`（可能为空数组），
   * 这是「后缀该不该隐」的判据。没开偏好时原样返回搜索结果。
   */
  const displayTree = computed<FileNode[]>(() => {
    if (integrateEnabled?.value !== true) return visibleTree.value

    const tables = new Map<string, FileNode>()
    eachNode(tree.value, (node) => {
      if (node.kind === "table") tables.set(node.id, node)
    })

    const referenced = new Set<string>()
    for (const paths of Object.values(noteTableRefs.value)) {
      for (const path of paths) referenced.add(path)
    }

    // 搜索时只保留「笔记名隐后缀」，不再把表从原位置收走、也不往笔记下挂引用：
    // 搜索是一张扁平命中表，把命中的表藏进某篇笔记里等于让它搜不到。
    const folding = !isSearching.value

    const build = (nodes: readonly FileNode[]): FileNode[] => {
      const result: FileNode[] = []
      for (const node of nodes) {
        if (node.kind === "table") {
          if (!folding || !referenced.has(node.id)) result.push(node)
          continue
        }
        if (node.kind === "folder") {
          const children = node.children ?? []
          const next = build(children)
          // 只隐藏「原来有内容、现在被整合吃空」的文件夹；盘上本来就空的文件夹
          // 保持原样 —— 树仍要如实反映磁盘，不替用户删目录。
          if (children.length > 0 && next.length === 0) continue
          result.push({ ...node, children: next })
          continue
        }
        const refs: FileNode[] = []
        for (const path of folding ? noteTableRefs.value[node.id] ?? [] : []) {
          const table = tables.get(path)
          if (table !== undefined) refs.push(table)
        }
        result.push({ ...node, refs })
      }
      return result
    }

    return build(visibleTree.value)
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

  /** 当前激活笔记的页面级 CSS。没有写过时为空串。 */
  const activeStyle = computed<string>(() => styles.value[activePath.value] ?? "")

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
    styles.value = {}
    history.clear()
    loadedPaths.value = new Set()
    loadingPaths.value = new Set()
    expandedIds.value = new Set()
    // 换库 = 换语境：上一个库的引用解析结果对新树里的同名路径不成立。
    refCache.clear()
    noteTableRefs.value = {}
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
      // 手动刷新等于「盘上内容可能被应用外改过」：引用缓存整份作废，逐篇重读。
      refCache.clear()
      for (const tab of tabs.value) {
        if (tab.dirty || isTableFile(fileName(tab.path)) || !loadedPaths.value.has(tab.path)) continue
        if (tab.path === activePath.value) {
          try {
            const note = parseNote(await driver.readNote(current, tab.path))
            documents.value[tab.path] = note.blocks
            styles.value[tab.path] = note.style
          } catch (error) {
            fsError.value = `刷新「${fileName(tab.path)}」失败：${describeError(error)}`
          }
        } else {
          loadedPaths.value = withFlag(loadedPaths.value, tab.path, false)
          delete documents.value[tab.path]
          delete styles.value[tab.path]
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

  /** 数据表注册表端口。`null` = 还没接上（自检页 / 单元测试）。 */
  const registry = ref<TableRegistry | null>(null)

  function attachTableRegistry(next: TableRegistry) {
    registry.value = next
  }

  /** 引用块 → 快照表格时的数据来源。没接上时返回 `null`，序列化写成提示态。 */
  const lookupTable: DataTableLookup = (path) => registry.value?.peek(path) ?? null

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
      const note = parseNote(await driver.readNote(current, path))
      // 重新读盘 = 语境重开，旧历史对新内容是错位的，必须一并作废；基线随即定格 ——
      // 不等静默窗口，否则「打开即改」的头一笔编辑会并进读盘事件里，撤销不到它。
      history.delete(path)
      documents.value[path] = note.blocks
      styles.value[path] = note.style
      historyOf(path)
    } catch (error) {
      history.delete(path)
      documents.value[path] = [createBlock("text")]
      styles.value[path] = ""
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

  /**
   * 行内链接的跳转。判定收在 `linkTargetOf`（正文块与表格格子共用那份结论）：
   * 工作区里的笔记 / 数据表在应用内开标签，带 scheme 的地址交给系统浏览器。
   *
   * 打不开的原因一律写进 `fsError`：点一下链接毫无反应，是这堆状态里最难自查的一种
   * 失败 —— 用户分不清是链接坏了、还是自己点歪了。目标存在与否必须问盘（`exists`），
   * 不能拿树去猜：树是启动时扫的，别的编辑器新存的文件不在里面。
   */
  async function followLink(href: string) {
    const target = linkTargetOf(href)
    if (target.kind === "none") return
    if (target.kind === "external") {
      await openExternalUrl(target.url)
      return
    }
    if (target.kind === "unsupported") {
      fsError.value = `链接指向的不是笔记或数据表：${target.href}`
      return
    }
    const driver = fs.value
    const current = root.value
    if (driver === null || current === null) {
      fsError.value = "还没有打开工作区，打不开链接指向的文档"
      return
    }
    let exists = false
    try {
      exists = await driver.exists(current, target.path)
    } catch (error) {
      fsError.value = `检查「${target.path}」失败：${describeError(error)}`
      return
    }
    if (!exists) {
      fsError.value = `工作区里没有「${target.path}」`
      return
    }
    openFile(target.path)
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
      for (const tablePath of tab?.dirtyTables ?? []) await registry.value?.reload(tablePath)
      // 笔记正文同样要退回盘上真相：documents 里还挂着带未保存修改的块，缓存不清，
      // 重新打开只会读到内存这份 —— 「丢弃」对正文就成了空话。历史一并作废：
      // 重读盘 = 语境重开，旧历史对新内容是错位的（同 loadDocument）。
      loadedPaths.value = withFlag(loadedPaths.value, path, false)
      delete documents.value[path]
      delete styles.value[path]
      history.delete(path)
      // 丢弃 = 退回盘上真相：引用关系也要按盘上那份重算。
      refCache.delete(path)
      void refreshNoteTableRefs()
    }
    closeTab(path)
  }

  /** 取消关闭（按钮、Esc、点遮罩都走这里）。 */
  function cancelPendingClose() {
    pendingClosePath.value = null
  }

  /** 折叠 / 展开一个节点。文件夹与「整合视图里挂了引用的笔记」共用这一个集合。 */
  function toggleExpanded(id: string) {
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
      const error = (await registry.value?.flush(tablePath)) ?? null
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
    await registry.value?.preload(refPathsOf(blocks))

    // 引用块在这里被写成**快照**（当前的表格内容），不是指针 —— 导出的文件要能在
    // 没有那个 `.tbl` 的地方双击打开（ADR-0005）。这一步是同步的纯查询：表已经由
    // 数据表注册表读进内存了，这里只是把内容拼进去。
    const html = serializeHtml(blocks, { title: titleOf(path), style: styles.value[path] ?? "" }, lookupTable)
    try {
      await driver.writeNote(current, path, html)
    } catch (error) {
      fsError.value = `保存「${fileName(path)}」失败：${describeError(error)}`
      return
    }
    // 写成功了才清脏态。
    tab.dirty = false
    tab.dirtyTables = []
    // 引用关系可能刚被改过：整合视图立刻跟上，不必等下一次树变化。
    refCache.delete(path)
    void refreshNoteTableRefs()
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
        // 方向是注册表依赖工作区，反过来引用会成环。走 `TableRegistry` 这层端口。
        const tables = registry.value
        if (tables === null) throw new Error("数据表注册表未接上")
        await tables.create(driver, current, path)
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
    styles.value = Object.fromEntries(
      Object.entries(styles.value).map(([path, css]) => [migratePath(path, from, to), css]),
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
    for (const key of Object.keys(styles.value)) {
      if (isUnder(key, path)) delete styles.value[key]
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

  /**
   * 视图态:歌单块「当前看哪一张」(块上的 `path`)。
   *
   * 切换歌单只是换个看法(`setPlaylistActive` 不记脏),撤销栈也就不能把它当一步 ——
   * 否则切两张之后按 Ctrl+Z,展示莫名其妙被切回去,而用户改的字一个都没回来。
   * 撤销栈是整篇的全量快照,所以两头都收:比较时抹掉它(纯切换不定格成一步),
   * 恢复后按恢复前的当前值补回去(撤销别的改动不会顺手换掉你正在看的那张)。
   *
   * 按块 id 对齐。补不上的照快照里那份走(`playlistActivePath` 会兜底到第一张):
   * 块被转换过就换过 id,布局格子里的子块每次拷贝也换新 id —— 那两种情形本来
   * 就没有稳定的 id 可对。
   */
  type ViewState = Map<string, string>

  /** 块列表(含布局格子)里各歌单块的当前展示路径。 */
  function viewStateOf(blocks: readonly Block[]): ViewState {
    const state: ViewState = new Map()
    const visit = (list: readonly Block[]): void => {
      for (const block of list) {
        if (block.type === "layout") {
          for (const cell of block.cells) visit(cell)
          continue
        }
        if (block.type === "playlist") state.set(block.id, block.path)
      }
    }
    visit(blocks)
    return state
  }

  /**
   * 把视图态补回一份快照(就地改)。快照出栈后不再被历史引用,就地改是安全的;
   * 调用方负责拿到的是一份独占的拷贝。
   */
  function applyViewState(blocks: Block[], state: ViewState): void {
    const visit = (list: Block[]): void => {
      for (const block of list) {
        if (block.type === "layout") {
          for (const cell of block.cells) visit(cell)
          continue
        }
        if (block.type !== "playlist") continue
        const path = state.get(block.id)
        if (path !== undefined) block.path = path
      }
    }
    visit(blocks)
  }

  /** 比较用的指纹:视图态抹平,只切了歌单的两份快照在这里完全相同。 */
  function historySignature(blocks: readonly Block[]): string {
    const blanked = (list: readonly Block[]): unknown[] =>
      list.map((block) => {
        if (block.type === "layout") return { ...block, cells: block.cells.map(blanked) }
        if (block.type === "playlist") return { ...block, path: "" }
        return block
      })
    return JSON.stringify(blanked(blocks))
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
    if (historySignature(current) === historySignature(entry.baseline)) return
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
    // 视图态不随撤销走:补回当前正在看的那张歌单,再让快照成为文档。
    applyViewState(previous, viewStateOf(documents.value[path] ?? []))
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
    applyViewState(next, viewStateOf(documents.value[path] ?? []))
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
    if (list !== activeDocument.value) dropCellStarter(list, block.id)
    markDirty()
    return block.id
  }

  /**
   * 格子里的起底空文本块只为「格子不空、光标有处落」而生：新块一进来它就失业了，
   * 留着是一块永远多出来的占位（永远出现在内容旁边、删了也不像删干净）。所以
   * 仅当「另一个块就是它」时把它顶掉 —— 列表超过两块、或空文本块里有字，
   * 都说明不是起底块，不动。
   */
  function dropCellStarter(list: Block[], keepId: string) {
    if (list.length !== 2) return
    const starter = list.find((item) => item.id !== keepId)
    if (starter === undefined || starter.type !== "text") return
    if (starter.runs.length > 0) return
    list.splice(list.indexOf(starter), 1)
  }

  /** 在 `index` 处插入新块，越界夹到两端。拖入图片要按落点插，不能只支持「追加」。 */
  function insertBlockAt(index: number, type: BlockType): string {
    return insertIntoList(activeDocument.value, index, type)
  }

  /**
   * 在当前笔记里插入一个引用块。
   *
   * 引用块**不能只造一个空块**：它必须指向一个真实存在的 `.tbl`，否则插进去就是一个
   * 永远读不到的提示态。所以这条流程总是两件事：`target` 为空时先按 `stem`（缺省取
   * 当前笔记的名字主干）在笔记旁边新建一张表，撞名则直接引用已有的那个 —— 用户的意思
   * 显然是「我那张表」，不是「再给我一份同名副本」；拿到路径再落块。
   *
   * 各类型的差别只有「引用已有表造什么块、新建表时拿什么起手」，收在
   * `REFERENCE_INSERT_SPEC` 里。这条流程不按类型分叉 —— 新增一种引用块只加一条表项。
   *
   * 返回新块的 id，调用方（菜单 / 对话框）拿它做聚焦；解析不出路径时返回空串、不插块
   * （没有工作区、写盘失败），原文档保持不动。
   */
  async function insertReferenceBlock(index: number, type: ReferenceBlockType, target = "", stem = ""): Promise<string> {
    const blocks = activeDocument.value
    const spec = REFERENCE_INSERT_SPEC[type]

    let block: ReferenceBlock
    if (target === "") {
      const preset = spec.preset?.()
      const resolved = await resolveDataTableForNote(activePath.value, stem, preset?.table)
      if (resolved.path === "") return ""
      // 只有真的新建了表，预置列的 id 才可信；撞名引用别人的表时走不带列的形态。
      block = preset !== undefined && resolved.created ? preset.create(resolved.path) : spec.create(resolved.path)
    } else {
      block = spec.create(target)
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
    type: ReferenceBlockType,
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

    // 转换不带预置表：转换的目标是「换一个形态」，不是「顺手替我起一张表」。
    const block = REFERENCE_INSERT_SPEC[type].create(path)
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

    const tables = registry.value
    if (tables === null) {
      fsError.value = "数据表注册表未接上"
      return { path: "", created: false }
    }
    try {
      await tables.create(driver, current, candidate, initial)
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

  /**
   * 给歌单块新建一张(或复用同名的)歌单表,返回可用的绑定项。
   *
   * 表落在当前笔记旁边,名字取用户给的;撞名时**复用**已有的那张 —— 与插入引用块
   * 同一条规则(`客户.html` 里插数据表就认准 `客户.tbl`)。只有真的新建了才带上
   * 预置列的 id:复用别人的表时那些 id 在它里面并不存在,留空交给自动识别更诚实。
   *
   * 返回 `null` = 没工作区 / 写盘失败,调用方保持块的绑定不变。
   */
  async function createPlaylistTable(name: string): Promise<PlaylistSource | null> {
    const preset = createPlaylistPreset()
    const resolved = await resolveDataTableForNote(activePath.value, name, preset.table)
    if (resolved.path === "") return null
    return resolved.created
      ? createPlaylistSource(resolved.path, preset.roles)
      : createPlaylistSource(resolved.path)
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

  /**
   * 换块类型，返回**转换后那个块的 id**。
   *
   * 转换是换一个块（`retypeBlock` 生成新 id），不是改同一个块的类型 —— 调用方要聚焦 /
   * 要接着操作，都得按返回值找。拿旧 id 找只会落空：块还在，按 id 却查不到，
   * 表现是「转换完光标没了」。转换被拒（块不存在 / 格子内想嵌布局块）时返回 null。
   */
  function changeBlockType(id: string, type: BlockType): string | null {
    const at = locateBlock(id)
    const current = at === null ? undefined : at.list[at.index]
    if (at === null || current === undefined) return null
    // 一层容器（ADR-0007）：格子内不再嵌布局块。UI 菜单在格子内已把它滤掉，
    // 这里再挡一道是防程序化路径（快捷键、未来的批量操作）漏进来。
    if (type === "layout" && at.list !== activeDocument.value) return null
    const next = retypeBlock(current, type)
    at.list[at.index] = next
    markDirty()
    return next.id
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
    // 拖入与插入同一特例：起底空文本块被拖进来的块顶掉（见 dropCellStarter）。
    dropCellStarter(cell, block.id)
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

  /**
   * 给歌单块换一组绑定(切换歌单 / 追加绑定 / 解除绑定)。
   *
   * `sources` 与 `path` 必须**一起**改:块上那条不变式是「path 恒等于 sources 中
   * 某一项」,分开写会留下「已经切到一张解除掉的表」这种半截状态。所以它不走
   * `updateBlockSettings` —— 那条路按设计不带 path。
   *
   * 空列表**不动**:一块歌单至少绑一张表,解到空没有意义(要清掉就删块)。
   * `path` 不在列表里时退到第一项 —— 与解析端的兜底同一个口径。
   */
  function setPlaylistSources(id: string, sources: PlaylistSource[], path: string) {
    const block = activeBlock(id)
    if (block === undefined || block.type !== "playlist") return
    if (sources.length === 0) return
    block.sources = sources.map((source) => ({ ...source }))
    block.path = block.sources.some((source) => source.path === path) ? path : (block.sources[0]?.path ?? "")
    markDirty()
  }

  /**
   * 切换歌单块**当前展示**哪一张表。
   *
   * 这是视图动作,不是改内容 —— 与块内搜索同一立场(ADR-0005:视图状态别当数据),
   * 所以**不** `markDirty`:标签不亮脏点,关标签也不为「只是看了看另一张歌单」弹保存提示。
   *
   * 选择仍然记在块的 `path` 上:这篇笔记因为别的改动保存时,它顺带写进
   * `data-playlist`,下次打开还是这一张。只切不存就关标签,则回到上次落盘的那张 ——
   * 视图动作不落盘,是这条取舍的代价,而不是漏写。
   *
   * 不在 `sources` 里的路径不接:块上那条不变式(「path 恒等于 sources 中某一项」)
   * 由 `setPlaylistSources` 独占,这里只允许在已绑定的几张之间挪动。
   */
  function setPlaylistActive(id: string, path: string) {
    const block = activeBlock(id)
    if (block === undefined || block.type !== "playlist") return
    if (block.path === path) return
    if (!block.sources.some((source) => source.path === path)) return
    block.path = path
  }

  // ---- 图片 ----

  /** 换图。`src` 是 URL 或 data URI（本地文件走 `readImageFile`）。 */
  function setImageSource(id: string, src: string) {
    const block = activeBlock(id)
    if (block === undefined || block.type !== "image") return
    block.src = src
    markDirty()
  }

  // ---- 代码块 ----

  /**
   * 改代码块的语言标识。
   *
   * 只影响**怎么读**这段文字（语法高亮），不动正文 —— 所以和 `setBlockRuns` 分开：
   * 编辑态里换语言不该把还没提交的草稿写进文档。
   * 空串表示纯文本，序列化时 `language-` 前缀整个不写（与解析端的宽容读取对称）。
   */
  function setBlockLang(id: string, lang: string) {
    const block = activeBlock(id)
    if (block === undefined || block.type !== "code") return
    if ((block.lang ?? "") === lang) return
    block.lang = lang
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

  // ---- 自定义 HTML ----

  /**
   * 改 HTML 块的原文。
   *
   * 与 `setMermaidSource` 同一立场：**不校验内容** —— 用户打到一半的 HTML 是常态，
   * 此时报错等于不让人保存；渲染不出由 iframe 自己呈现（浏览器对坏标记宽容），
   * 原文照存。
   */
  function setHtmlSource(id: string, source: string) {
    const block = activeBlock(id)
    if (block === undefined || block.type !== "html") return
    block.source = source
    markDirty()
  }

  // ---- 页面级 CSS ----

  /**
   * 改当前笔记的页面级 CSS（ADR-0011）。
   *
   * 与块正文同一个保存出口（`saveTab` 写进 `<head>`），也共用脏态。**不进撤销历史**：
   * 历史记的是块列表的快照，为一份 CSS 再造一条并行的撤销栈，成本远大于收益。
   * 编辑器里改错了就再打开一次重写 —— 抽屉提交前是原文，取消即没有改动。
   */
  function setNoteStyle(css: string) {
    const path = activePath.value
    if (path === "" || isTableFile(fileName(path))) return
    if ((styles.value[path] ?? "") === css) return
    styles.value[path] = css
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
    displayTree,
    query,
    isSearching,
    expandedIds,
    tabs,
    activePath,
    // derived
    activeTab,
    activeDocument,
    activeStyle,
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
    attachTableRegistry,
    // 整合数据表视图：偏好由 `App.vue` 递进来，工作区自己不认识设置模块。
    attachIntegrateTables,
    // file actions
    openFile,
    followLink,
    activateTab,
    closeTab,
    requestCloseTab,
    resolveClose,
    cancelPendingClose,
    toggleExpanded,
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
    insertReferenceBlock,
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
    // playlist actions
    setPlaylistSources,
    setPlaylistActive,
    createPlaylistTable,
    // layout actions
    setLayoutMode,
    setLayoutColumns,
    addLayoutCell,
    removeLayoutCell,
    // image actions
    setImageSource,
    // code actions
    setBlockLang,
    // mermaid actions
    setMermaidSource,
    // html actions
    setHtmlSource,
    // page style
    setNoteStyle,
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
