import type { InjectionKey, Ref } from "vue"
import type { DataColumnType, DataRow, DataTable } from "@/types/data-table"
import type { FsRoot, WorkspaceFs } from "@/lib/fs"
import type { VaultEnvelope, VaultKey } from "@/lib/vault"
import { inject, provide, ref } from "vue"
import * as dt from "@/lib/data-table"
import { createVault, decryptVaultWithKey, deriveKeyForEnvelope, readVaultEnvelope, resealVault, vaultText } from "@/lib/vault"
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
 * 2. **读失败是有状态的结果**，不是异常。引用块要能区分「没读」「读失败」「表不存在」
 *    「已锁定」，因为四者的提示文案不同，而「文件不存在」「已锁定」都是这个功能里的
 *    **正常状态**（可能被移走了 / 还没输口令）。
 * 3. **写盘整体替换 + 延迟落盘**。编辑只进内存并记脏,真正写盘发生在标签的统一保存
 *    （`flush`）—— 与笔记编辑共用「改动 → 脏标记 → 保存」这一条出口。没有行级增量写,
 *    一次落盘就是整个文件,盘上永远是一份完整一致的 JSON。
 *
 * **密码本（加密表）也在这个注册表里。** 加密的是**落盘形态**（ADR-0052）：盘上是信封，
 * 内存里仍是一张普通数据表，所以改表、排序、求和这些逻辑一行都不用改。
 * 密钥只活在内存里（`vaultKeys`）—— 应用一关就没了，下次要重新输口令。
 */

/** 一张表在某处的加载状态。 */
export type TableLoadState = "idle" | "loading" | "loaded" | "missing" | "failed" | "locked"

export interface TableEntry {
  /** 已解析的表。`null` 表示还没读到（或读失败、已锁定）。 */
  table: Ref<DataTable | null>
  state: Ref<TableLoadState>
  /** 读失败、文件不存在或已锁定时的原因。给用户看。 */
  message: Ref<string>
  /** 有未落盘的改动。置位在 `mutate`,清位在 `flush`（写成功）或 `reload`（丢弃）。 */
  dirty: Ref<boolean>
  /** 这张表在盘上是**加密信封**（密码本）。 */
  vault: Ref<boolean>
  /** 盘上那份信封。解锁要用它取盐。 */
  envelope: Ref<VaultEnvelope | null>
}

