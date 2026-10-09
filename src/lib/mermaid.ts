import type { MermaidConfig } from "mermaid"
import type mermaid from "mermaid"

/**
 * Mermaid 渲染。
 *
 * 三条约束决定了这里的形状：
 *
 * 1. **动态 import**。mermaid 连着它的依赖（cytoscape / dagre / chevrotain / 大半个 d3）
 *    打包后接近 1MB，静态引入等于每篇不画图的笔记都得白拖一遍。等真的出现图块再加载，
 *    且进程内只加载一次。
 * 2. **结果按「块 id + 源码」缓存**。带上块 id 不是为了区分内容，是为了区分**身份** ——
 *    mermaid 把传入的 id 用作 SVG 根元素 id，还拿它派生内部 marker / clipPath 的 id。
 *    同一个 id 渲染两次、两份 SVG 同时挂在文档里，箭头标记会互相串。
 *    带上 id 之后，同一块切走再切回来能命中缓存（这才是缓存要解决的场景），
 *    不同块各渲染各的。
 * 3. **失败要收敛成人话**。mermaid 抛出来的形状不定（Error / 字符串 / 解析器的
 *    `{ str, hash }`），直接摊给用户没法看。
 */

/** mermaid 默认导出的类型 —— 动态 `import()` 拿到的就是它。 */
type MermaidApi = typeof mermaid

/**
 * 渲染参数。
 *
 * `startOnLoad` 必须关掉：默认值会让 mermaid 去扫描文档里的 `.mermaid` 元素自动渲染，
 * 而这里的图全是按需渲染的，开着只会白扫一遍 DOM。
 *
 * 其余留默认：`securityLevel` 的默认值就是 `strict`（图源码多半是从别处剪来的，
 * 不要点击跳转、不要内联 HTML），再写一遍只是噪音。
 */
function config(): MermaidConfig {
  return {
    startOnLoad: false,
    // 编辑器是中立灰阶，mermaid 自带的 default 主题偏蓝紫，和界面打架。
    theme: "neutral",
    fontFamily: documentFontFamily(),
    // 错误由我们自己呈现，别让 mermaid 往 DOM 里塞一张写着 Syntax error 的图。
    suppressErrorRendering: true,
  }
}

/**
 * 图里的文字跟着正文的字体栈走。
 *
 * 从 `--font-sans` 读而不是复述字面量：那条 token 的唯一真源在 `style.css`，
 * 抄一份进 TS 迟早漂移。探针页没引 style.css 时会取到空串，退回 mermaid 默认。
 */
function documentFontFamily(): string | undefined {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim()
  return value === "" ? undefined : value
}

let loading: Promise<MermaidApi> | null = null

/** 加载并初始化。`initialize()` 会把配置写进全局单例，所以只能做一次。 */
function loadMermaid(): Promise<MermaidApi> {
  if (loading !== null) return loading
  loading = import("mermaid").then((module) => {
    const api = module.default
    api.initialize(config())
    return api
  })
  return loading
}

const cache = new Map<string, string>()

/** 渲染成 SVG 字符串。同一块、同一份源码只真的渲染一次。 */
export async function renderMermaid(id: string, source: string): Promise<string> {
  const key = `${id}\n${source}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit

  const api = await loadMermaid()
  try {
    const { svg } = await api.render(id, source)
    cache.set(key, svg)
    return svg
  } catch (error) {
    throw new Error(describeError(error))
  }
}

/** 把 mermaid 抛出来的各种形状压成一句能显示的 message。 */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (typeof error === "object" && error !== null) {
    const message = Reflect.get(error, "message")
    if (typeof message === "string" && message !== "") return message
    const raw = Reflect.get(error, "str")
    if (typeof raw === "string" && raw !== "") return raw
  }
  return String(error)
}
