import hljs from "highlight.js/lib/common"
import "highlight.js/styles/github.css"

/**
 * 代码块高亮 —— 纯显示层的事，不进 runs 模型。
 *
 * 正文始终是纯文本；高亮只是把同一段文字按语言着色后交给调用方，
 * 画在与正文完全重合的另一层上（见 BlockItem 的双层结构）。
 * 语言未注册（lang 为空或拼写不对）时退化为转义后的纯文本，颜色与正文一致。
 */
export function highlightCode(text: string, lang: string): string {
  if (lang !== "" && hljs.getLanguage(lang) !== undefined) {
    return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value
  }
  return text.replace(/[&<>]/g, (ch) => (ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : "&gt;"))
}
