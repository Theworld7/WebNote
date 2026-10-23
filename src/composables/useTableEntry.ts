import type { ComputedRef } from "vue"
import type { DataColumn, DataRow, DataTable } from "@/types/data-table"
import type { TableEntry, TableLoadState } from "@/composables/useTables"
import { useTables } from "@/composables/useTables"
import { useToast } from "@/composables/useToast"
import { useWorkspace } from "@/composables/useWorkspace"
import { computed, onBeforeUnmount, onMounted, shallowRef, watch } from "vue"

/**
 * 引用块与数据表编辑页共用的取数 seam：认领注册表条目 → 暴露状态 → 统一改表。
 *
 * 四个引用块视图（数据表 / 画册 / 书签 / 看板）与 `DataTableEditor` 的数据链路完全
 * 同源 —— 曾经各自复制一遍 mount / watch / release / change,连「必须 shallowRef」
 * 这条铁律都各自写了一遍注释。现在铁律只有一个家:
 *
 * **`entry` 必须是 `shallowRef`**：`ref()` 会深度解包嵌套 ref,而 `TableEntry` 的字段
 * 本身就是 `Ref` —— 用 `ref` 装它,`entry.value.table` 会退化成 `DataTable | null`
 * 而不是 `Ref<DataTable | null>`,于是 `entry.value.table.value` 读到 `undefined`,
 * 视图永远停在「正在读取」。`shallowRef` 只做浅层响应,字段原样是 ref,
 * 字段内部的更新由字段自己通知（这正是我们要的）。
 *
 * 释放口径:记下**实际认领的路径**,换路径先还旧的,卸载还现在的 ——
 * 「按 key 重挂」的编辑页与「原地换引用」的引用块两种生命周期都因此正确。
 *
 * 调用方只需给路径来源,剩下的都是这一层的实现细节。
 */
export interface TableEntryView {
  /** 加载状态。条目还没认领到（路径为空 / 读盘中）时是 `"loading"`。 */
  state: ComputedRef<TableLoadState>
  table: ComputedRef<DataTable | null>
  columns: ComputedRef<readonly DataColumn[]>
  rows: ComputedRef<readonly DataRow[]>
  /** 所有数据编辑都走这一条:算出新表 → 进内存记脏,随所在笔记统一保存。 */
  change(next: (table: DataTable) => DataTable): Promise<void>
}

export function useTableEntry(pathOf: () => string): TableEntryView {
  const tables = useTables()
  const { markTableDirty } = useWorkspace()
  const { notify } = useToast()

  const entry = shallowRef<TableEntry | null>(null)

  /** 已认领（retain 过）的路径。空串 = 没有认领任何表。 */
  let retained = ""

  const state = computed<TableLoadState>(() => entry.value?.state.value ?? "loading")
  const table = computed<DataTable | null>(() => entry.value?.table.value ?? null)
  const columns = computed<readonly DataColumn[]>(() => table.value?.columns ?? [])
  const rows = computed<readonly DataRow[]>(() => table.value?.rows ?? [])

  onMounted(() => {
    void claim()
  })

  // 路径变了要换一张表:引用块可以被「重新指定」到另一个文件。先释放旧路径的引用,再认领新的。
  watch(pathOf, () => {
    void claim()
  })

  onBeforeUnmount(() => {
    if (retained !== "") tables.release(retained)
  })

  async function claim(): Promise<void> {
    const path = pathOf()
    if (path === retained) return
    if (retained !== "") tables.release(retained)
    retained = path
    entry.value = path === "" ? null : await tables.use(path)
  }

  async function change(next: (table: DataTable) => DataTable): Promise<void> {
    const path = pathOf()
    if (path === "") return
    const ok = await tables.mutate(path, next)
    if (!ok) {
      // 表还没读到（或读失败）：格子里的新值不会被接受，视觉上却是「打进去了又弹回来」。
      // 不说一声，用户只会以为这个格子坏了，再试一遍。
      notify("这张数据表还没读到，改动没有生效", "error")
      return
    }
    markTableDirty(path)
  }

  return { state, table, columns, rows, change }
}
