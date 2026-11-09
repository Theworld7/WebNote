import type { DataColumnType, DataTable } from "@/types/data-table"
import { gcm } from "@noble/ciphers/aes.js"
import { pbkdf2 } from "@noble/hashes/pbkdf2.js"
import { sha256 } from "@noble/hashes/sha2.js"
import { DATA_TABLE_VERSION } from "@/types/data-table"
import { emptyColumn, emptyRow, tableFromJson, tableToJson } from "@/lib/data-table"

/**
 * 密码本表的落盘形态：**加密信封**。
 *
 * 一张密码本就是一张数据表（ADR-0052）—— 列、���、单元格值全是普通数据表的那一套，
 * 唯一的不同是**盘上那份不是明文 JSON**，而是一个信封：盐、IV、密文。
 *
 * 信封里的 `data` 解开之后就是**普通数据表的那份 JSON**（`tableToJson` 的产物）。
 * 这样「加密的是哪一层」是清楚的：数据表的结构、类型、选项全在密文里，一样不漏。
 *
 * 为什么不用浏览器的 `crypto.subtle`：它要求 secure context，而 Tauri 的
 * `tauri://localhost` 在 WebKit（macOS / Linux）上**不被认作 secure context**，
 * `crypto.subtle` 在发布版里是 `undefined`。纯 JS 实现（`@noble/*`）在
 * WKWebView / WebKitGTK / EdgeWebView2 / 普通浏览器里行为一致，一份实现通吃。
 * 代价是 PBKDF2 跑在主线程上 —— 所以迭代次数取的是「够慢、但不卡住界面」的那一档。
 */

/** 信封格式版本。信封里明写一份，加密时也绑进 AAD —— 换版本就解不开，这是有意的。 */
const VAULT_FORMAT_VERSION = 1

/**
 * PBKDF2 迭代次数。
 *
 * OWASP 对口令存储的建议是 60 万次，那是在服务端、且愿意等的地方。这里是本地文件、
 * 一次解锁几十毫秒到几百毫秒的量级，取 21 万次：拿到 `.tbl` 的人要暴力猜口令，
 * 每一次尝试都要付这个成本；而用户按一次解锁不该等上几秒。
 */
const VAULT_KDF_ITERATIONS = 210_000

const SALT_BYTES = 16
const IV_BYTES = 12
const KEY_BYTES = 32

/** 附加认证数据：把格式版本绑进密文。 */
const AAD = new TextEncoder().encode("webnote-vault/1")

/** 信封的形状。字段名写进盘上文件，所以它们是**格式的一部分**，不是随便起的。 */
export interface VaultEnvelope {
  /** 格式标记兼版本号。认一个文件是不是密码本，看它有没有这个键。 */
  "webnote-vault": number
  kdf: {
    name: "PBKDF2"
    hash: "SHA-256"
    iterations: number
    /** base64。 */
    salt: string
  }
  cipher: {
    name: "AES-GCM"
    /** base64。 */
    iv: string
  }
  /** base64 的密文（不含 GCM 标签，noble 把它接在密文尾部）。 */
  data: string
}

