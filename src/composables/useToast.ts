import { readonly, ref } from "vue"

export type ToastKind = "success" | "error"

export interface Toast {
  id: number
  message: string
  kind: ToastKind
}

/**
 * 全应用共用的瞬态提示。
 *
 * 与编辑区顶部那条常驻的 `fsError` 分得很清楚：
 *
 * - `fsError` 说的是「有东西读 / 写失败了」，它是一个**状态** —— 用户处理完才关，
 *   所以常驻、可手动关闭、一次只留最新的一条；
 * - 这里说的是「你刚才那个动作成了」，说完就该走，不该占用任何布局，也不该被
 *   当成需要处理的信息。
 *
 * 模块作用域的单例：提示不属于某个组件，谁都能发，只有一处渲染（`ToastStack`）。
 * 只在「动作完成但界面看不出变化」的地方用它 —— 复制进剪贴板是典型，因为剪贴板
 * 在系统里，按下去什么都没有发生。
 */
const toasts = ref<Toast[]>([])
let serial = 0

/** 停留时长。够读一句短话，又不至于挡视线。 */
const DEFAULT_DURATION = 2000

function notify(message: string, kind: ToastKind = "success", duration = DEFAULT_DURATION): void {
  const id = (serial += 1)
  toasts.value = [...toasts.value, { id, message, kind }]
  window.setTimeout(() => dismissToast(id), duration)
}

function dismissToast(id: number): void {
  toasts.value = toasts.value.filter((toast) => toast.id !== id)
}

export function useToast() {
  return { toasts: readonly(toasts), notify, dismissToast }
}
