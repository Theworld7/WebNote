import type { InjectionKey, Ref } from "vue"
import type { DataColumnType, DataRow, DataTable } from "@/types/data-table"
import type { FsRoot, WorkspaceFs } from "@/lib/fs"
import { inject, provide, ref } from "vue"
import * as dt from "@/lib/data-table"
import { describeError } from "@/lib/errors"
import { TABLE_EXTENSION, fileStem, isTableFile } from "@/lib/fs/policy"

/**
 * 数据表注册表。
 *
 * 这个 composable 存在的理由是**共享**：同一张表可能被多篇笔记引用，而「多篇笔记里的
 * 是同一张表」这句话必须在运行时也成立，否则编辑一处、另一处不更新，就退化成了副本。
 *
 * 于是有一张按路径索引的注册表，**同一个路径永远映射到同一个响应式对象**。任何引用了
 * 它的视图读到的都是同一份数据，一处改动立刻反映到所有视图 —— 比数据库的锁语义更强，
 * 因为根本不存在「两个副本要对齐」这件事。
 *
 * 与 `useWorkspace` 的 `documents` 的分别值得说清：那边 `Record<path, Block[]>` 是
 * **按需读入的副本**，因为一篇笔记只被一个标签页打开，没有共享语义。这里的表是
 * **共享实体**，语义不同，所以状态也分开。
 *
 * 三个设计点：
 *
 * 1. **注册表本身是 `shallowRef` 之外的普通对象**，而每张表是 `ref`。表内部要深度响应
 *    （改一个格子要重渲染），但「有哪些表」不需要被追踪 —— 引用计数与增删都是我们自己
 *    触发的，靠 `revision` 计数器通知视图。
 * 2. **读失败是有状态的结果**，不是异常。引用块要能区分「没读」「读失败」「表不存在」，
 *    因为三者的提示文案不同，而「文件不存在」是这个功能里的**正常状态**（可能被移走了）。
 * 3. **写盘整体替换**。没有行级增量写 —— 一次改一个格子也写整个文件。这符合这个项目的
 *    尺度（本地文件、用户自己点保存），换来的是「盘上永远是一份完整一致的 JSON」。
 */

/** 一张表在某处的加载状态。 */
export type TableLoadState = "idle" | "loading" | "loaded" | "missing" | "failed"

export interface TableEntry {
  /** 已解析的表。`null` 表示还没读到（或读失败）。 */
  table: Ref<DataTable | null>
  state: Ref<TableLoadState>
  /** 读失败或文件不存在时的原因。给用户看。 */
  message: Ref<string>
}