function createTables(driver: Ref<WorkspaceFs | null>, root: Ref<FsRoot | null>) {
  /**
   * 已解锁的密码本：路径 → 密钥。
   *
   * **只活在内存里。** 应用一关，进程一退，全没了 —— 下次打开这个密码本要重新输口令。
   * 这不是偷懒，是「口令不落盘」这条决定的直接后果（ADR-0052）。
   *
   * 键是普通 `Map` 而不是响应式的：谁解锁了不需要重渲染谁，视图靠 `state` 那个 ref 知道。
   */
  const vaultKeys = new Map<string, VaultKey>()

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
      dirty: ref(false),
      vault: ref(false),
      envelope: ref<VaultEnvelope | null>(null),
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
      // 先问一句「这是不是密码本」：是的话走解密那条路，不是的话走普通数据表那条路。
      // 两者的分岔只在这一处 —— 落盘形态不同，内存里的东西完全一样。
      const envelope = readVaultEnvelope(text)
      if (envelope !== null) {
        entry.vault.value = true
        entry.envelope.value = envelope
        const key = vaultKeys.get(path)
        if (key === undefined) {
          // 没有密钥 = 还锁着。这是**正常状态**，不是错误：用户还没输口令。
          entry.table.value = null
          entry.state.value = "locked"
          entry.message.value = "密码本已锁定"
          return
        }
        entry.table.value = decryptVaultWithKey(envelope, key.key)
        entry.state.value = "loaded"
        entry.message.value = ""
        return
      }
      entry.vault.value = false
      entry.envelope.value = null
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

  /** 强制重读。丢弃未落盘的改动、回到盘上真相时也走这里（关标签选「不保存」）。 */
  async function reload(path: string): Promise<void> {
    const entry = registry.get(path)
    if (entry !== undefined) {
      entry.state.value = "idle"
      entry.table.value = null
      entry.dirty.value = false
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

  // ---- 编辑操作（全是整体替换,落盘交给 flush）----

  /**
   * 以一个纯函数改一张表。所有编辑动作的统一入口。
   *
   * 改动只进内存并记脏 —— 落盘交给标签的统一保存（`flush`），与笔记编辑共用
   * 「改动 → 脏标记 → 保存」这一条出口。纯函数返回同一个对象视为空转,不记脏,
   * 避免每次失焦都多出一次假保存。
   */
  async function mutate(path: string, change: (table: DataTable) => DataTable): Promise<boolean> {
    const entry = entryOf(path)
    const table = entry.table.value
    if (table === null) return false
    const next = change(table)
    if (next === table) return true
    entry.table.value = next
    entry.dirty.value = true
    return true
  }

  /**
   * 把一张脏表落盘。只在有未落盘改动时写;写失败**保持脏态**（内存里那份仍是最新的,
   * 用户可以再存一次）,返回失败原因给调用方提示;成功或无事可做返回 `null`。
   *
   * 密码本走的是同一条路，只是**落盘的形态不同**：不是明文 JSON，是一个信封。
   * 密钥与盐是这张表自己的（`vaultKeys`），每次写盘换新的 IV、保留原来的盐。
   */
  async function flush(path: string): Promise<string | null> {
    const entry = registry.get(path)
    if (entry === undefined || !entry.dirty.value) return null
    const table = entry.table.value
    if (table === null) {
      entry.dirty.value = false
      return null
    }
    const fsDriver = driver.value
    const current = root.value
    if (fsDriver === null || current === null) return "工作区还没有就绪"
    try {
      if (entry.vault.value) {
        const key = vaultKeys.get(path)
        if (key === undefined) return "密码本已锁定,没法落盘"
        const envelope = resealVault(table, key)
        entry.envelope.value = envelope
        await fsDriver.writeNote(current, path, vaultText(envelope))
      } else {
        await fsDriver.writeNote(current, path, dt.tableToJson(table))
      }
      entry.dirty.value = false
      return null
    } catch (error) {
      return describeError(error)
    }
  }

  /**
   * 同步列出所有有未落盘改动的表。
   *
   * 这是「表脏不脏」的**唯一答案**：工作区据此判断标签有没有未保存的东西、保存时该
   * 落哪些表、改名 / 删目录前拦哪几张。它读的是各条目自己的 `dirty` ref，所以放进
   * `computed` 里会跟着变；`revision` 那一行是为了让「新注册一张表」也算作变化 ——
   * 注册表本身不是响应式的，条目增删没人通知。
   */
  function dirtyPaths(): string[] {
    void revision.value
    return [...registry.entries()].filter(([, entry]) => entry.dirty.value).map(([path]) => path)
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

  // ---- 密码本（加密表）----

  /**
   * 把一张**普通数据表**转成密码本：用口令把它加密后原样写回。
   *
   * 数据一行不少 —— 转的是**落盘形态**，不是内容。用户拿已有的表当密码本时走这条。
   * 已经��密码本的表原样放过（返回 `null`），不重复加密。
   */
  async function convertToVault(path: string, passphrase: string): Promise<string | null> {
    const entry = registry.get(path)
    if (entry === undefined) return "这张表还没读到"
    if (entry.vault.value) return null
    const table = entry.table.value
    if (table === null) return "这张表还没读到"
    if (passphrase === "") return "口令不能为空"
    const fsDriver = driver.value
    const current = root.value
    if (fsDriver === null || current === null) return "工作区还没有就绪"
    try {
      const { envelope, key } = createVault(table, passphrase)
      await fsDriver.writeNote(current, path, vaultText(envelope))
      vaultKeys.set(path, key)
      entry.vault.value = true
      entry.envelope.value = envelope
      entry.dirty.value = false
      return null
    } catch (error) {
      return describeError(error)
    }
  }

  /**
   * 把一张表「认领」成密码本。
   *
   * 已经是密码本就原样放过 —— **不用口令**：那张表有自己的口令，用户想开的时候
   * 自己输；插块这一步不该拦住他引用一张存在的密码本。
   * 不是密码本就用给的口令把它转成密码本。
   */
  async function ensureVault(path: string, passphrase: string): Promise<string | null> {
    const entry = entryOf(path)
    // 还没读到就先读一次 —— 判断「是不是密码本」得看盘上那份。
    if (entry.table.value === null && !entry.vault.value) await load(path)
    if (entry.vault.value) return null
    return convertToVault(path, passphrase)
  }

  /**
   * 解锁一个密码本。返回 `null` = 成功，否则是一句人话。
   *
   * 口令错与文件坏在这里是**同一个结果**：GCM 的认证标签过了才会解出明文，
   * 所以「口令错」和「密文被改过」都表现为「解不开」。告诉对方是哪一种没有意义 ——
   * 对攻击者而言，「你猜对了口令但文件被动过」本身也是一条信息。
   */
  async function unlockVault(path: string, passphrase: string): Promise<string | null> {
    const entry = registry.get(path)
    if (entry === undefined) return "这张表还没读到"
    const envelope = entry.envelope.value
    if (envelope === null) return "这不是一个密码本"
    if (passphrase === "") return "口令不能为空"
    const derived = deriveKeyForEnvelope(passphrase, envelope)
    try {
      const table = decryptVaultWithKey(envelope, derived.key)
      vaultKeys.set(path, derived)
      entry.table.value = table
      entry.state.value = "loaded"
      entry.message.value = ""
      return null
    } catch {
      return "口令不对 —— 这个密码本解不开"
    }
  }

  /**
   * 锁回去：丢掉密钥，内存里那份表也清掉。
   *
   * 盘上那份**没动** —— 它本来就是加密的。锁住只是让这一份数据不再在手边。
   */
  function lockVault(path: string): void {
    vaultKeys.delete(path)
    const entry = registry.get(path)
    if (entry === undefined) return
    entry.table.value = null
    entry.state.value = "locked"
    entry.message.value = "密码本已锁定"
  }

  /** 这张密码本解锁了吗。 */
  function isVaultUnlocked(path: string): boolean {
    return vaultKeys.has(path)
  }

  /**
   * 盘上刚建好一个密码本：把内存里那份填上，连带记住它的信封与密钥。
   *
   * 与 `adopt` 同一件事的加密版本 —— 调用方（App.vue 的注册表适配层）已经写好了
   * 盘上那份，这里只补内存状态。密钥是那次创建时派生出来的，所以**已经解锁**。
   */
  function adoptVault(path: string, table: DataTable, envelope: VaultEnvelope, key: VaultKey): void {
    const entry = entryOf(path)
    vaultKeys.set(path, key)
    entry.table.value = table
    entry.vault.value = true
    entry.envelope.value = envelope
    entry.state.value = "loaded"
    entry.message.value = ""
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
    flush,
    dirtyPaths,
    create,
    adopt,
    adoptVault,
    defaultTable,
    unlockVault,
    lockVault,
    isVaultUnlocked,
    ensureVault,
    convertToVault,
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
