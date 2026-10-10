import type {
  DataCellValue,
  DataColumn,
  DataColumnType,
  DataRow,
  DataSelectOption,
  DataTable,
} from "@/types/data-table"
import {
  DATA_TABLE_VERSION,
  MAX_DATA_TABLE_COLUMNS,
} from "@/types/data-table"

/**
 * 数据表几何与（反）序列化。
 *
 * 与 `lib/table.ts` 同一个性格：**全是纯函数**，入参不改、返回新对象，调用方整体替换。
 * 这样 UI 层不必记住「哪个操作是原地、哪个是替换」。
 *
 * 与 `lib/table.ts` 的分别在于**单元格模型**：那边是 `InlineRun[]` 富文本，这边是
 * 按列类型解释的原生值。两边不共用「值」的概念，只共用几何与视觉常量。
 *
 * 序列化（`tableToJson` / `tableFromJson`）不走 `JSON.parse` 的宽松路径就直接写盘 ——
 * **键序必须自己定死**：`JSON.stringify` 对整数样式的键会按数值重排，`"c1"` 这类不含
 * 数字前缀的键虽然不受影响，但把顺序交给引擎是一个不该存在的依赖。所以写出时逐字段
 * 显式构造，而不是把内部对象直接丢给 `stringify`。
 */

const COLUMN_TYPES: readonly DataColumnType[] = ["text", "number", "date", "select", "checkbox"]

export function isDataColumnType(value: string): value is DataColumnType {
  return COLUMN_TYPES.some((type) => type === value)
}

/** 列类型的中文名，菜单直接消费。 */
export function columnTypeLabel(type: DataColumnType): string {
  switch (type) {
    case "text":
      return "文本"
    case "number":
      return "数字"
    case "date":
      return "日期"
    case "select":
      return "单选"
    case "checkbox":
      return "勾选"
  }
}

let seq = 0

/**
 * 列 / 行 / 选项 id。
 *
 * 与 `createBlockId` 同样走进程内自增 + 时间戳前缀：只需在**一个文件内**唯一，
 * 因为它只用来在 `values` 里当键、在列表里当 `:key`。不在文件间比较，也就不需要
 * 全局唯一（也就不会因为换台机器而撞）。
 */