/** 字节数组 → base64。 */
function toBase64(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** base64 → 字节数组。解码失败抛错 —— 那意味着文件坏了，不是「没锁」。 */
function fromBase64(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** 随机字节。`crypto.getRandomValues` 不受 secure context 限制，各环境都有。 */
function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

// ---- 口令的规矩（ADR-0053）----

/** 口令最短长度。 */
export const PASSPHRASE_MIN_LENGTH = 8

/**
 * 生成口令时的四组字符。
 *
 * 排除 `I` `O` `l` `0` `1` —— 这五个在等宽字体里互相认不出来，而口令是要人抄写的
 * （抄在纸上、抄进另一台设备）。剩下的 90 来个字符仍然远超暴力猜测的范围。
 */
const PASSPHRASE_UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"
const PASSPHRASE_LOWER = "abcdefghijkmnopqrstuvwxyz"
const PASSPHRASE_DIGITS = "23456789"
const PASSPHRASE_SYMBOLS = "!@#$%^&*-_=+?"
const PASSPHRASE_ALPHABET = PASSPHRASE_UPPER + PASSPHRASE_LOWER + PASSPHRASE_DIGITS + PASSPHRASE_SYMBOLS

/** 一键生成的口令长度。 */
export const GENERATED_PASSPHRASE_LENGTH = 16

/**
 * 一句口令合不合规矩。空串 = 合规，否则是一句人话，**说清缺什么**。
 *
 * 规矩是四类各至少一个：大写、小写、数字、符号（取 `[^A-Za-z0-9]`，任何符号都算）。
 * 一行正则校验一类，不给「必须包含特殊字符一栏」那种说法 —— 用户不知道该填哪个。
 */
export function passphraseProblem(passphrase: string): string {
  if (passphrase.length < PASSPHRASE_MIN_LENGTH) return `口令至少要 ${PASSPHRASE_MIN_LENGTH} 位`
  const missing: string[] = []
  if (!/[A-Z]/.test(passphrase)) missing.push("大写字母")
  if (!/[a-z]/.test(passphrase)) missing.push("小写字母")
  if (!/[0-9]/.test(passphrase)) missing.push("数字")
  if (!/[^A-Za-z0-9]/.test(passphrase)) missing.push("符号")
  return missing.length === 0 ? "" : `口令还缺${missing.join("、")}`
}

/** 无偏地取一个 `[0, size)` 的随机整数。拒绝采样 —— 直接取模会让靠前的字符多出一点概率。 */
function randomIndex(size: number): number {
  const limit = Math.floor(0x1_0000_0000 / size) * size
  const buffer = new Uint32Array(1)
  for (;;) {
    crypto.getRandomValues(buffer)
    if (buffer[0] < limit) return buffer[0] % size
  }
}

/**
 * 生成一个合规矩的口令。
 *
 * 四组各先放一个（保证四类齐全），剩下的从全集取，最后洗一遍牌 —— 不洗的话
 * 前四位永远是「大写、小写、数字、符号」，看一眼就知道第几位是什么类别。
 */
export function generatePassphrase(length = GENERATED_PASSPHRASE_LENGTH): string {
  const chars = [
    PASSPHRASE_UPPER[randomIndex(PASSPHRASE_UPPER.length)],
    PASSPHRASE_LOWER[randomIndex(PASSPHRASE_LOWER.length)],
    PASSPHRASE_DIGITS[randomIndex(PASSPHRASE_DIGITS.length)],
    PASSPHRASE_SYMBOLS[randomIndex(PASSPHRASE_SYMBOLS.length)],
  ]
  while (chars.length < length) chars.push(PASSPHRASE_ALPHABET[randomIndex(PASSPHRASE_ALPHABET.length)])
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomIndex(i + 1)
    const swap = chars[i]
    chars[i] = chars[j]
    chars[j] = swap
  }
  return chars.join("")
}

/**
 * 口令 → 密钥。
 *
 * salt 从信封里取 —— 每个密码本一份，各算各的：两个文件用同一个口令时，
 * 攻击者也不能拿一个文件的盐去加速另一个。
 */
function deriveVaultKey(passphrase: string, salt: Uint8Array, iterations: number): Uint8Array {
  return pbkdf2(sha256, new TextEncoder().encode(passphrase), salt, { c: iterations, dkLen: KEY_BYTES })
}

/**
 * 密码本默认的五列。
 *
 * 顺序就是用户给的那一串：账号、密码、图标、网站、名称。列的顺序**是数据的一部分**
 * （GLOSSARY 里「Data column」那条），所以这里定一次，别处不再各排一次。
 *
 * 只有「密码」是特殊的 —— 视图对它掩码显示。其余四列与普通数据表的列无差别，
 * 用户照样可以改名、删列、加列。密码列被删了，自动认列会落到「没有密码列」，
 * 而不是把别的列当成密码显示。
 */
const VAULT_DEFAULT_COLUMNS: readonly { name: string; type: DataColumnType }[] = [
  { name: "账号", type: "text" },
  { name: "密码", type: "text" },
  { name: "图标", type: "image" },
  { name: "网站", type: "text" },
  { name: "名称", type: "text" },
]

/** 密码列的列名 —— 自动认列时找的就是它。 */
const VAULT_PASSWORD_COLUMN_NAME = "密码"

/**
 * 新建一张密码本表时的起手。
 *
 * 两项一起产出：预置列的 id 由 `table` 生成，而块上要指的就是密码列的 id ——
 * 两者必须来自同一次生成，否则块会指着一个不存在的列 id。
 */
export interface VaultPreset {
  /** 新建时写进 `.tbl` 的初始内容。 */
  table: DataTable
  /** 密码列的列 id —— 块上指好它。 */
  passwordColumn: string
}

export function createVaultPreset(): VaultPreset {
  const columns = VAULT_DEFAULT_COLUMNS.map((column) => emptyColumn(column.name, column.type))
  const password = columns.find((column) => column.name === VAULT_PASSWORD_COLUMN_NAME)
  return {
    table: { version: DATA_TABLE_VERSION, columns, rows: [emptyRow(columns)] },
    passwordColumn: password?.id ?? "",
  }
}

/**
 * 密码本块关心的五个列。
 *
 * 块上只记着「哪一列是密码」（`passwordColumn`），其余四个靠**列名**认 ——
 * 名字对不上就退到**列类型**（图标列是唯一的 image 列），再对不上就没有那个角色。
 *
 * 认不出就是认不出：视图宁可少显示一栏，也不把某一列**当成**密码显示 ——
 * 那等于把一个普通字段以「密码」的名义渲染出去，比少一栏糟得多。
 */
export interface VaultRoles {
  /** 名称列（列 id）。 */
  name: string
  /** 账号列（列 id）。 */
  account: string
  /** 密码列（列 id）。空串 = 没有密码列。 */
  password: string
  /** 图标列（列 id）。 */
  icon: string
  /** 网站列（列 id）。 */
  site: string
}

/** 按列名找一列。找不到返回空串。 */
function columnNamed(table: DataTable, name: string): string {
  return table.columns.find((column) => column.name === name)?.id ?? ""
}

/**
 * 认出一个密码本的列角色。
 *
 * `passwordColumn` 是块上记着的那个 —— 它优先，因为用户可能把「密码」那一列改了名，
 * 块上的列 id 仍然指得对。列 id 不在了（表被换过）才退回按名字认。
 */
export function resolveVaultRoles(table: DataTable, passwordColumn: string): VaultRoles {
  const password =
    passwordColumn !== "" && table.columns.some((column) => column.id === passwordColumn)
      ? passwordColumn
      : columnNamed(table, VAULT_PASSWORD_COLUMN_NAME)

  const icon = columnNamed(table, "图标") || table.columns.find((column) => column.type === "image")?.id || ""

  const taken = new Set([password, icon])
  const name = columnNamed(table, "名称") || table.columns.find((column) => column.type === "text" && !taken.has(column.id))?.id || ""
  taken.add(name)

  const account = columnNamed(table, "账号") || table.columns.find((column) => column.type === "text" && !taken.has(column.id))?.id || ""
  taken.add(account)

  const site = columnNamed(table, "网站") || table.columns.find((column) => column.type === "text" && !taken.has(column.id))?.id || ""

  return { name, account, password, icon, site }
}

/**
 * 这段文本是不是密码本信封？
 *
 * 认的是「有没有那个标记键」，不是「能不能解开」—— 后者要口令。
 * 数据表注册表读到一个 `.tbl` 时先问这一句：不是就走普通数据表那条路。
 */
export function isVaultEnvelope(text: string): boolean {
  return readVaultEnvelope(text) !== null
}

/**
 * 是不是一个「键值对对象」。`JSON.parse` 出来的是 `unknown` —— 收窄到它靠这个守卫，
 * 不靠类型断言（AGENTS.md：零断言，用类型守卫表达）。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** 取一个字符串字段。类型不对就当没有 —— 宽容读取，见下面的注释。 */
function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === "string" ? value : ""
}

