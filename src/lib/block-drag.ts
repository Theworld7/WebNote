/**
 * 块拖拽的跨组件状态。
 *
 * 拖拽由 `BlockEditor` 用 pointer 事件驱动（原因见那里的注释：原生 HTML5 拖拽会
 * 让浏览器进入「拖拽模式」，期间 wheel 被底层吞掉，滚轮滚不动正文）。改成 pointer
 * 之后就没有 dataTransfer 那条广播通道了，格子里的 `LayoutBlockView` 也得知道
 * 「现在有块在拖、指针停在我哪个格子上」—— 所以状态放模块层，两边读同一份。
 */
import { ref } from "vue"

/** 正在被拖的块 id。null = 没有块拖拽。 */
export const draggingBlockId = ref<string | null>(null)

/** 指针当前悬停的布局格子。null = 不在任何格子上，此时按顶层落点线排序。 */
export const dragOverCell = ref<{ blockId: string; cellIndex: number } | null>(null)
