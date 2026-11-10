import { cn } from "@/lib/utils"

/**
 * 虚线提示条的三种体量。原先 14 处各写一遍 `border border-dashed border-line`，
 * 连 `my-1 / my-4 / mb-2`、`bg-muted/40 vs /30` 都各挑各的 —— 同一个「这是可恢复的
 * 正常态，不是错误」的意思，却出现了八种写法。这里只收口**配方**，不收口结构：
 * 各处的内容（图标、按钮、说明文字）仍由调用方自己排。
 *
 * 两档底色是有意的：`/40` 给带图标的操作条（它要浮在内容上），`/30` 给纯文字提示
 * （它已经是内容的一部分，再深一层会像报错）。圆角走刻度，不写任意 px（ADR-0040）。
 *
 * DataTableEditor 里那两处 `border-dashed` 是**输入框与空格子占位**，不是提示条，
 * 不并入这里 —— 它们的语义是「可填 / 可拖」，不是「可恢复」。
 */

/** 带图标的操作条：文件引用失效、图片 / 视频没选文件。 */
export const NOTICE_INLINE =
  "my-4 flex items-center gap-2.5 rounded-lg border border-dashed border-line bg-muted/40 px-3 py-2.5"

/** 同上，但贴着上一行内容（my-1）且图标与多行文字顶部对齐。 */
export const NOTICE_INLINE_COMPACT = cn(NOTICE_INLINE, "my-1 items-start")

/** 纯文字提示：字段没挑、卡片没指向。 */
export const NOTICE_TEXT =
  "rounded-lg border border-dashed border-line bg-muted/30 px-3 py-2.5 text-12 text-muted-foreground"

/** 纯文字提示，与下方内容拉开一点（mb-2）。 */
export const NOTICE_TEXT_TIGHT = cn(NOTICE_TEXT, "mb-2")

/** 大空态：整块还没内容，居中留白。 */
export const NOTICE_EMPTY =
  "rounded-xl border border-dashed border-line px-4 py-8 text-center text-12 text-muted-foreground"

/** 大空态的略矮一档。 */
export const NOTICE_EMPTY_TIGHT = cn(NOTICE_EMPTY, "py-7")
