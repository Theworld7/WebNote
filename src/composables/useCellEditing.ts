import type { Ref } from "vue"
import type { DataColumn, DataRow, DataTable } from "@/types/data-table"
import { ref } from "vue"
import * as dt from "@/lib/data-table"

/**
 * 就地改一格 —— 引用块视图（画册 / 看板 / 账目）共用的那一套。
 *
 * 一次格编辑无非五件事：记住「哪一格在编辑」、把输入框原串解析成该列类型的值、
 * 值没变就不写盘、勾选直接切、select 换选项。这五件事曾各自在三个视图里写一遍，
 * 连「解析走 `dt.parseCellInput`」这条口径都靠注释对齐。现在只有一个家。
 *
 * 视图仍然各管自己的**展示**：账目格的编辑态初值要换回原始数字（金额显示是
 * `+5,000.00`，一回车就成了 null）、回车要跳下一行同列 —— 那些是视图的读法，
 * 不在这里。
 *
 * `change` 来自 `useTableEntry`：改的是内存里的表，随所在笔记统一保存。
 */
export interface CellEditing {
  /** 正在编辑的格：`行id:列id`，空串 = 没有。模板里直接比 `cellKey(row, column)`。 */
  editing: Ref<string>
  /** 格的身份。行 id 与列 id 各自稳定，拼起来就是这一格的键。 */
  cellKey(row: DataRow, column: DataColumn): string
  /** 进入编辑态。 */
  begin(row: DataRow, column: DataColumn): void
  /** 提交一格。解析口径、比较、写盘顺序都在这条路上。 */
  commit(row: DataRow, column: DataColumn, raw: string): void
  /** 失焦提交：清编辑态，但焦点若已交给别格就不清。 */
  commitOnBlur(row: DataRow, column: DataColumn, event: Event): void
  /** 输入框里回车 = 提交（失焦即写盘，与表格编辑页同一直觉）。 */
  commitOnEnter(event: Event): void
  /** select 格：下拉直接换选项（值就是选项 id），空选项 = 清空。 */
  commitSelect(row: DataRow, column: DataColumn, event: Event): void
  /** 勾选格直接切换，不需要「点进编辑」那一层。 */
  toggleCheck(row: DataRow, column: DataColumn, event: Event): void
  /** 编辑框一挂上就拿焦点。 */
  focusOnMount(el: unknown): void
}

export function useCellEditing(change: (next: (table: DataTable) => DataTable) => Promise<void>): CellEditing {
  const editing = ref("")

  function cellKey(row: DataRow, column: DataColumn): string {
    return row.id + ":" + column.id
  }

  function begin(row: DataRow, column: DataColumn): void {
    editing.value = cellKey(row, column)
  }

  function commit(row: DataRow, column: DataColumn, raw: string): void {
    const parsed = dt.parseCellInput(raw, column.type)
    if (parsed === dt.cellValue(row, column)) return
    void change((current) => dt.replaceRow(current, dt.setCell(row, column.id, parsed)))
  }

  /**
   * 失焦提交。焦点可能已经由「回车跳格」交给同一列的下一行 —— 那时编辑态属于新格，
   * 不能被这一格的 blur 清掉。
   */
  function commitOnBlur(row: DataRow, column: DataColumn, event: Event): void {
    const target = event.target
    if (!(target instanceof HTMLInputElement)) return
    commit(row, column, target.value)
    if (editing.value === cellKey(row, column)) editing.value = ""
  }

  function commitOnEnter(event: Event): void {
    const target = event.target
    if (target instanceof HTMLInputElement) target.blur()
  }

  function commitSelect(row: DataRow, column: DataColumn, event: Event): void {
    const target = event.target
    if (!(target instanceof HTMLSelectElement)) return
    const value = target.value === "" ? null : target.value
    if (value === dt.cellValue(row, column)) return
    void change((current) => dt.replaceRow(current, dt.setCell(row, column.id, value)))
  }

  function toggleCheck(row: DataRow, column: DataColumn, event: Event): void {
    const target = event.target
    if (!(target instanceof HTMLInputElement)) return
    void change((current) => dt.replaceRow(current, dt.setCell(row, column.id, target.checked)))
  }

  function focusOnMount(el: unknown): void {
    if (el instanceof HTMLInputElement) el.focus()
  }

  return { editing, cellKey, begin, commit, commitOnBlur, commitOnEnter, commitSelect, toggleCheck, focusOnMount }
}
