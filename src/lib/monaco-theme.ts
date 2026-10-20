import type { Theme } from "@/types/workspace"
import type { Monaco } from "./monaco"
import { readThemeColor } from "./theme-color"

/**
 * Monaco 的两套配色：把界面的 token 投给编辑器。
 *
 * Monaco 不读 CSS 变量 —— 它的主题是一份 JS 对象（`{ base, inherit, rules, colors }`），
 * 颜色得在切换时以 `#rrggbb[aa]` 的形式喂进去。不做这件事的后果很具体：深色界面里
 * 拉开源码抽屉会得到一块纯白的 Monaco（`theme: "vs"` 是它的浅色默认值）。
 *
 * 三条边界：
 *
 * 1. **纸面上的颜色从 token 读，不在这里另抄一份调色板。** 改 `--background` 的人不该
 *    还要记得来改这个文件；抄一份迟早说谎。
 * 2. **语法高亮不自己配色。** `inherit: true` 让未列出的颜色和 token 规则沿用 base
 *    （`vs` / `vs-dark`）：那是 VS Code 的既定配色，HTML / CSS 的高亮本来就该长成那样，
 *    本应用没有理由另造一套。
 * 3. **两套主题定义一次就够。** 换外观走 `setTheme(name)`，编辑器实例不重建（重建会丢
 *    撤销栈、丢滚动位置，还得重新挂 worker），所以这里按名字缓存「已定义」。
 */

/** 主题名只在 `applyMonacoTheme` 内部出现；`create` 时也要用，故导出。 */
export function monacoThemeName(theme: Theme): string {
  return theme === "dark" ? "webnote-dark" : "webnote-light"
}

/**
 * 界面 token → Monaco 的颜色 id。表里没列的一律沿用 base。
 *
 * 命名对照的是 VS Code 主题里的那套 id（`editor.background` 之类），值取本应用的
 * token —— 于是「抽屉、块、卡片」在同一个外观下是同一块纸面，边界不会突然出现一条
 * 属于别人的灰。
 */
function chromeColors(theme: Theme): Record<string, string> {
  const colors: Record<string, string> = {}
  const put = (id: string, variable: string, alpha?: number) => {
    const value = readThemeColor(theme, variable, alpha)
    if (value !== null) colors[id] = value
  }

  // 纸面与正文。抽屉本身就是 `bg-background`，编辑器跟着同一支底色才没有接缝。
  put("editor.background", "--background")
  put("editor.foreground", "--foreground")
  put("editorGutter.background", "--background")

  // 行号：常驻但不抢戏，当前行才提到正文色。
  put("editorLineNumber.foreground", "--muted-foreground")
  put("editorLineNumber.activeForeground", "--foreground")

  // 光标用品牌色 —— 与焦点环、主按钮同一支蓝，界面里「当前焦点」只有一个颜色。
  put("editorCursor.foreground", "--color-brand")

  // 当前行、选区、同词高亮。选区与正文编辑器共用同一套选中色，
  // 在抽屉里选一段和块里选一段看起来是同一件事。
  put("editor.lineHighlightBackground", "--muted")
  put("editor.lineHighlightBorder", "--muted", 0)
  put("editor.selectionBackground", "--color-selection-strong")
  put("editor.inactiveSelectionBackground", "--color-selection")
  put("editor.selectionHighlightBackground", "--color-selection")
  put("editor.wordHighlightBackground", "--color-selection")

  // 缩进参考线 / 空白字符 / 右边界线：与块编辑器的分隔线同一支灰。
  put("editorIndentGuide.background1", "--color-line")
  put("editorIndentGuide.activeBackground1", "--muted-strong")
  put("editorWhitespace.foreground", "--color-line")
  put("editorRuler.foreground", "--color-line")

  // 浮层：查找框、补全列表、悬停文档 —— 都是 `popover` 面，与下拉、气泡同一档。
  for (const id of ["editorWidget", "editorSuggestWidget", "editorHoverWidget"]) {
    put(`${id}.background`, "--popover")
    put(`${id}.border`, "--border")
    put(`${id}.foreground`, "--popover-foreground")
  }
  put("editorSuggestWidget.selectedBackground", "--color-selection")
  put("editorSuggestWidget.highlightForeground", "--color-brand")
  put("input.background", "--muted")
  put("input.foreground", "--foreground")
  put("input.border", "--border")
  put("focusBorder", "--color-brand")

  // 滚动条：压淡到「用得到才看见」，与表格那条细滚动条同一个思路。
  put("scrollbarSlider.background", "--color-muted-strong", 0.55)
  put("scrollbarSlider.hoverBackground", "--color-muted-strong", 0.75)
  put("scrollbarSlider.activeBackground", "--muted-strong", 0.9)
  // base 主题在概览尺左缘画一条竖线，这抽屉窄，那条线看着像边框残留。
  colors["editorOverviewRuler.border"] = "#00000000"

  return colors
}

/** 已定义过的主题名。同一个名字重复 define 会白白重建一遍颜色表。 */
const defined = new Set<string>()

/**
 * 让 Monaco 换成 `theme` 对应的配色。`monaco.editor.setTheme` 是全局的，
 * 已存在的编辑器实例会就地重绘 —— 不必重建，撤销栈与滚动位置都留着。
 */
export function applyMonacoTheme(monaco: Monaco, theme: Theme): void {
  const name = monacoThemeName(theme)
  if (!defined.has(name)) {
    monaco.editor.defineTheme(name, {
      base: theme === "dark" ? "vs-dark" : "vs",
      inherit: true,
      rules: [],
      colors: chromeColors(theme),
    })
    defined.add(name)
  }
  monaco.editor.setTheme(name)
}
