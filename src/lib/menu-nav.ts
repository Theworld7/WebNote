/**
 * 横向菜单的方向键寻路。
 *
 * 横向布局的块菜单把分组并排成几列，DOM 里却仍是一条直线：菜单原生的上 / 下是按
 * **文档顺序**取下一个项，于是「列底按 ↓」会跳到下一列顶上 —— 想去右边那一列，
 * 只能把这一列按到底。这里不猜语义，按**几何位置**挑目标：纵向移动留在同一列、
 * 横向移动落在同一行，视觉上箭头指哪儿焦点去哪儿。
 *
 * 纯函数，输入是各项的外接矩形 —— `design/menu-nav-check.html` 直接喂坐标断言，
 * 不必挂真实菜单；`BlockToolbar` 那边只负责把矩形收集齐、按返回值落焦点。
 */

/** 四个方向。与键盘的 Arrow* 一一对应，映射在调用方做。 */
export type MenuArrow = "up" | "down" | "left" | "right"

/** 菜单项的外接矩形（视口坐标）。`DOMRect` 结构兼容，传进来不必转换。 */
export interface MenuItemBox {
  left: number
  top: number
  right: number
  bottom: number
}

/** 次轴偏差的权重。主轴（移动方向上的间距）远小于它，保证「优先同一行 / 同一列」。 */
const CROSS_WEIGHT = 1000

/**
 * 判「在那个方向上」的容差。
 *
 * 相邻两列若是 1px 的亚像素错位，`box.left - from.right` 会是 -0.x —— 严格大于 0
 * 会把真正在右边的那一整列排除掉。1px 足够吸收这种舍入，又不会把同一行上重叠的
 * 项误判成邻居。
 */
const ALIGN_TOLERANCE = 1

/** 矩形中心。次轴距离按中心算：同一列里各项高矮一致，中心差就是 0。 */
function centerX(box: MenuItemBox): number {
  return (box.left + box.right) / 2
}

function centerY(box: MenuItemBox): number {
  return (box.top + box.bottom) / 2
}

/**
 * 找方向键该落到哪一项。返回 `boxes` 里的下标；那个方向上没有候选时返回 `null`
 * —— 由调用方决定「到边了」是停住还是把按键让回给菜单本身。
 *
 * **纵向只管同一列**：先按左缘筛掉别的列，再取最近的上一项 / 下一项。不筛的话，
 * 旁边那列只要更长，列底按 ↓ 就会「找到」它更靠下的项 —— 也就是这页要修的毛病换了个
 * 方向复发（实测：位置列列底按 ↓ 会跳到「标题 2」）。列与列之间用 ←/→。
 *
 * **横向不锁行**：各列高矮不一，同一行未必有项，按「次轴（行中心）最近」挑，
 * 所以从短列底部按 → 也能落到右列最接近的那一行。
 */
export function arrowTargetIndex(
  boxes: readonly MenuItemBox[],
  current: number,
  arrow: MenuArrow,
): number | null {
  const from = boxes[current]
  if (from === undefined) return null

  const horizontal = arrow === "left" || arrow === "right"
  let best: number | null = null
  let bestScore = Number.POSITIVE_INFINITY

  for (const [index, box] of boxes.entries()) {
    if (index === current) continue

    // 纵向：不是同一列就跳过。
    if (!horizontal && Math.abs(box.left - from.left) > ALIGN_TOLERANCE) continue

    // 主轴间隙：向下看下沿到上沿、向右看右缘到左缘，其余方向对称。
    const gap = horizontal
      ? arrow === "right"
        ? box.left - from.right
        : from.left - box.right
      : arrow === "down"
        ? box.top - from.bottom
        : from.top - box.bottom
    if (gap < -ALIGN_TOLERANCE) continue

    // 次轴偏差：横向移动看行的对齐，纵向移动看列的对齐。
    const cross = horizontal ? Math.abs(centerY(box) - centerY(from)) : Math.abs(centerX(box) - centerX(from))
    const score = cross * CROSS_WEIGHT + Math.max(gap, 0)
    if (score < bestScore) {
      bestScore = score
      best = index
    }
  }

  return best
}