/** 取一个数字字段。类型不对就当没有。 */
function readNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  return typeof value === "number" ? value : 0
}

/**
 * 解析信封。返回 `null` = 不是信封（普通数据表）或已经坏了。
 *
 * 宽容读取：字段在但类型不对、base64 解不开，都当「不是信封」而不是抛错 ——
 * 这一步只用来**分流**，真正的解密在 `decryptVault` 里，那儿才该报错。
 */
export function readVaultEnvelope(text: string): VaultEnvelope | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  if (parsed["webnote-vault"] !== VAULT_FORMAT_VERSION) return null
  const kdf = parsed.kdf
  const cipher = parsed.cipher
  if (!isRecord(kdf) || !isRecord(cipher)) return null

  const salt = readString(kdf, "salt")
  const iterations = readNumber(kdf, "iterations")
  const iv = readString(cipher, "iv")
  const data = readString(parsed, "data")
  // 少一样都不成信封 —— 宽容读到最后仍认得出来的东西才算数。
  if (salt === "" || iv === "" || data === "") return null
  if (iterations <= 0) return null

  return {
    "webnote-vault": VAULT_FORMAT_VERSION,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations, salt },
    cipher: { name: "AES-GCM", iv },
    data,
  }
}

/** 一把解出来的密钥，和它的盐 —— 两者一起才能重新加密。 */
export interface VaultKey {
  /** 派生出来的 AES-GCM 密钥。 */
  key: Uint8Array
  /** 派生时用的盐。写盘时要用它重算信封里的 kdf 段。 */
  salt: Uint8Array
}

