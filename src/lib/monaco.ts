/**
 * Monaco 编辑器的懒加载入口（VS Code 同源编辑器内核，用于 HTML 块的源码抽屉）。
 *
 * 整包 + 语言 worker 都是重依赖，必须留在动态 import 的分支里 —— 主包永不触碰
 * 本模块，抽屉第一次打开才拉取（Vite 据此切成独立 chunk，worker 各自成文件）。
 *
 * worker 用 `new Worker(new URL(相对路径, import.meta.url))` 起，**不走**
 * `monaco-editor/...?worker` 子路径导入：monaco 0.57 的包 exports 通配会把含
 * esm 的子路径二次拼接，rolldown 对子路径 + `?worker` 的解析也不可靠（实测
 * 模块内第一个 `?worker` import 必挂、换谁的路径都一样）。相对文件路径直指
 * node_modules，两层坑全绕开；Vite 的 new-URL-worker 协议会把它打成独立 chunk。
 */
/** 导出给 `lib/monaco-theme.ts` 用 —— 配色要调 `monaco.editor.defineTheme`。 */
export type Monaco = Awaited<ReturnType<typeof importMonaco>>

/** 动态 import 收口成函数：Monaco 类型从它推导，绕开包类型入口与运行时入口的错位。 */
function importMonaco() {
  return import("monaco-editor")
}

let cached: Promise<Monaco> | null = null

export function loadMonaco(): Promise<Monaco> {
  if (cached === null) {
    // Environment 类型从主包取 —— 这里只出现在类型位置，不会把整包拽进主 chunk。
    const environment: import("monaco-editor").Environment = {
      getWorker(_workerId: string, label: string): Worker {
        // 路径相对本文件（src/lib/）—— ../../ 进到项目根下的 node_modules。
        if (label === "html" || label === "handlebars" || label === "razor") {
          return new Worker(new URL("../../node_modules/monaco-editor/esm/vs/language/html/html.worker.js", import.meta.url), { type: "module" })
        }
        if (label === "css" || label === "scss" || label === "less") {
          return new Worker(new URL("../../node_modules/monaco-editor/esm/vs/language/css/css.worker.js", import.meta.url), { type: "module" })
        }
        if (label === "typescript" || label === "javascript") {
          return new Worker(new URL("../../node_modules/monaco-editor/esm/vs/language/typescript/ts.worker.js", import.meta.url), { type: "module" })
        }
        if (label === "json") {
          return new Worker(new URL("../../node_modules/monaco-editor/esm/vs/language/json/json.worker.js", import.meta.url), { type: "module" })
        }
        // 未命中的标签兜底给**基础编辑器 worker**（editorWorkerService：词高亮 /
        // 链接 / diff 等编辑器基础服务）。不能兜给语言 worker：getWorker 是语言
        // worker 和基础 worker 共用的入口，基础 worker 客户端的消息协议与语言
        // worker 不同（语言 worker 的入口把第二条消息当 createData 吃掉），错路由
        // 会在 worker 里炸出 `reading 'data'` 并被 Monaco 兜底 rethrow 到主线程。
        return new Worker(new URL("../../node_modules/monaco-editor/esm/vs/editor/editor.worker.js", import.meta.url), { type: "module" })
      },
    }
    window.MonacoEnvironment = environment
    cached = importMonaco().then((monaco) => {
      // 环境必须在首次 create 之前就位 —— worker 是编辑器实例化时按语言要的。
      window.MonacoEnvironment = environment
      return monaco
    })
  }
  return cached
}
