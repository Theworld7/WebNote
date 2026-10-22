/**
 * 笔记的标题目录 —— 右侧悬浮标题导航吃的那份数据投影。
 *
 * 三条取舍：
 * - 只收 h1~h6。正文块里没有别的「可以当成章节」的东西。
 * - 只收顶层块。布局格子里的标题不在阅读流上（格子是并排的），跳过去只会落到半屏宽的
 *   一格里，读者找不到自己刚才在哪。
 * - 正文为空的不收。一条没有名字的刻度，点它跳到哪都说不清；写标题时通常先敲空块
 *   再打字，这条规则顺手把那个瞬间的空标题滤掉了。
 */
import type { Block, BlockType } from "@/types/workspace"
import { isTextualBlock } from "@/lib/blocks"
import { runsText } from "@/lib/inline"

export interface HeadingEntry {
  /** 块的 id —— DOM 上靠 `data-block-id` 找它就是跳转目标。 */
  id: string
  /** 标题级别 1~6（来自块类型 h1~h6）。 */
  level: number
  /** 标题的纯文本投影，菜单上显示的就是它。 */
  text: string
}

/** 块类型 → 标题级别。非标题类型不在表里，取不到级别就不收。 */
const HEADING_LEVEL: Partial<Record<BlockType, number>> = {
  h1: 1,
  h2: 2,
  h3: 3,
  h4: 4,
  h5: 5,
  h6: 6,
}

/** 按文档序投影出标题目录。 */
export function headingEntries(blocks: readonly Block[]): HeadingEntry[] {
  const entries: HeadingEntry[] = []
  for (const block of blocks) {
    const level = HEADING_LEVEL[block.type]
    if (level === undefined || !isTextualBlock(block)) continue
    const text = runsText(block.runs).trim()
    if (text === "") continue
    entries.push({ id: block.id, level, text })
  }
  return entries
}