/**
 * 新建一个密码本：生成盐、派生密钥、加密一次。
 *
 * 盐与密钥一起返回 —— 盐要**留着**：以后每次写盘都用同一把密钥重新加密，
 * 而密钥是从盐派生的。盐换了，密钥就得重新派生，那需要口令 —— 而我们不存口令。
 * 所以盐跟着这张密码本一生不变，每次变的只是 IV（GCM 的 IV 必须每条消息唯一）。
 */
export function createVault(table: DataTable, passphrase: string): { envelope: VaultEnvelope; key: VaultKey } {
  const salt = randomBytes(SALT_BYTES)
  const key = deriveVaultKey(passphrase, salt, VAULT_KDF_ITERATIONS)
  const envelope = sealWith(table, key, salt)
  return { envelope, key: { key, salt } }
}

/**
 * 用已有的密钥重新加密一张表。
 *
 * 盐不变、IV 换新的 —— 这是 GCM 的规矩：同一把密钥下 IV 绝不能重复。
 * 换 IV 意味着每次写盘密文都不同，但解出来是同一张表。
 */
export function resealVault(table: DataTable, key: VaultKey): VaultEnvelope {
  return sealWith(table, key.key, key.salt)
}

/** 真正的加密动作：给定密钥与盐，产出一个信封。 */
function sealWith(table: DataTable, key: Uint8Array, salt: Uint8Array): VaultEnvelope {
  const iv = randomBytes(IV_BYTES)
  const plaintext = new TextEncoder().encode(tableToJson(table))
  const ciphertext = gcm(key, iv, AAD).encrypt(plaintext)
  return {
    "webnote-vault": VAULT_FORMAT_VERSION,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: VAULT_KDF_ITERATIONS, salt: toBase64(salt) },
    cipher: { name: "AES-GCM", iv: toBase64(iv) },
    data: toBase64(ciphertext),
  }
}

/** 信封 → 落盘文本。 */
export function vaultText(envelope: VaultEnvelope): string {
  return JSON.stringify(envelope, null, 2)
}

/**
 * 用**已经派生好的密钥**解密。注册表拿着解锁后的密钥落盘时走这条 ——
 * 不该为了写一次盘再让用户输一遍口令，也就不该重新派生一遍密钥。
 */
export function decryptVaultWithKey(envelope: VaultEnvelope, key: Uint8Array): DataTable {
  const iv = fromBase64(envelope.cipher.iv)
  const ciphertext = fromBase64(envelope.data)
  const plaintext = gcm(key, iv, AAD).decrypt(ciphertext)
  return tableFromJson(new TextDecoder().decode(plaintext))
}

/**
 * 按信封里的参数派生密钥。
 *
 * 盐与迭代次数**取自信封**而不是本地常量 —— 文件上写的是什么就用什么，
 * 将来调高迭代次数时，老文件仍按老参数解开。
 */
export function deriveKeyForEnvelope(passphrase: string, envelope: VaultEnvelope): VaultKey {
  const salt = fromBase64(envelope.kdf.salt)
  return { key: deriveVaultKey(passphrase, salt, envelope.kdf.iterations), salt }
}

/**
 * 用口令解密。口令错、文件坏、版本对不上 —— 都抛错，由调用方转成一句人话。
 *
 * GCM 的认证标签过了才会解出明文，所以「口令错」与「密文被改过」在这里是同一个
 * 结果：**解不开**。这也是为什么不单独区分这两种失败 —— 告诉攻击者「文件被改过
 * 但口令是对的」没有意义。
 */
export function decryptVault(text: string, passphrase: string): DataTable {
  const envelope = readVaultEnvelope(text)
  if (envelope === null) throw new Error("这不是一个密码本文件")
  const derived = deriveKeyForEnvelope(passphrase, envelope)
  return decryptVaultWithKey(envelope, derived.key)
}
