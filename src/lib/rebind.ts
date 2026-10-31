import type { Block, PlaylistSource } from "@/types/workspace"
import { isReferenceBlock } from "@/lib/blocks"

/**
 * 让引用块改指另一张数据表 —— Missing Data table 的恢复出路（GLOSSARY 里那条
 * 「the user may want to point the block at it again」）。
 *
 * 纯函数：给旧块和新的 `.tbl` 路径，返回新块；不是引用块时返回 `null`。
 * 抽在 `lib/` 里而不是就地改块，是为了这条规则能脱离工作区单独验证 ——
 * 「换表该清什么」是本文件的全部内容，没有任何读盘、响应式或文档状态。
 *
 * 分界只有一条：**列 id 属于旧表，一律清掉**。留着拿旧表的列 id 去新表里碰运气，
 * 不会报错，只会静默错位成另一列 —— 那比读不到表更难发现。跟表无关的纯偏好
 * （列数、比例、是否显示余额、排序方向、分组方式）原样留着。
 *
 * 按块类型显式穷举而不查表（ADR-0022）：每种引用块的设置字段本来就不一样，
 * 映射表省下的行数抵不上一个漏项。
 */
export function rebindBlock(block: Block, path: string): Block | null {
  if (!isReferenceBlock(block)) return null

  switch (block.type) {
    // 数据表块自己就是这张表，块上没有列的设置。
    case "datatable":
      return { ...block, path }

    case "gallery":
      return { ...block, path, hiddenFields: [], group: "", groupBy: "", groupOrder: [] }

    // 可选字段要真的 `delete`，不是置空串：`iconColumn` 缺省表示「按链接派生」，
    // 空串是另一个意思（指向一个不存在的列）。
    case "bookmark": {
      const next = { ...block, path, nameColumn: "", urlColumn: "" }
      delete next.iconColumn
      delete next.groupBy
      return next
    }

    case "kanban":
      return { ...block, path, groupColumnId: "", displayColumnIds: [], groupOrder: [] }

    // 分组方式与排序方向是偏好（「我按什么读这本账」），不是列 id，留着；
    // 列 id 清空后视图自己退化成平铺 / 不排序。
    case "ledger":
      return {
        ...block,
        path,
        incomeColumnId: "",
        expenseColumnId: "",
        groupColumnId: "",
        sortColumnId: "",
      }

    case "stat": {
      const next = { ...block, path, columnId: "" }
      delete next.filterColumnId
      delete next.filterValue
      return next
    }

    // 这些字段的空串本来就表示「自动识别」，清空正好回到那一档。
    case "subscription":
      return {
        ...block,
        path,
        nameColumnId: "",
        iconColumnId: "",
        amountColumnId: "",
        cycleColumnId: "",
        autoRenewColumnId: "",
        trialEndColumnId: "",
        startColumnId: "",
        endColumnId: "",
        cancelledColumnId: "",
        paidColumnId: "",
      }

    // 换的是 `sources` 里失效的那一项：位次不动，它自己那套映射作废（列 id 属于旧表）。
    // 新表已经绑在别处时直接丢掉失效项切过去 —— 同一张表绑两遍，标签条上会冒出
    // 两个同名标签，而块上「path 恒等于 sources 中某项」这条不变式仍成立。
    case "playlist": {
      const kept = block.sources.filter((source) => source.path !== block.path)
      if (kept.some((source) => source.path === path)) {
        return { ...block, path, sources: kept }
      }
      return {
        ...block,
        path,
        sources: block.sources.map((source) => (source.path === block.path ? blankSource(path) : { ...source })),
      }
    }

    default: {
      // 新增引用块类型时这里编译不过 —— 漏一种就是漏一条恢复出路。
      const unhandled: never = block
      void unhandled
      return null
    }
  }
}

/** 空白的歌单绑定项：刚换过来的表还没挑过字段，交给自动识别。 */
function blankSource(path: string): PlaylistSource {
  return { path, titleColumnId: "", subtitleColumnId: "", coverColumnId: "", durationColumnId: "" }
}
