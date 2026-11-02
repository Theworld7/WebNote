import { computed, onBeforeUnmount, ref } from "vue"

/**
 * 窄于这个宽度，侧栏就从「布局里的一栏」变成「盖在编辑区上的浮层」。
 *
 * 900 是原来自动折叠用的阈值，原样沿用 —— 侧栏 232 加拖拽条 12，再窄编辑区就只剩
 * 一行字。浮层比起折叠多出来的那一步只是：展开时不再挤压正文。
 */
export const OVERLAY_AT = 900

const COLLAPSED_KEY = "webnote:sidebar-collapsed"

function readCollapsed(): boolean {
  return window.localStorage.getItem(COLLAPSED_KEY) === "1"
}

/**
 * 侧栏的可见性，宽屏与窄屏两套语义分开存：
 *
 * - 宽屏：它是布局里的一栏，收起与否是**用户的选择**，落 localStorage，跨会话记住。
 * - 窄屏（手机 / 平板竖屏 / 超窄窗口）：它是一张盖在编辑区上的浮层，**默认不出现**。
 *   这个「露没露面」不落盘 —— 那是每次进来都要重新决定的事，记住它只会让下次打开
 *   时莫名其妙地挡着正文。
 *
 * 跨越断点时把浮层收回去：宽屏那边它没有意义，窄屏这边要求「默认隐藏」。
 * 原先那套 `autoCollapsed`（窄窗自动折叠、点一下只是临时解除）被这里吃掉了 ——
 * 窄屏统一走浮层，不用再靠一个镜像状态去纠正用户的选择。
 */
export function useSidebarLayout() {
  const overlay = ref(window.innerWidth < OVERLAY_AT)
  const open = ref(false)
  const collapsed = ref(readCollapsed())

  /** 侧栏此刻在不在屏幕上。宽屏读用户偏好，窄屏读浮层。 */
  const hidden = computed(() => (overlay.value ? !open.value : collapsed.value))

  function sync() {
    const next = window.innerWidth < OVERLAY_AT
    if (next === overlay.value) return
    overlay.value = next
    open.value = false
  }

  function toggle() {
    if (overlay.value) {
      open.value = !open.value
      return
    }
    collapsed.value = !collapsed.value
    window.localStorage.setItem(COLLAPSED_KEY, collapsed.value ? "1" : "0")
  }

  function close() {
    open.value = false
  }

  window.addEventListener("resize", sync)
  onBeforeUnmount(() => window.removeEventListener("resize", sync))

  return { overlay, open, hidden, toggle, close }
}
