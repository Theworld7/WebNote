import { onBeforeUnmount, ref } from "vue"

/**
 * 「刚复制完」的短暂状态。
 *
 * 复制是那种按下去**看不见结果**的动作：剪贴板在系统里，界面上什么都没变，
 * 而写剪贴板失败时浏览器也未必抛。所以每一处复制入口都得自己给一句确认 ——
 * 代码块、歌单、文件树路径原本各写一份计时器，连停留时长都不一致。
 *
 * 用法：`const { copied, flash } = useCopied()`，复制成功后 `flash()`。
 */
export function useCopied(duration = 1500) {
  const copied = ref(false)
  let timer: number | undefined

  function flash(): void {
    copied.value = true
    window.clearTimeout(timer)
    timer = window.setTimeout(() => (copied.value = false), duration)
  }

  onBeforeUnmount(() => window.clearTimeout(timer))

  return { copied, flash }
}
