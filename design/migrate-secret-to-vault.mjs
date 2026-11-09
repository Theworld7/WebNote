// 一次性迁移脚本：把笔记里的旧密钥块搬进一张**加密**的密码本表。
//
// 用法：node design/migrate-api-key-vault.mjs <笔记的文件路径> <表的工作区路径> <口令>
//
// 表的**工作区路径**形如 `文档 / API Key.tbl`（分隔符是 " / "，见 lib/paths.ts）——
// 那是写进 `data-vault` 的值。表本身落在笔记旁边，文件路径由此推出。
//
// 为什么用 Vite 的 SSR 加载器跑应用自己的模块：表的 JSON 形状与信封格式
// **只有一处定义**（`lib/data-table.ts` / `lib/vault.ts`）。这里借它来生成，
// 免得脚本里抄一份形状 —— 抄的那份迟早会跟真源漂移。
//
// 不碰 DOM：解析与序列化在 `lib/html/` 里，要 DOMParser。这一步只做
// 「建表 + 加密 + 改写笔记的骨架」，改写结果由 `design/vault-migrate-check.html`
// 用应用真正的解析器复核。

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { createServer } from "vite"

const [, , noteArg, tableArg, passphrase] = process.argv
if (noteArg === undefined || tableArg === undefined || passphrase === undefined) {
  console.error("用法：node design/migrate-api-key-vault.mjs <笔记路径> <表路径> <口令>")
  process.exit(1)
}

// ---- 读旧笔记里的密钥块 ----

const notePath = noteArg
const html = readFileSync(notePath, "utf-8")

/** 旧密钥块：`<div class="note-secret" data-secret="…" data-name="…" data-note="…">`。 */
const SECRET_BLOCK = /<div class="note-secret"[^>]*>/g
const credentials = []
for (const match of html.matchAll(SECRET_BLOCK)) {
  const tag = match[0]
  const attr = (name) => {
    const found = new RegExp(`data-${name}="([^"]*)"`).exec(tag)
    return found === null ? "" : decodeEntities(found[1])
  }
  const value = attr("secret")
  if (value === "") continue
  credentials.push({ name: attr("name"), value, note: attr("note") })
}

/** HTML 实体解码 —— 属性值里可能有 `&amp;` 这类。 */
function decodeEntities(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
}

if (credentials.length === 0) {
  console.error("笔记里没有找到带值的密钥块 —— 什么都没改。")
  process.exit(1)
}

// ---- 用应用自己的模块建表并加密 ----

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  appType: "custom",
  resolve: { alias: { "@": new URL("../src", import.meta.url).pathname } },
})
const vault = await server.ssrLoadModule("/src/lib/vault.ts")
const dt = await server.ssrLoadModule("/src/lib/data-table.ts")

const preset = vault.createVaultPreset()
const columns = preset.table.columns
const byName = (name) => columns.find((column) => column.name === name)

const rows = credentials.map((credential) => {
  const row = dt.emptyRow(columns)
  const values = {
    ...row.values,
    [byName("名称").id]: credential.name,
    [byName("密码").id]: credential.value,
  }
  // 账号 / 图标 / 网站 —— 旧密钥块里没有这些信息，留空给用户填。
  // 绝不用「猜」的值填进去：一个猜错的账号比一个空格子有害得多。
  return { ...row, values }
})

const table = { ...preset.table, rows }
const { envelope } = vault.createVault(table, passphrase)
const envelopeText = vault.vaultText(envelope)

// ---- 改写笔记：整个 note-layout 换成密码本块 ----

/**
 * 找 `<div class="note-layout">` 到它**配对**的那个 `</div>`。
 *
 * 靠数标签配平，不靠正则找第一个 `</div>` —— 那会停在第一个密钥块里。
 */
function layoutRange(source) {
  const start = source.indexOf('<div class="note-layout"')
  if (start === -1) return null
  let depth = 0
  let index = start
  while (index < source.length) {
    const open = source.indexOf("<div", index)
    const close = source.indexOf("</div>", index)
    if (close === -1) return null
    if (open !== -1 && open < close) {
      depth += 1
      index = open + 4
      continue
    }
    depth -= 1
    index = close + 6
    if (depth === 0) return { start, end: index }
  }
  return null
}

const range = layoutRange(html)
if (range === null) {
  console.error("没找到 note-layout —— 什么都没改。")
  process.exit(1)
}

const vaultBlock =
  `<div class="note-vault" data-vault="${tableArg}" data-vault-column="${preset.passwordColumn}">密码本（内容未导出）</div>`
const rewritten = html.slice(0, range.start) + vaultBlock + html.slice(range.end)

// ---- 写盘 ----

// 表落在笔记旁边：工作区路径的最后一段就是文件名，目录取笔记的目录。
const tableFile = join(dirname(notePath), tableArg.split(" / ").pop() ?? tableArg)

if (existsSync(tableFile)) {
  console.error(`「${tableFile}」已经存在 —— 不覆盖。什么都没改。`)
  process.exit(1)
}
writeFileSync(tableFile, envelopeText, "utf-8")
writeFileSync(notePath, rewritten, "utf-8")

console.log(`迁移完成：${credentials.length} 条凭据 → ${tableFile}`)
for (const credential of credentials) console.log(`  · ${credential.name}`)
console.log(`笔记已改写：${notePath}`)
console.log(`密码列 id：${preset.passwordColumn}`)

await server.close()
