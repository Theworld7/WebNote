import type { TableCell } from "@/types/workspace"
import { cloneRuns } from "@/lib/inline"

/**
 * 表格几何操作。
 *
 * 两个约定：
 *
 * 1. **全是纯函数**：入参不改，返回新数组，调用方整体替换 `block.rows`。这样 UI 层
 *    不必记住「哪个操作是原地、哪个是替换」。
 * 2. **不变式是「空表或矩形」**：`rows` 要么长度为 0（还没定尺寸，块显示网格选择器），
 *    要么非空且每行等宽。所有函数进出都过 `normalizeTable()`，所以手工构造的数据、
 *    带 `colspan` 的解析结果都不会把矩形破坏掉 —— 行列增删依赖「每行同宽」这个前提。
 */

/** 列数上限。选择器只给到 8 列，手工加列到此为止，避免误操作点出一张巨表。 */
export const MAX_TABLE_COLUMNS = 12

/** 行数上限。 */
export const MAX_TABLE_ROWS = 60

/** 网格选择器的可选格数（hover 拖选范围）。 */
export const TABLE_PICKER_SIZE = 8

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  return Math.min(Math.max(Math.trunc(value), min), max)
}

export function emptyCell(header = false): TableCell {
  return { header, runs: [] }
}

/** 建一张 `columns` 列 `rows` 行的网格。`header` 为真时首行整行进表头。 */
export function createGrid(columns: number, rows: number, header: boolean): TableCell[][] {
  const width = clamp(columns, 1, MAX_TABLE_COLUMNS)
  const height = clamp(rows, 1, MAX_TABLE_ROWS)
  const grid: TableCell[][] = []
  for (let row = 0; row < height; row += 1) {
    const cells: TableCell[] = []
    for (let column = 0; column < width; column += 1) cells.push(emptyCell(header && row === 0))
    grid.push(cells)
  }
  return grid
}

/** 最宽的一行有多宽。空表返回 0。 */
export function columnsOf(rows: readonly TableCell[][]): number {
  return rows.reduce((max, row) => Math.max(max, row.length), 0)
}

/** 整行都是表头。与序列化把整行收进 `<thead>` 的判据一致。 */
export function isHeaderRow(row: readonly TableCell[]): boolean {
  return row.length > 0 && row.every((cell) => cell.header)
}

/**
 * 补齐成矩形并深拷 runs。
 *
 * 空表原样返回空数组 —— 「无行」是合法的初始态（块会显示尺寸选择器），
 * 不是需要修的数据。`colspan` 造成的短行会补空格而不是丢列：补出来的空格用户能看见、
 * 能删，丢列则是静默的数据损失。
 */
export function normalizeTable(rows: readonly TableCell[][]): TableCell[][] {
  const width = columnsOf(rows)
  if (width === 0) return []

  return rows.map((row) => {
    const cells: TableCell[] = []
    for (let column = 0; column < width; column += 1) {
      const cell = row[column]
      cells.push(cell === undefined ? emptyCell() : { header: cell.header, runs: cloneRuns(cell.runs) })
    }
    return cells
  })
}

/**
 * 第 `at` 行之前插入一个空行（`at === rows.length` 即追加到末尾）。
 *
 * 表头在本模型里就是「首行」。所以插到 0 号位时表头属性跟着位置走：新行成为表头，
 * 原首行退成普通行 —— 不这么做，表头会掉到第 2 行，序列化时 `<thead>` 直接消失。
 */
export function insertRow(rows: readonly TableCell[][], at: number): TableCell[][] {
  const grid = normalizeTable(rows)
  const width = columnsOf(grid)
  if (width === 0 || grid.length >= MAX_TABLE_ROWS) return grid

  const index = clamp(at, 0, grid.length)
  const oldHead = grid[0]
  const takesHeader = index === 0 && oldHead !== undefined && isHeaderRow(oldHead)
  if (takesHeader && oldHead !== undefined) {
    for (const cell of oldHead) cell.header = false
  }

  const row: TableCell[] = []
  for (let column = 0; column < width; column += 1) row.push(emptyCell(takesHeader))
  grid.splice(index, 0, row)
  return grid
}

/** 删掉第 `at` 行。删掉最后一行就回到空表态（块显示尺寸选择器）。 */
export function removeRow(rows: readonly TableCell[][], at: number): TableCell[][] {
  const grid = normalizeTable(rows)
  if (at < 0 || at >= grid.length) return grid
  grid.splice(at, 1)
  return grid
}

/**
 * 第 `at` 列之前插入一个空列。
 *
 * 新格子继承「所在行原本的性质」：插在表头行上就是表头格。不继承的话，表头行会
 * 变成「一半 th 一半 td」，`isHeaderRow` 判否 —— 序列化时整行跌出 `<thead>`，
 * 用户只是加了一列，表头却没了。
 */
export function insertColumn(rows: readonly TableCell[][], at: number): TableCell[][] {
  const grid = normalizeTable(rows)
  const width = columnsOf(grid)
  if (width === 0 || width >= MAX_TABLE_COLUMNS) return grid

  const index = clamp(at, 0, width)
  for (const row of grid) row.splice(index, 0, emptyCell(isHeaderRow(row)))
  return grid
}

/** 删掉第 `at` 列。删掉最后一列即整表清空。 */
export function removeColumn(rows: readonly TableCell[][], at: number): TableCell[][] {
  const grid = normalizeTable(rows)
  const width = columnsOf(grid)
  if (at < 0 || at >= width || width === 0) return grid
  if (width === 1) return []

  for (const row of grid) row.splice(at, 1)
  return grid
}

/** 把首行整行切成表头 / 内容行。其它行不动 —— 表头只认首行。 */
export function setHeaderRow(rows: readonly TableCell[][], header: boolean): TableCell[][] {
  const grid = normalizeTable(rows)
  const first = grid[0]
  if (first === undefined) return grid
  for (const cell of first) cell.header = header
  return grid
}
