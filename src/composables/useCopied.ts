import { computed, onBeforeUnmount, ref } from "vue"

/**
 * 「刚复制完」的短暂状态。
 *
 * 复制是那种按下去**看不见结果**的动作：剪贴板在系统里，界面上什么都没变，
 * 而写剪贴板失败时浏览器也未必抛。所以每一处复制入口都得自己给一句确认 ——
 * 代码块、歌单、文件树路径原本各写一份计时器，连停留时长都不一致。
 *
 * 状态**按 key 记**：一个块里可能并排好几处复制入口（密码本每一行各有一颗），
 * 共用一份布尔量就会「复制了第一条，六行全变成已复制」。只有一个按钮的调用方
 * （代码块、歌单、口令框）照旧不传 key，空串本身也是一个合法 key。
 *
 * 用法：`const { copied, isCopied, flash } = useCopied()`，复制成功后 `flash()`；
 * 分行的场景传各自的行 id，渲染时问 `isCopied(row.id)`。
 */
export function useCopied(duration = 1500) {
  /** 最近一次复制的是谁。`null` = 没有正在闪的确认，与「复制了空 key」区分开。 */
  const copiedKey = ref<string | null>(null)
  const copied = computed(() => copiedKey.value !== null)
  let timer: number | undefined

  function flash(key = ""): void {
    copiedKey.value = key
    window.clearTimeout(timer)
    timer = window.setTimeout(() => (copiedKey.value = null), duration)
  }

  /** 这一处（`key`）是不是刚复制过。 */
  function isCopied(key = ""): boolean {
    return copiedKey.value !== null && copiedKey.value === key
  }

  onBeforeUnmount(() => window.clearTimeout(timer))

  return { copied, isCopied, flash }
}
