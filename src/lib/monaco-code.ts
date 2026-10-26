import type { editor as monacoEditor } from "monaco-editor"
import type { Theme } from "@/types/workspace"
import { loadMonaco } from "./monaco"
import type { Monaco } from "./monaco"
import { applyMonacoTheme, monacoThemeName } from "./monaco-theme"
import { formatCode } from "./source-format"

/**
 * 代码块的就地编辑器：**整个应用同一时刻只有一个 Monaco 实例**。
 *
 * 为什么不是「每块一个」（ADR-0017）：正文是 `v-for` 全量渲染、没有虚拟滚动，一篇
 * 读书笔记常有 10~22 个代码块；每块一个实例意味着打开笔记就 create 20 多次、常驻
 * 20 多套 model / 监听 / 背景 worker 通信。实测单实例 create 约 5~33ms、约 70~170
 * 个 DOM 节点 —— 单看毫秒数不吓人，乘上块数、再叠上「每次打开都要重建」就是另一回事。
 *
 * 这里的口径是**按需进出**：静态态由 `CodeBlockView` 自己画高亮（零 Monaco 成本），
 * 点「编辑」才 create 一个、退出即 dispose。于是「打开笔记」永远不碰 Monaco，
 * 「编辑某个代码块」只付一次实例钱，和文档里有几个块无关。
 *
 * 不用「一个常驻实例 + 把容器搬进不同块」的写法：Monaco 不承诺 container 被
 * reparent 后的布局与焦点行为，得手动补 `layout()`、还得为它留一个离屏的固定尺寸
 * 停靠点（尺寸归零时 ResizeObserver 会把编辑器排成 0×0）。省下的几毫秒不值这些坑。
 */

export interface CodeEditorOptions {
  /** 挂载点。调用方保证它已在文档里、有确定宽度。 */
  host: HTMLElement
  value: string
  /** 块的 `lang`；空串或 Monaco 不认识时按纯文本处理。 */
  language: string
  theme: Theme
  /** 代码字体栈（`--font-code` 的当前值）。Monaco 不认 CSS 变量，只能喂字符串。 */
  fontFamily: string
}

export interface CodeEditorHandle {
  editor: monacoEditor.IStandaloneCodeEditor
  monaco: Monaco
  /** 卸载并销毁实例；调用方的容器与高度由调用方收拾。 */
  dispose: () => void
}

/**
 * 与静态层对齐的排版常量：字号 12px、行高 21px、内边距左右 14px / 上下 10px。
 *
 * 内边距**不是 Monaco 的 `padding` 选项**（它只认上下），而是 host 的 CSS
 * （`px-3.5 py-2.5`，与静态层同一个类）。这里的数值是给 layout 算可用宽高用的，
 * 改 CSS 时两边一起改，否则文字会横向漂几像素。
 *
 * 字号跟着静态层的 `text-[12px]` 走：ADR-0027 把界面字号收成九档且不留半像素，
 * 代码块也在这条线上。这三处（静态层 class、这里的常量、`firstLineCenter` 的行盒
 * 估算）没有共享常量，改一处必须同时改另外两处，`code-edit-check` 的
 * 「文字宽度一致」「字体栈同源」就是钉这个的。
 */
const FONT_SIZE = 12
const LINE_HEIGHT = 21
const PADDING_X = 14
const PADDING_Y = 10

let active: CodeEditorHandle | null = null

/** 空语言走 Monaco 的纯文本 id —— 传空串它会当成未知语言并报警。 */
function languageId(language: string): string {
  return language === "" ? "plaintext" : language
}

/**
 * 预热。悬停「编辑」按钮时调一次，把 `import("monaco-editor")` 那几百毫秒挪到
 * 用户还在移动鼠标的时候 —— 点击时通常已经就绪。失败不报：真点进去还会再走一遍。
 */
export function prefetchCodeEditor(): void {
  void loadMonaco().catch(() => undefined)
}

