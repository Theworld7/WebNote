import { onBeforeUnmount, ref, watch } from "vue"

const MIN_WIDTH = 180
const MAX_WIDTH = 420
const DEFAULT_WIDTH = 232
const STORAGE_KEY = "webnote:sidebar-width"

function readStoredWidth(): number {
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (raw === null) return DEFAULT_WIDTH
  const parsed = Number.parseFloat(raw)
  if (!Number.isFinite(parsed)) return DEFAULT_WIDTH
  return Math.min(Math.max(parsed, MIN_WIDTH), MAX_WIDTH)
}

/**
 * 侧栏宽度拖拽。
 *
 * 拖动过程直接改 ref（不写 localStorage，避免每帧一次同步 IO），
 * 松手后才落盘。宽度在拖拽中 clamp 到 [180, 420]。
 */
export function useResizableWidth() {
  const width = ref(readStoredWidth())
  const dragging = ref(false)

  function onMove(event: MouseEvent) {
    width.value = Math.min(Math.max(event.clientX, MIN_WIDTH), MAX_WIDTH)
  }

  function stopDrag() {
    dragging.value = false
    window.removeEventListener("mousemove", onMove)
    window.removeEventListener("mouseup", stopDrag)
  }

  function startDrag(event: MouseEvent) {
    event.preventDefault()
    dragging.value = true
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", stopDrag)
  }

  // 只在拖拽结束后持久化，正常改动一次写一条。
  watch(dragging, (isDragging) => {
    if (!isDragging) window.localStorage.setItem(STORAGE_KEY, String(width.value))
  })

  onBeforeUnmount(stopDrag)

  return { width, dragging, startDrag }
}
