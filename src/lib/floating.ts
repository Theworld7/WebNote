/**
 * 浮层的两条通用算术：钉在哪、跟着谁收。
 *
 * 账目的日期月历与各处的选择格都是「挂在 body 上、`fixed` 定位」的浮层 —— 块里的
 * 表格外面套着 `overflow-x-auto`，长在格内的浮层靠下面几行时会被裁掉。既然是同一套
 * 几何，就不该每处各算一遍；这里只有纯函数与一个订阅函数，不含任何组件状态。
 */

/** 浮层落位：视口坐标，`width` 是希望的最小宽度（调用方照它设 `min-width`）。 */
export interface FloatingPlacement {
  top: number
  left: number
  width: number
}

/** 与视口边缘留的空隙。贴边会让浮层看起来像被切掉。 */
const MARGIN = 8
/** 与锚点之间的缝。 */
const GAP = 4

/**
 * 从锚点往上找**真正可滚**的祖先。
 *
 * `scroll` 不冒泡，所以在 window 上加 capture 会把所有后代的滚动都收进来 —— 页面一
 * 加载，编辑器自己的滚动容器滚一下就把刚打开的浮层关掉。只有那几个真正能滚的祖先
 * 滚动时，锚点才会跟着位移。
 */
export function scrollAncestors(anchor: HTMLElement): HTMLElement[] {
  const found: HTMLElement[] = []
  let node = anchor.parentElement
  while (node !== null) {
    if (node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth) found.push(node)
    node = node.parentElement
  }
  return found
}

/**
 * 订阅那些祖先的滚动，返回解除函数。
 *
 * 返回函数而不是自己存一份状态：同一时刻只可能有一个浮层开着，状态归开它的那个人
 * 管，换一个浮层就调一次旧的解除，不会互相踩。
 */
export function watchScrollHosts(anchor: HTMLElement, onScroll: () => void): () => void {
  const hosts = scrollAncestors(anchor)
  for (const host of hosts) host.addEventListener("scroll", onScroll, { passive: true })
  return () => {
    for (const host of hosts) host.removeEventListener("scroll", onScroll)
  }
}

/**
 * 把浮层钉在锚点下方：左右夹回视口，下方放不下就翻到上方。
 *
 * `height` 由调用方估（选项数 × 单项高度 / 月历的固定高），`width` 是希望的最小宽度，
 * `maxWidth` 参与左右夹取的宽度 —— 夹取要按**实际渲染宽度**算，否则窄格子上会白留
 * 一截空白，宽格子上又会顶出视口。
 */
export function placeBelow(
  rect: DOMRect,
  size: { height: number; width: number; maxWidth?: number },
): FloatingPlacement {
  const width = Math.min(size.width, size.maxWidth ?? Number.POSITIVE_INFINITY)
  const below = rect.bottom + GAP
  const top = below + size.height > window.innerHeight ? Math.max(MARGIN, rect.top - size.height - GAP) : below
  const left = Math.min(Math.max(MARGIN, rect.left), Math.max(MARGIN, window.innerWidth - width - MARGIN))
  return { top, left, width: size.width }
}