function createTables(driver: Ref<WorkspaceFs | null>, root: Ref<FsRoot | null>) {
  /**
   * 按路径索引的条目。用普通 `Map` 而不是响应式的：条目的值是 `ref`，响应性在条目内部。
   * 对外暴露的 `entries` 是让视图能对「有哪些表」做响应式查询的只读视图。
   */
  const registry = new Map<string, TableEntry>()

  /** 「有哪些表」的版本号。注册表本身不响应，靠它在增删时通知订阅者。 */
  const revision = ref(0)

  /** 引用计数：哪些路径正被某个视图用着。归零不卸载 —— 表很小，而卸载会让切标签丢状态。 */
  const references = ref(new Map<string, number>())

  function entryOf(path: string): TableEntry {
    const existing = registry.get(path)
    if (existing !== undefined) return existing
    const entry: TableEntry = {
      table: ref<DataTable | null>(null),
      state: ref<TableLoadState>("idle"),
      message: ref(""),
    }
    registry.set(path, entry)
    revision.value += 1
    return entry
  }

  /** 读一张表。已加载或正在加载则跳过 —— 重复调用不会重复读盘。 */
  async function load(path: string): Promise<void> {
    const fsDriver = driver.value
    const current = root.value
    // driver 还没就绪（`bootstrap` 之前）：**不留条目**。留一个空条目会让视图
    // 一直停在「正在读取」，而它其实一次都没试过 —— 那种状态无法自愈，因为
    // 没有「driver 就绪了再读一遍」的触发点。提前返回则下次 `use` / `preload`
    // 会重新走一遍，那时 driver 已经有了。
    if (fsDriver === null || current === null) return

    const entry = entryOf(path)
    if (entry.state.value === "loading" || entry.state.value === "loaded") return

    entry.state.value = "loading"
    try {
      const text = await fsDriver.readNote(current, path)
      entry.table.value = dt.tableFromJson(text)
      entry.state.value = "loaded"
      entry.message.value = ""
    } catch (error) {
      // 分不清「文件没了」与「文件坏了」是两个不同的提示，得分开。
      // 先探存在性：`exists` 是各实现都有的前置查询（ADR-0002），一次读盘换一句
      // 准确的文案，值得。
      let missing = false
      try {
        missing = !(await fsDriver.exists(current, path))
      } catch {
        missing = false
      }
      entry.table.value = null
      entry.state.value = missing ? "missing" : "failed"
      entry.message.value = describeError(error)
    }
  }

  /** 强制重读。文件在盘上被外部改过时用（目前没有「重新加载」入口，留给以后）。 */
  async function reload(path: string): Promise<void> {
    const entry = registry.get(path)
    if (entry !== undefined) {
      entry.state.value = "idle"
      entry.table.value = null
    }
    await load(path)
  }

  /**
   * 取一张表，必要时读盘。视图挂载时调它。
   *
   * 返回的 `entry` 是**响应式的引用**：调用方把 `entry.table` 直接当数据源用，
   * 读到更新会自动重渲染。这正是「多个视图共享同一张表」得以成立的地方。
   *
   * driver 未就绪时也返回条目（调用方要有个东西可以绑），只是它停在白板态；
   * 等 driver 就绪后再次 `use` / `preload` 会补上读盘。
   */
  async function acquire(path: string): Promise<TableEntry> {
    const entry = entryOf(path)
    await load(path)
    return entry
  }

  /** 释放一个引用。计数归零不卸载数据 —— 表很小，重读一次不值得。 */
  function release(path: string): void {
    const counts = new Map(references.value)
    const next = (counts.get(path) ?? 1) - 1
    if (next <= 0) counts.delete(path)
    else counts.set(path, next)
    references.value = counts
  }

  function retain(path: string): void {
    const counts = new Map(references.value)
    counts.set(path, (counts.get(path) ?? 0) + 1)
    references.value = counts
  }

  /** 同步查询，只给「已经在内存里」的表。导出快照用它 —— 那里不能 await。 */
  function peek(path: string): DataTable | null {
    return registry.get(path)?.table.value ?? null
  }

  /**
   * 把一篇笔记里引用到的表都读进内存。保存笔记前调它，让随后的 `peek` 拿得到内容。
   *
   * 逐个 `await` 而不是 `Promise.all`：一张笔记通常只引一两张表，顺序读的代码更直白，
   * 也避免同一目录被并发访问（浏览器端的句柄在并发下更容易出问题）。
   * 读不回来不算失败 —— 快照会写成提示态，那是预期内的结果。
   */
  async function preload(paths: readonly string[]): Promise<void> {
    for (const path of paths) {
      if (peek(path) !== null) continue
      await load(path)
    }
  }

  // ---- 编辑操作（全是整体替换 + 写盘）----

  /**
   * 写回一张表。
   *
   * 入参 `next` 是**算好的新表**，而不是一个修改函数：调用方（视图或 `mutate`）
   * 拿到 `DataTable` 之后自己决定怎么改，这里只负责落盘。这样每个编辑动作都是
   * `lib/data-table.ts` 里的一个纯函数，可以单独测。
   */
  async function write(path: string, next: DataTable, errorSink: Ref<string>): Promise<boolean> {
    const fsDriver = driver.value
    const current = root.value
    if (fsDriver === null || current === null) return false

    const entry = entryOf(path)
    const previous = entry.table.value
    entry.table.value = next
    try {
      await fsDriver.writeNote(current, path, dt.tableToJson(next))
      return true
    } catch (error) {
      // 写失败要**回退内存**：留着未落盘的数据会让用户以为改成功了。
      entry.table.value = previous
      errorSink.value = `保存数据表「${path}」失败：${describeError(error)}`
      return false
    }
  }

  /**
   * 以一个纯函数改一张表并落盘。所有编辑动作的统一入口。
   *
   * 视图层不必各自记住「先改内存、再写盘、失败回退」这套顺序 —— 它只在这里一处。
   */
  async function mutate(
    path: string,
    change: (table: DataTable) => DataTable,
    errorSink: Ref<string>,
  ): Promise<boolean> {
    const entry = entryOf(path)
    const table = entry.table.value
    if (table === null) return false
    const next = change(table)
    if (next === table) return true
    return write(path, next, errorSink)
  }

  /** 新建一个数据表文件。名字冲突由调用方前置检查（与 `createInto` 同一套）。 */
  async function create(path: string, initial: DataTable, errorSink: Ref<string>): Promise<boolean> {
    const fsDriver = driver.value
    const current = root.value
    if (fsDriver === null || current === null) return false
    try {
      await fsDriver.createNote(current, path, dt.tableToJson(initial))
      // 盘上建好了就把内存里那份填上，免得紧接着的读又跑一趟。
      const entry = entryOf(path)
      entry.table.value = initial
      entry.state.value = "loaded"
      entry.message.value = ""
      return true
    } catch (error) {
      errorSink.value = `新建数据表「${path}」失败：${describeError(error)}`
      return false
    }
  }

  /**
   * 往一个路径写一份新表，同时把内存里那份也填上。
   *
   * 与 `create` 的分别是**不自己拿 driver** —— 调用方（`createInto`）已经持有它了，
   * 而它那一刻的 driver 与这里的是同一个。共用一份内存填充逻辑，避免「新建成功但
   * 内存里还是空的」这种不一致。
   */
  function adopt(path: string, table: DataTable): void {
    const entry = entryOf(path)
    entry.table.value = table
    entry.state.value = "loaded"
    entry.message.value = ""
  }

  /** 默认的列，新建表时用。 */
  function defaultTable(): DataTable {
    return dt.createEmptyTable(["名称", "数值"])
  }

  return {
    revision,
    references,
    /** 读一张表并用着（引用计数 +1）。视图 `onMounted` 调。 */
    async use(path: string): Promise<TableEntry> {
      retain(path)
      return acquire(path)
    },
    release,
    peek,
    preload,
    reload,
    mutate,
    create,
    adopt,
    defaultTable,
    /** 序列化 —— 工作区新建数据表时用它写初始内容。 */
    toJson: (table: DataTable): string => dt.tableToJson(table),
    isTablePath: (path: string): boolean => isTableFile(path),
    stemOf: (path: string): string => fileStem(path),
    extension: TABLE_EXTENSION,
  }
}

export type TablesStore = ReturnType<typeof createTables>

const KEY: InjectionKey<TablesStore> = Symbol("webnote:tables")

export function provideTables(driver: Ref<WorkspaceFs | null>, root: Ref<FsRoot | null>): TablesStore {
  const store = createTables(driver, root)
  provide(KEY, store)
  return store
}

export function useTables(): TablesStore {
  const store = inject(KEY)
  if (store === undefined) throw new Error("useTables 必须在 provideTables 之后使用")
  return store
}

/**
 * 一个表里的某一列取值，给视图做排序 / 求和这类读操作。
 *
 * 导出成独立函数而不是放进 composable：它和 `lib/data-table.ts` 里的那些纯函数同类，
 * 只是需要 `computed` 之外的地方也能调。
 */
export function columnValues(table: DataTable, columnId: string): (row: DataRow) => string | number | boolean | null {
  const column = table.columns.find((item) => item.id === columnId)
  if (column === undefined) return () => null
  return (row) => dt.cellValue(row, column)
}

/** 列类型的可选项，设置菜单用。 */
export const COLUMN_TYPES: readonly DataColumnType[] = ["text", "number", "date", "select", "checkbox"]

export { dt as dataTableOps }
