/**
 * 数据表领域模型。
 *
 * 数据表是**独立文档**，不像 `TableBlock` 那样内联在笔记里 —— 它有自己的 `.tbl` 文件、
 * 自己的标签页，并且可以被任意多篇笔记同时引用（见 ADR-0005）。这一层只描述**盘上
 * 那个文件的内容**，不含任何视图状态（列宽、排序、筛选都是 Preference，不进文件）。
 *
 * 三条约定：
 *
 * 1. **单元格值是原生的**。数字就是 `number`、勾选就是 `boolean`、日期就是
 *    `"YYYY-MM-DD"` 字符串。不做「一律存字符串」：排序、筛选、求和全都依赖它，
 *    而「长得像数字的字符串」在这些操作里是错的。
 * 2. **列顺序就是 `columns` 数组顺序**，行不存列序。删列即从数组里移除，不需要
 *    遍历所有行去调索引。
 * 3. **键用列 id，不用列名**。改名不动数据 —— 否则一次改名要重写整个 `rows`。
 */

/**
 * 列类型。决定这一列的单元格怎么解释、怎么排序、怎么编辑。
 *
 * 这五种是**第一期**的全部：够用、能测、序列化不复杂。刻意排除的：
 * `relation`（引用另一个数据表）、`rollup`、`formula` —— 三者都会引入依赖图与求值，
 * 让文件不再自解释；多视图与「行可以打开成页面」同理，它们是第二期的事。
 */
export type DataColumnType = "text" | "number" | "date" | "select" | "checkbox"

/**
 * 单元格值。
 *
 * 与列类型一一对应：
 * - `text` → `string`
 * - `number` → `number`
 * - `date` → `string`，`YYYY-MM-DD`（不带时间与时区；日历日期就是日历日期）
 * - `select` → `string`，选项 id
 * - `checkbox` → `boolean`
 *
 * 空值统一用 `null`，而不是「缺字段」—— 缺字段会让「这格是空的」和「这格不存在」
 * 无法区分，而列被删除时两种都可能发生。
 *
 * 联合里带 `null`：一行的某个格为空是常态，让类型明说这件事，调用方就不必靠
 * 可选字段去猜。
 */
export type DataCellValue = string | number | boolean | null

/** `select` 列的一个选项。`id` 是行里存的东西，`name` 是显示的东西。 */
export interface DataSelectOption {
  id: string
  name: string
}

/**
 * 一个列。字段很少是故意的 —— 列宽、是否隐藏、排序方向全都是视图状态，不进文件。
 *
 * `options` 只在 `select` 列上有意义；其余类型留空数组。不用可选字段是因为一个
 * 「永远存在的空数组」比「有时候有、有时候没有的数组」在遍历里少一层判断。
 */
export interface DataColumn {
  id: string
  name: string
  type: DataColumnType
  /** 仅 `select` 使用。 */
  options: DataSelectOption[]
}

/** 一行记录。`values` 以列 id 为键 —— 改列名不影响它。 */
export interface DataRow {
  id: string
  values: Record<string, DataCellValue>
}

/**
 * 数据表文件的内容，也就是 `.tbl` 里那份 JSON 的形状。
 *
 * `version` 必须在：列类型系统将来一定会演化（加类型、改 select 的存储形态），
 * 而盘上有文件之后就没有「重新来过」这个选项了。读到一个不认识的版本时要显式拒绝，
 * 不要把新文件按旧规则解释成一份错的数据。
 */
export interface DataTable {
  version: number
  columns: DataColumn[]
  rows: DataRow[]
}

/** 当前写出的版本号。读到更大的版本一律拒绝打开。 */
export const DATA_TABLE_VERSION = 1

/**
 * 列数上限。
 *
 * 行数**没有**上限 —— 这正是数据表存在的理由，一个只能装六十条的记录集不是记录集
 * （见 `CONTEXT.md` 的「Data table bound」）。列数上限留着：它决定编辑 UI 要排多宽，
 * 与滚动长度无关。
 */
export const MAX_DATA_TABLE_COLUMNS = 20
