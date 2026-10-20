import hljs from "highlight.js/lib/common"

/**
 * 代码块高亮 —— 纯显示层的事，不进 runs 模型。
 *
 * 正文始终是纯文本；高亮只是把同一段文字按语言着色后交给调用方，
 * 画在与正文完全重合的另一层上（见 BlockItem 的双层结构）。
 * 语言未注册（lang 为空或拼写不对）时退化为转义后的纯文本，颜色与正文一致。
 *
 * 这里**不引任何 highlight.js 主题文件**：它们是两份全局 `.hljs` 规则、各只有一套配色，
 * 挂不到 `.dark` 上。配色改由 `style.css` 里的 `--color-code-*` 承担（取值同样来自
 * GitHub 的两个主题），浅色深色各一套。详见那边的注释。
 */
export function highlightCode(text: string, lang: string): string {
  if (lang !== "" && hljs.getLanguage(lang) !== undefined) {
    return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value
  }
  return text.replace(/[&<>]/g, (ch) => (ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : "&gt;"))
}
