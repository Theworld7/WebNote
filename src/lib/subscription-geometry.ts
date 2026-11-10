/**
 * 订阅卡几何规格 —— 编辑器视图与导出快照共用的唯一数值真源。
 *
 * 同一个订阅块有两套 CSS：
 * - `SubscriptionBlockView.vue` 的 `<style scoped>`，类名 `.subs-*`，吃 Tailwind 的
 *   `--card` / `--elev-block` token，能 hover、能就地勾选；
 * - `typography.ts` 的 `docStyle()` 里的 `.note-sub-*`，写进单文件笔记，吃 `--fg` /
 *   `--muted` token，是一张静态纸面。
 *
 * 两套 CSS 不可能合并：导出文件不带运行时样式表，也不能被界面偏好改了几何
 * （ADR-0040 把导出快照钉成固定形态）。但**同一件东西的尺寸不该有两个数**：
 * 以前 `248px` 的卡片下限、`44px` 的图标、`14px` 的栅格间距在两边各写一遍，
 * 改一边就会让「编辑器里看着挺好、双击打开全变了」。
 *
 * 这里按 `SYSTEM_FONT_STACK` ↔ `style.css --font-sans` 的既有惯例办：数值只有这一份，
 * 导出侧是模板字符串、直接插值引用；编辑器侧 CSS 取不到 TS 常量，保留字面量副本，
 * 由 `design/subscription-geometry-check.html` 逐项读源码 + 量 computed 把漂移钉住。
 *
 * `design/subscription-card-preview.html` 是设计探索稿，它的 42px 图标 / 18px 间距 /
 * 320px 下限是另一套画板规格，**不参与运行时几何**，别把它并进来。
 */

/** 两边必须逐像素相同的尺寸。改这里的数，两边一起改。 */
export const SUB_GEOMETRY = Object.freeze({
  /** 宫格自适应列的下限；低于它宁可溢出也不把卡片挤成竖条。 */
  gridMinPx: 248,
  /** 宫格间距。 */
  gridGapPx: 14,
  /** 服务图标：宽高同一个数，首字或封面都按这个方框裁。 */
  iconSizePx: 44,
  iconRadiusPx: 13,
  /** 卡片右下角的装饰同心圆。负数偏移是「故意出血」。 */
  ornamentSizePx: 190,
  ornamentRightPx: -58,
  ornamentBottomPx: -86,
  /** 顶部汇总条的外框圆角。 */
  summaryRadiusPx: 18,
})

/**
 * 两边**有意不同**的一组：编辑器卡片要留 hover 抬升、就地勾选和悬浮工具条的余量，
 * 导出是纸面、按 720px 版心收紧一圈。自检页会断言这些值各自等于本表的规格，
 * 且两边不相等 —— 防止后来有人「顺手统一」把导出快照的外观改掉。
 */
export const SUB_EDITOR_GEOMETRY = Object.freeze({
  cardRadiusPx: 18,
  cardPaddingPx: 18,
  /** 编辑器卡片有 min-height，导出快照靠内容自然撑开。 */
  cardMinHeightPx: 216,
  summaryMarginBottomPx: 14,
  statPaddingTopPx: 16,
  statPaddingInlinePx: 20,
  statPaddingBottomPx: 17,
  /** 汇总条竖分隔线上下留白，不顶到卡片边缘。 */
  dividerInsetPx: 16,
})

export const SUB_EXPORT_GEOMETRY = Object.freeze({
  cardRadiusPx: 16,
  cardPaddingPx: 16,
  summaryMarginBottomPx: 12,
  statPaddingTopPx: 14,
  statPaddingInlinePx: 16,
  statPaddingBottomPx: 15,
  dividerInsetPx: 14,
})
