/**
 * 错误描述 —— 把任意抛出物压成一句能直接显示给用户的话。
 *
 * 抛出物的形状在各个来源之间并不统一：`throw new Error("…")` 最规矩，
 * 但第三方库（mermaid 的解析器尤其）会丢字符串、或 `{ str, hash }` 这种自造对象。
 * 各处复制一份「取 message」会让口径慢慢分叉 —— 一边加了对象分支、另一边没有，
 * 同一类错误在两个界面上显示成不同的话。所以只此一份。
 */
export function describeError(error: unknown): string {
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