/**
 * 在 `host` 里开一个编辑器，返回句柄。
 *
 * 同一时刻只留一个：已有实例先销毁（正常路径下调用方退出编辑时已经 dispose 过，
 * 这里是「上一块没收干净」的兜底）。
 */
export async function openCodeEditor(options: CodeEditorOptions): Promise<CodeEditorHandle | null> {
  closeCodeEditor()

  let monaco: Monaco
  try {
    monaco = await loadMonaco()
  } catch {
    // 加载失败（离线缓存缺失 / worker 起不来）不该把块卡在空白编辑态：
    // 调用方拿到 null 会退回静态态，正文没丢。
    return null
  }
  applyMonacoTheme(monaco, options.theme)

  const { host } = options
  host.replaceChildren()

  const editor = monaco.editor.create(host, {
    value: options.value,
    language: languageId(options.language),
    theme: monacoThemeName(options.theme),
    fontSize: FONT_SIZE,
    lineHeight: LINE_HEIGHT,
    fontFamily: options.fontFamily,
    // 代码块里不需要行号 / 折叠槽 / 概览尺 —— 静态层没有这些东西，
    // 多出来一列会让「进入编辑」时整块文本横向跳一下。
    lineNumbers: "off",
    glyphMargin: false,
    folding: false,
    showFoldingControls: "never",
    lineNumbersMinChars: 0,
    lineDecorationsWidth: 0,
    renderLineHighlight: "none",
    // 缩进参考线、括号对参考线、粘性滚动都是 IDE 的脚手架，静态层一条也没有：
    // 留着的话进出编辑态会多出几道竖线，看着像「块里换了个东西」。
    guides: { indentation: false, bracketPairs: false, highlightActiveIndentation: false, highlightActiveBracketPair: false },
    stickyScroll: { enabled: false },
    renderWhitespace: "none",
    overviewRulerLanes: 0,
    hideCursorInOverviewRuler: true,
    // 高度由内容决定（见 applyHeight），永远不需要内部滚动条：
    // 块在文档流里，滚动该由笔记容器负责。
    scrollBeyondLastLine: false,
    scrollbar: { vertical: "hidden", horizontal: "hidden", alwaysConsumeMouseWheel: false },
    wordWrap: "on",
    automaticLayout: false,
    // 内边距由 host 的 CSS 提供（与静态层同一套 px-3.5 / py-2.5）。
    // Monaco 自己的 padding 只认上下、不认左右 —— 在这里补半个内边距，
    // 结果就是编辑态文字贴左、静态态缩进 14px，一切换整段横移。
    padding: { top: 0, bottom: 0 },
    contextmenu: true,
    tabSize: 2,
    // 中文正文里写代码时，自动建议常在不该弹的时候弹（打一个字母就盖住下一行）。
    // 代码块不是 IDE，补全的收益抵不上打扰，只留括号/引号自动闭合。
    quickSuggestions: false,
    suggestOnTriggerCharacters: false,
    autoClosingBrackets: "languageDefined",
    autoClosingQuotes: "languageDefined",
  })

  // 构造参数里这三条在 0.57 都靠不住（minimap 会摊出 84px 把内容挤窄、折叠箭头与
  // 缩进竖线照画）—— 建完再显式压一遍，layout 才会按新值重新分配。
  editor.updateOptions({
    minimap: { enabled: false },
    folding: false,
    showFoldingControls: "never",
    guides: { indentation: false, bracketPairs: false, highlightActiveIndentation: false, highlightActiveBracketPair: false },
    stickyScroll: { enabled: false },
  })

  /**
   * 块高 = 内容高 + host 自己的上下内边距，最少一行。
   *
   * `host` 是 border-box（Tailwind preflight），写进去的 height 含 padding，
   * 所以要把上下内边距加回来 —— 那 20px 现在归 CSS，不归 Monaco。
   */
  function applyHeight() {
    const height = Math.max(editor.getContentHeight(), LINE_HEIGHT) + PADDING_Y * 2
    if (host.style.height === `${height}px`) return
    host.style.height = `${height}px`
    editor.layout({ width: contentWidth(), height })
  }

  /** Monaco 可用的宽度 = host 内容盒宽度（去掉左右那 14px 内边距）。 */
  function contentWidth(): number {
    return Math.max(host.clientWidth - PADDING_X * 2, 0)
  }

  // 内容变高/变矮（回车、折行）跟过去。
  const contentSub = editor.onDidContentSizeChange(applyHeight)

  // 宽度只看宽度：高度是自己写进 style 的，对它也 layout 会绕回 contentSizeChange。
  let width = contentWidth()
  const observer = new ResizeObserver(() => {
    const next = contentWidth()
    if (next === 0 || next === width) return
    width = next
    editor.layout({ width: next, height: host.clientHeight - PADDING_Y * 2 })
  })
  observer.observe(host)

  applyHeight()

  const handle: CodeEditorHandle = {
    editor,
    monaco,
    dispose: () => {
      contentSub.dispose()
      observer.disconnect()
      editor.dispose()
      host.replaceChildren()
      host.style.height = ""
      if (active === handle) active = null
    },
  }
  active = handle
  return handle
}