function createId(prefix: string): string {
  seq += 1
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}`
}

export function createColumnId(): string {
  return createId("c")
}

export function createRowId(): string {
  return createId("r")
}

export function createOptionId(): string {
  return createId("o")
}

// ---- 构造 ----

/** 某个类型下的空值。`checkbox` 是 `false` 而不是 `null` —— 未勾与空在复选上是一回事。 */
export function emptyValueOf(type: DataColumnType): DataCellValue {
  return type === "checkbox" ? false : null
}

export function emptyColumn(name: string, type: DataColumnType = "text"): DataColumn {
  return { id: createColumnId(), name, type, options: [] }
}

export function emptyRow(columns: readonly DataColumn[]): DataRow {
  const values: Record<string, DataCellValue> = {}
  for (const column of columns) values[column.id] = emptyValueOf(column.type)
  return { id: createRowId(), values }
}

/** 一张带若干列的空表。新建 `.tbl` 时的初始内容。 */
export function createEmptyTable(columnNames: readonly string[] = ["标题"]): DataTable {
  const columns = columnNames.map((name) => emptyColumn(name))
  return { version: DATA_TABLE_VERSION, columns, rows: [emptyRow(columns)] }
}

/** 深拷一张表。写盘前或拷进状态时用 —— 避免两份表共享同一批对象。 */
export function cloneTable(table: DataTable): DataTable {
  return {
    version: table.version,
    columns: table.columns.map((column) => ({
      id: column.id,
      name: column.name,
      type: column.type,
      options: column.options.map((option) => ({ id: option.id, name: option.name })),
    })),
    rows: table.rows.map((row) => ({ id: row.id, values: { ...row.values } })),
  }
}

// ---- 值 ----

/**
 * 某一格的值。**永不返回 `undefined`**：列被删掉之后行里可能还留着那个键，
 * 但调用方不该因此拿到一个未定义的值 —— 对不上列的格就是空。
 */
export function cellValue(row: DataRow, column: DataColumn): DataCellValue {
  const value = row.values[column.id]
  return value === undefined ? emptyValueOf(column.type) : value
}

/**
 * 值的纯文本投影。用于渲染、搜索与导出快照。
 *
 * `select` 存的是选项 id，投影要翻成名字 —— 直接显示 id 等于把内部标识漏给用户。
 */
export function valueText(value: DataCellValue, column: DataColumn): string {
  if (value === null) return ""
  if (typeof value === "boolean") return value ? "✓" : ""
  if (typeof value === "number") return String(value)
  if (column.type === "select") {
    const option = column.options.find((item) => item.id === value)
    return option === undefined ? "" : option.name
  }
  return value
}

/**
 * 改一个格子的值。
 *
 * 空值**写进对象**而不是删掉键：`values` 是「每列一个键」的矩形，删键会让一份数据
 * 在两次渲染之间改变形状，而列还在、只是这一格空着，是常态。
 */
export function setCell(row: DataRow, columnId: string, value: DataCellValue): DataRow {
  return { id: row.id, values: { ...row.values, [columnId]: value } }
}

// ---- 列操作 ----

export function addColumn(table: DataTable, name = ""): DataTable {
  if (table.columns.length >= MAX_DATA_TABLE_COLUMNS) return table
  const label = name === "" ? `列 ${table.columns.length + 1}` : name
  const column = emptyColumn(label)
  return {
    version: table.version,
    columns: [...table.columns, column],
    rows: table.rows.map((row) => setCell(row, column.id, null)),
  }
}

/**
 * 删一列。
 *
 * 行里的值**一并删掉**（而不是留成孤儿键）：留着的键既不会被渲染、又会在导出时
 * 悄悄漏出去，还会让「删列 = 数据变少」这件事在文件大小上看不出来。
 */
export function removeColumn(table: DataTable, columnId: string): DataTable {
  if (table.columns.length <= 1) return table
  return {
    version: table.version,
    columns: table.columns.filter((column) => column.id !== columnId),
    rows: table.rows.map((row) => {
      const values: Record<string, DataCellValue> = {}
      for (const [key, value] of Object.entries(row.values)) {
        if (key !== columnId) values[key] = value
      }
      return { id: row.id, values }
    }),
  }
}

/**
 * 改列类型。
 *
 * 值要被**按新类型重新解释**，不能原样留着：一列从 `text` 改成 `number` 之后，
 * `"abc"` 这个值会让排序与求和都失效。解释不了的变成空 —— 丢数据在这里比留着更安全，
 * 因为留下的错值不会被任何人发现。
 */
export function setColumnType(table: DataTable, columnId: string, type: DataColumnType): DataTable {
  const source = table.columns.find((column) => column.id === columnId)
  if (source === undefined) return table
  const from = source.type
  return {
    version: table.version,
    columns: table.columns.map((column) =>
      column.id === columnId
        ? { id: column.id, name: column.name, type, options: type === "select" ? column.options : [] }
        : column,
    ),
    rows: table.rows.map((row) => setCell(row, columnId, coerceValue(cellValue(row, source), from, type))),
  }
}

export function renameColumn(table: DataTable, columnId: string, name: string): DataTable {
  return {
    version: table.version,
    columns: table.columns.map((column) =>
      column.id === columnId ? { id: column.id, name, type: column.type, options: column.options } : column,
    ),
    rows: table.rows,
  }
}

/**
 * 把值从一种列类型解释成另一种。
 *
 * 只有两条**无损**通道值得保留：`text` ↔ `number`（能解析出数字就留），
 * 以及 `checkbox` → `number`（`true`/`false` 是 1/0）。其余一律清空 —— 与其猜
 * 「这串文本是不是一个日期」，不如空着让用户重填。
 */
function coerceValue(value: DataCellValue, from: DataColumnType, to: DataColumnType): DataCellValue {
  if (from === to) return value
  if (to === "checkbox") return value === true
  if (value === null) return null
  if (to === "number" && typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  if (to === "text" && typeof value === "number") return String(value)
  return emptyValueOf(to)
}

// ---- 行操作 ----

export function addRow(table: DataTable, at = table.rows.length): DataTable {
  const rows = [...table.rows]
  rows.splice(Math.min(Math.max(at, 0), rows.length), 0, emptyRow(table.columns))
  return { version: table.version, columns: table.columns, rows }
}

export function removeRow(table: DataTable, rowId: string): DataTable {
  return {
    version: table.version,
    columns: table.columns,
    rows: table.rows.filter((row) => row.id !== rowId),
  }
}

/** 用一行的新值整体替换。手写行编辑走这条，粒度比逐格更省心。 */
export function replaceRow(table: DataTable, row: DataRow): DataTable {
  return {
    version: table.version,
    columns: table.columns,
    rows: table.rows.map((item) => (item.id === row.id ? row : item)),
  }
}

// ---- select 选项 ----

export function addOption(column: DataColumn, name: string): DataSelectOption[] {
  return [...column.options, { id: createOptionId(), name }]
}

/** 删选项。引用它的格子会被清空 —— 保留一个指向不存在选项的 id 等于留一个空显示。 */
export function removeOption(table: DataTable, columnId: string, optionId: string): DataTable {
  return {
    version: table.version,
    columns: table.columns.map((column) =>
      column.id === columnId
        ? { id: column.id, name: column.name, type: column.type, options: column.options.filter((o) => o.id !== optionId) }
        : column,
    ),
    rows: table.rows.map((row) => {
      const column = table.columns.find((item) => item.id === columnId)
      if (column === undefined) return row
      return cellValue(row, column) === optionId ? setCell(row, columnId, null) : row
    }),
  }
}

// ---- 序列化 ----

/**
 * 表 → `.tbl` 文件文本。
 *
 * **逐字段显式构造**，不把内部对象直接 `stringify`：内部对象的键序是「谁先写进去谁在前」，
 * 而盘上的文件应当只由数据决定。显式构造之后，同一份表永远得到同一份文本，
 * 这才是「保存后文件不变」这件事成立的前提。
 *
 * 缩进用 2 空格：`.tbl` 是给人看也给人手改的（它是标准 JSON，不是私有格式），
 * 压成一行的收益只有文件小一点，代价是丢了可读性。
 */
export function tableToJson(table: DataTable): string {
  const payload = {
    version: table.version,
    columns: table.columns.map((column) => ({
      id: column.id,
      name: column.name,
      type: column.type,
      options: column.options.map((option) => ({ id: option.id, name: option.name })),
    })),
    rows: table.rows.map((row) => ({
      id: row.id,
      values: Object.fromEntries(
        table.columns.map((column) => [column.id, cellValue(row, column)] as const),
      ),
    })),
  }
  return `${JSON.stringify(payload, null, 2)}\n`
}

/**
 * `.tbl` 文件文本 → 表。
 *
 * 宽容解析：字段缺失按默认值补，认不出的列类型退回 `text`，行里对不上列的键直接丢掉。
 * 一份人手改坏的 `.tbl` 不该让编辑器打不开 —— 能救回的列与行都留着，救不回的降级，
 * 只有**整个文件不是 JSON**、或 **version 超出已知范围**才抛错。
 *
 * 与 `parse.ts` 的宽松解析同一个立场：接受编辑器从未写过的输入。
 */
export function tableFromJson(source: string): DataTable {
  const parsed: unknown = JSON.parse(source)
  if (typeof parsed !== "object" || parsed === null) throw new Error("数据表文件不是一个对象")

  const version = Reflect.get(parsed, "version")
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new Error("数据表文件缺少有效的 version")
  }
  if (version > DATA_TABLE_VERSION) {
    throw new Error(`数据表版本 ${version} 比这个编辑器支持的 ${DATA_TABLE_VERSION} 更新`)
  }

  const rawColumns = Reflect.get(parsed, "columns")
  if (!Array.isArray(rawColumns)) throw new Error("数据表文件缺少 columns")

  const columns: DataColumn[] = []
  for (const raw of rawColumns) {
    if (typeof raw !== "object" || raw === null) continue
    const id = Reflect.get(raw, "id")
    if (typeof id !== "string" || id === "") continue
    const name = Reflect.get(raw, "name")
    const rawType = Reflect.get(raw, "type")
    const type = typeof rawType === "string" && isDataColumnType(rawType) ? rawType : "text"

    const options: DataSelectOption[] = []
    const rawOptions = Reflect.get(raw, "options")
    if (Array.isArray(rawOptions)) {
      for (const option of rawOptions) {
        if (typeof option !== "object" || option === null) continue
        const optionId = Reflect.get(option, "id")
        const optionName = Reflect.get(option, "name")
        if (typeof optionId !== "string" || typeof optionName !== "string") continue
        options.push({ id: optionId, name: optionName })
      }
    }

    columns.push({ id, name: typeof name === "string" ? name : "", type, options })
  }

  // 一列都没有的文件没有意义，给一个默认列 —— 否则表无法渲染、也无法加行。
  if (columns.length === 0) columns.push(emptyColumn("列 1"))

  const rawRows = Reflect.get(parsed, "rows")
  const rows: DataRow[] = []
  if (Array.isArray(rawRows)) {
    for (const raw of rawRows) {
      if (typeof raw !== "object" || raw === null) continue
      const rawId = Reflect.get(raw, "id")
      const id = typeof rawId === "string" && rawId !== "" ? rawId : createRowId()
      const rawValues = Reflect.get(raw, "values")
      const values: Record<string, DataCellValue> = {}
      for (const column of columns) {
        // 按**列**遍历而不是按源对象的键遍历：列是矩形，行里多出来的键一律丢掉。
        const source = typeof rawValues === "object" && rawValues !== null
          ? Reflect.get(rawValues, column.id)
          : undefined
        values[column.id] = normalizeValue(source, column.type)
      }
      rows.push({ id, values })
    }
  }

  return { version: DATA_TABLE_VERSION, columns, rows }
}

/** 把外来值收成某一列类型认得的形状。认不出的给空。 */
function normalizeValue(value: unknown, type: DataColumnType): DataCellValue {
  switch (type) {
    case "text":
      return typeof value === "string" ? value : value === null || value === undefined ? null : String(value)
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? value : null
    case "date":
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
    case "select":
      return typeof value === "string" ? value : null
    case "checkbox":
      return value === true
  }
}
