import type { DataColumn, DataRow } from "@/types/data-table"
import { cellValue } from "@/lib/data-table"

/**
 * 画册块的**宫格单元**划分。
 *
 * 一份算法，两个消费者：编辑器里的 `GalleryBlockView`（可展开 / 收起聚合组）与导出侧
 * 的 `lib/html/serialize`（写静态快照，没有「展开」这层交互）。两边各有一次归桶，
 * 曾经是逐行照抄的两份 —— 口径一旦分家，导出的文件就和编辑器里看到的不是一回事，
 * 而这种偏差只在导出之后才看得见。
 *
 * 规则：
 * - 没有聚合列 → 一行一张卡。
 * - 空值行**不聚合**：「没有合集名」的行互相无关，聚到一起是错的。
 * - 组的产出顺序跟行的首次出现序。
 * - 单行组平铺：一张卡配一叠骨架是在暗示「后面还有卡」，而那里没有。
 * - 多行组折成一张叠卡，除非它已经被展开（`isExpanded`）。
 */
export interface GalleryUnit {
  /** 稳定 key：聚合组用组值，平铺行用行 id。 */
  key: string
  /** true = 聚合成一张叠卡；false = 组内逐行平铺。 */
  stacked: boolean
  /** 代表行：叠卡画的是它；平铺时就是那一行自己。 */
  lead: DataRow
  rows: readonly DataRow[]
}

/**
 * 把一组行切成宫格单元。
 *
 * `isExpanded` 是运行时状态，默认空 —— 静态导出没有展开这回事，一律折叠。
 */
export function galleryUnits(
  rows: readonly DataRow[],
  column: DataColumn | null,
  isExpanded: (key: string) => boolean = () => false,
): GalleryUnit[] {
  if (column === null) {
    return rows.map((row) => ({ key: row.id, stacked: false, lead: row, rows: [row] }))
  }

  const buckets = new Map<string, DataRow[]>()
  for (const row of rows) {
    const value = cellValue(row, column)
    if (value === null || value === "") continue
    const key = String(value)
    const bucket = buckets.get(key)
    if (bucket === undefined) buckets.set(key, [row])
    else bucket.push(row)
  }

  const seen = new Set<string>()
  const out: GalleryUnit[] = []
  for (const row of rows) {
    const value = cellValue(row, column)
    if (value === null || value === "") {
      out.push({ key: row.id, stacked: false, lead: row, rows: [row] })
      continue
    }
    const key = String(value)
    if (seen.has(key)) continue
    seen.add(key)
    const bucket = buckets.get(key)
    const lead = bucket?.[0]
    if (bucket === undefined || lead === undefined) continue
    if (bucket.length < 2) {
      out.push({ key: lead.id, stacked: false, lead, rows: bucket })
      continue
    }
    out.push({ key, stacked: !isExpanded(key), lead, rows: bucket })
  }
  return out
}