/** 销毁当前实例（没有就什么都不做）。 */
export function closeCodeEditor(): void {
  active?.dispose()
  active = null
}

/**
 * 把编辑器里的代码排版一遍，结果写回**缓冲区**——不落盘。
 *
 * 落盘仍然归 blur / 完成（ADR-0017 的提交路径），所以排完版按 Esc 能整个丢掉，
 * 与「刚刚只是敲了几下」没有区别。反过来，如果这里直接写块，格式化就成了一个
 * 不可撤销的写入，正文里会凭空多出一层 diff —— 那是 ADR-0012 特意避开的形态。
 *
 * 返回 `false` = 这门语言没有格式化器、或者排版失败（`to be formatted` 的代码常常
 * 只写了一半，prettier 解析不了），调用方据此给一个可见的反馈。
 */
export async function formatCodeEditor(handle: CodeEditorHandle, language: string): Promise<boolean> {
  const model = handle.editor.getModel()
  if (model === null) return false
  const source = handle.editor.getValue()
  const position = handle.editor.getPosition()
  // prettier 断言 cursorOffset 落在文本内 —— 越界在这里夹紧，不把断言抛给调用方。
  const cursor = Math.min(Math.max(position === null ? 0 : model.getOffsetAt(position), 0), source.length)

  const formatted = await formatCode(language, source, cursor)
  // 排版是异步的（首次还要下插件），等回来的这段时间里块可能已经退出编辑态、
  // 实例被 dispose —— 再去碰 editor 会炸在 Monaco 内部。
  if (formatted === null || active !== handle) return false
  if (formatted.text === source) return true

  // 包一层 undo stop：一次格式化 = 一步 Ctrl+Z，而不是「和一整段手打混在一起」。
  handle.editor.pushUndoStop()
  handle.editor.executeEdits("code-format", [
    { range: model.getFullModelRange(), text: formatted.text, forceMoveMarkers: true },
  ])
  handle.editor.pushUndoStop()
  // 光标跟回它原来所指的那个字符，而不是掉到第 0 行 —— 折行 / 补空格之后偏移必然变了。
  // `-1` 是「这台引擎不给映射」（SQL），那时不设位置，光标落在这次编辑的末尾。
  if (formatted.cursorOffset >= 0) handle.editor.setPosition(model.getPositionAt(formatted.cursorOffset))
  handle.editor.focus()
  return true
}

/**
 * 当前活着的实例（没有就是 null）。
 *
 * 存在的理由是「谁在用这块编辑器」得有个答案：自检页要往里面写值、验提交，
 * 而 `monaco.editor.getEditors()` 读的是 Monaco 内部的编辑器注册表 —— 模块被
 * 拆成多份时它读不到另一份的实例。这里读的是自己的 `active`，不依赖 Monaco 的
 * 全局状态。
 */
export function activeCodeEditor(): CodeEditorHandle | null {
  return active
}
