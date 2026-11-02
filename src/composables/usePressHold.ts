import { onBeforeUnmount, ref } from "vue"

/** 手指移动超过这个距离就当「不是按住」—— 滚动列表时不该一路留着按压底色。 */
const MOVE_TOLERANCE = 8

/**
 * 按住不放的视觉状态。
 *
 * 不用 CSS 的 `:active`：触摸端它靠不住。Chrome 在可滚动容器里要等到确认这不是滚动手势
 * 才给 `:active`，实测在树行上按住整整 580ms，`matches(":active")` 全程是 false，底色
 * 一动不动；iOS Safari 另外还要求元素自己挂着 touch 监听。长按本来就是我们自己的交互，
 * 按压态也自己算。
 *
 * 只管「按下 / 松开 / 移开」三件事，**不参与长按计时** —— 到点弹菜单是 reka 的
 * `pressOpenDelay`（`LONG_PRESS_MS`）的活，这里多算一次只会两边漂移。指针设备不参与：
 * 鼠标那边有 `hover:` 那一层，再叠一层按压反而让点击显得拖泥带水。
 */
export function usePressHold() {
  const pressed = ref(false)
  let origin: { x: number; y: number } | null = null

  function down(event: PointerEvent) {
    if (event.pointerType === "mouse") return
    origin = { x: event.clientX, y: event.clientY }
    pressed.value = true
  }

  function move(event: PointerEvent) {
    if (origin === null) return
    if (Math.abs(event.clientX - origin.x) > MOVE_TOLERANCE || Math.abs(event.clientY - origin.y) > MOVE_TOLERANCE) {
      release()
    }
  }

  function release() {
    origin = null
    pressed.value = false
  }

  onBeforeUnmount(release)

  return { pressed, down, move, release }
}
