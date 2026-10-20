import type { ComputedRef, InjectionKey } from "vue"
import type { Settings } from "./useSettings"
import type { Theme } from "@/types/workspace"
import type { ManualOverride } from "@/lib/theme-mode"
import { computed, inject, onScopeDispose, provide, ref, watch } from "vue"
import { isTauriRuntime } from "@/lib/fs"
import { resolvePlace } from "@/lib/place"
import { applyOverride, displayFor } from "@/lib/theme-mode"

/**
 * 界面配色的落点：把 `useSettings()` 里那份 `theme` 偏好推成「现在是深色还是浅色」，
 * 再把结果挂到 `<html class="dark">` 上。
 *
 * 三条边界：
 *
 * 1. **推导在纯函数里**（`lib/theme-mode.ts`），这里只负责时钟、订阅与 DOM。
 *    休眠唤醒、改系统时间都靠「重新问一次此刻」，不靠定时器对齐 —— 所以定时器
 *    只需一个粗粒度的心跳（30 秒），够在跳变点后第一时间切换，也不值得更密。
 * 2. **手动覆盖只在当前时段槽里有效**（见 `ManualOverride`）。槽一变这个 ref 就作废，
 *    不需要在别的文件里记得来清它。
 * 3. **首帧就要对**：`watch(..., { immediate: true })` 在 setup 里同步跑一次，
 *    类名在浏览器画第一帧之前就挂好，深色下不会先闪一下白。
 */

/** 心跳间隔。跳变点的精度要求是「一分钟内」，30 秒足够，也不至于频繁唤醒。 */
const TICK_MS = 30_000

const DARK_QUERY = "(prefers-color-scheme: dark)"

export interface ThemeContext {
  /** 当前生效的配色（已叠上手动覆盖）。 */
  theme: ComputedRef<Theme>
  /** 标签栏那颗按钮：手动模式改模式，自动模式记一次时段内覆盖。 */
  toggle: () => void
}

function prefersDark(): boolean {
  return window.matchMedia(DARK_QUERY).matches
}

function createTheme(settings: Settings): ThemeContext {
  const themeSettings = settings.theme
  const { setTheme } = settings

  /** 心跳。`now` 一变，`display` 重算，跨过跳变点就自动换色。 */
  const now = ref(Date.now())
  const system = ref<Theme>(prefersDark() ? "dark" : "light")
  const override = ref<ManualOverride | null>(null)

  const place = computed(() => resolvePlace(themeSettings.value))
  const display = computed(() =>
    displayFor(themeSettings.value, place.value, new Date(now.value), system.value),
  )
  const theme = computed<Theme>(() => applyOverride(display.value, override.value))

  /**
   * 覆盖的过期：时段槽换了就丢掉。
   *
   * 写在 watch 里而不是 `applyOverride` 里：后者是纯函数，让它顺手改状态就不好测了。
   * 丢掉之前 `applyOverride` 已经因为槽对不上而忽略它，所以这里只负责把 ref 清干净。
   */
  watch(display, (current) => {
    if (override.value !== null && override.value.slot !== current.slot) override.value = null
  })

  function toggle() {
    const next: Theme = theme.value === "dark" ? "light" : "dark"
    // 手动模式：按钮就是那个设置本身，直接改写模式。
    if (themeSettings.value.mode === "light" || themeSettings.value.mode === "dark") {
      setTheme({ mode: next })
      return
    }
    // 自动模式：只覆盖当前时段，下一个跳变点自动接管（ADR-0014）。
    override.value = { theme: next, slot: display.value.slot }
  }

  /**
   * 落到 DOM。界面这边只剩一个类名；**原生标题栏得单独说一声** —— 它是 DWM 画的，
   * 读不到 CSS。交给 `set_window_theme`（`src-tauri/src/lib.rs`）：
   *
   * - 它同时走框架的 `set_theme` 与 Windows 的 `DWMWA_USE_IMMERSIVE_DARK_MODE`。
   *   只靠前者时实测标题栏不会变色（`DwmGetWindowAttribute(20)` 始终是 0），
   *   界面深了、窗口边框还亮着 —— 那正是这个 bug 的样子。
   * - 传**推出来的结果**而不是「跟随系统」的 null：系统外观一变 `theme` 就会重算并
   *   再走一遍这里，不需要让系统替我们决定。
   * - 失败**不许静默**：这条链路断掉时界面照常变深、只有标题栏留在原地，吞掉错误
   *   等于把 bug 藏起来（真藏过一次，查了很久）。
   */
  function applyToDocument(value: Theme) {
    document.documentElement.classList.toggle("dark", value === "dark")
    if (!isTauriRuntime()) return
    void (async () => {
      const { invoke } = await import("@tauri-apps/api/core")
      await invoke("set_window_theme", { dark: value === "dark" })
    })().catch((error: unknown) => {
      console.warn("[webnote] 窗口外观没跟上界面外观（原生标题栏会停在系统那一侧）", error)
    })
  }

  // immediate：首帧就挂上类名。依赖只有配色本身 —— 模式换成「跟随系统」而系统恰好
  // 也是深色时配色没变，原生标题栏也不需要再动（我们永远传明确的一侧，不传 null）。
  watch(theme, () => applyToDocument(theme.value), {
    immediate: true,
  })

  /** 系统外观翻转。跟随系统时它直接改配色；其它模式下只更新推导依据（不影响当槽）。 */
  const media = window.matchMedia(DARK_QUERY)
  const onSystemChange = (event: MediaQueryListEvent) => {
    system.value = event.matches ? "dark" : "light"
  }
  media.addEventListener("change", onSystemChange)

  /**
   * 心跳与「回到前台立刻对一次」。
   *
   * 窗口最小化 / 休眠期间定时器可能被节流甚至停摆，醒来后第一次 tick 才知道时间过了多久；
   * 但用户切回来的那一刻本来就该立刻正确，所以 focus 与 visibilitychange 也各问一次。
   */
  const timer = window.setInterval(() => (now.value = Date.now()), TICK_MS)
  const refresh = () => (now.value = Date.now())
  const onVisibility = () => {
    if (document.visibilityState === "visible") refresh()
  }
  window.addEventListener("focus", refresh)
  document.addEventListener("visibilitychange", onVisibility)

  onScopeDispose(() => {
    window.clearInterval(timer)
    window.removeEventListener("focus", refresh)
    document.removeEventListener("visibilitychange", onVisibility)
    media.removeEventListener("change", onSystemChange)
  })

  return { theme, toggle }
}

const THEME_CONTEXT: InjectionKey<ThemeContext> = Symbol("webnote-theme")

/**
 * 在 App.vue 调用一次，子树里用 `useTheme()`。
 *
 * 偏好是**传进来**的，不是自己 `useSettings()` 取的：组件 inject 只会向上找父级，
 * 同一次 setup 里刚 provide 出去的东西自己 inject 不到。
 */
export function provideTheme(settings: Settings): ThemeContext {
  const context = createTheme(settings)
  provide(THEME_CONTEXT, context)
  return context
}

export function useTheme(): ThemeContext {
  const context = inject(THEME_CONTEXT)
  if (!context) throw new Error("useTheme() 必须在 provideTheme() 的子树内调用")
  return context
}
