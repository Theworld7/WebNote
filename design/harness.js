/**
 * 自检页共用的断言 harness。
 *
 * `design/*check*.html` 有 61 份页面各抄了一遍 `const lines = [] / let passed / let failed /
 * function check(...)` 和两个 window 错误监听。协议必须与 `cdp-dump.mjs` 对齐：
 * 收尾行要写成 `自检 N/N`（它的 DONE 正则靠这行判断探针跑完），
 * 未捕获异常要写成 `REJECT …` / `ERROR …` 开头（驱动见到就立刻收工）。
 *
 * 存量页暂不改：它们里有一半会在 `check()` 里流式刷新 `#out`，还有的自己 `lines.unshift()`
 * 或往收尾行后面追加额外的 DOM 标记，整页替换反而会把这些行为抹掉。**新自检页一律用这里**，
 * 存量页等在改动到它时顺势迁移。
 */
export function createHarness(outId = "out") {
  const out = document.getElementById(outId)
  const lines = []
  let passed = 0
  let failed = 0

  window.addEventListener("unhandledrejection", (event) => {
    out.textContent = "REJECT " + (event.reason?.stack ?? String(event.reason))
  })
  window.addEventListener("error", (event) => {
    out.textContent = "ERROR " + event.message
  })

  /** 一条断言。detail 只在失败时打印，别把正常结果也刷一屏。 */
  function check(name, ok, detail = "") {
    if (ok) {
      passed += 1
      lines.push(`OK   ${name}`)
    } else {
      failed += 1
      lines.push(`FAIL ${name} —— ${detail}`)
    }
  }

  /** 长任务中途报进度。注意别在最后一条断言之后调用，会盖掉收尾行。 */
  function note(next) {
    out.textContent = `running: ${next}`
  }

  /** 收尾。返回是否全过，供页面顺手做点别的（截图标记、全局 done 标志）。 */
  function done() {
    out.textContent = [
      ...lines,
      failed === 0 ? `自检 ${passed}/${passed}` : `自检 ${passed} 过 / ${failed} 败`,
    ].join("\n")
    return failed === 0
  }

  return { check, note, done, lines, counts: () => ({ passed, failed }) }
}
