import type { DataColumn, DataRow, DataTable } from "@/types/data-table"
import type { PlaylistBlock, PlaylistSource } from "@/types/workspace"
import { DATA_TABLE_VERSION } from "@/types/data-table"
import { cellValue, emptyColumn, emptyRow, valueText } from "@/lib/data-table"

/**
 * 歌单块的语义层。
 *
 * 一块歌单要回答的问题不是「表里有什么列」,而是「这一行的歌名、副标题、封面、时长
 * 分别是哪一格」。这层把**列映射**(显式指定优先,留空按列名与类型识别)和**取值**
 * 收在一处,视图与导出快照共用,避免两边各写一套。
 *
 * 映射按**每一张表**各存一份(见 `PlaylistSource`):一个块可以绑多张表,两张表的列
 * 结构本来就可能不同,共用一套切过去必错位。所以这里的入口收 `PlaylistSource` 而
 * 不是整个块 —— 「哪张表是当前这张」是块的事,不是列语义的事。
 *
 * 与订阅块不同的是没有「派生值」:歌单不随今天变化,列表长度与总时长都是从行里
 * 现算的纯投影,不需要另立一层。
 */
export const PLAYLIST_ROLES = ["title", "subtitle", "cover", "duration"] as const

export type PlaylistRole = (typeof PLAYLIST_ROLES)[number]

export type PlaylistRoles = Record<PlaylistRole, DataColumn | null>

/** 表上存列 id 的字段名。字段映射、序列化、解析共用这一份,避免三处手抄。 */
export type PlaylistRoleField = "titleColumnId" | "subtitleColumnId" | "coverColumnId" | "durationColumnId"

export const PLAYLIST_ROLE_FIELDS: Record<PlaylistRole, PlaylistRoleField> = {
  title: "titleColumnId",
  subtitle: "subtitleColumnId",
  cover: "coverColumnId",
  duration: "durationColumnId",
}

/** 导出快照上的 `data-*` 属性名(只带一个歌单时用;多歌单走 `data-sources`)。 */
export const PLAYLIST_ROLE_ATTRS: Record<PlaylistRole, string> = {
  title: "data-title",
  subtitle: "data-subtitle",
  cover: "data-cover",
  duration: "data-duration",
}

/** 设置菜单里的角色名。顺序与曲目行的阅读顺序一致。 */
export const PLAYLIST_ROLE_LABELS: Record<PlaylistRole, string> = {
  title: "歌名列",
  subtitle: "副标题列",
  cover: "封面列",
  duration: "时长列",
}

/**
 * 自动识别时优先认的列名。
 *
 * 时长**只认名字**:它是文本列里最常见的一种,一旦参与「第二列文本」兜底,歌手列
 * 就会被当成时长印在行尾 —— 那比不显示更糟。与订阅块的「试用期到期只认名字」同一立场。
 */
const PREFERRED_NAMES: Record<PlaylistRole, readonly string[]> = {
  title: ["歌名", "歌曲", "曲名", "标题", "名称", "音乐", "track", "title", "song", "name"],
  subtitle: ["歌手", "艺人", "艺术家", "演唱", "作者", "专辑", "artist", "singer", "album"],
  cover: ["封面", "封面图", "海报", "专辑封面", "图片", "cover", "poster", "artwork", "image", "img"],
  duration: ["时长", "长度", "时间", "duration", "length", "time"],
}

function normalized(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * 一个值是不是「一张图的地址」。
 *
 * 三种都算:data URI(本地选的图)、http(s) 地址(在线封面 —— 歌单表里多半是这种)、
 * 以图片后缀结尾的相对路径。判据只看**长得像不像**,不在这里发请求验证 —— 加载失败
 * 的图由视图退化成占位图标,那是渲染层的事。
 */
export function looksLikeImageSource(value: string): boolean {
  const text = value.trim()
  if (text === "") return false
  if (/^data:image\//i.test(text)) return true
  if (/^https?:\/\//i.test(text)) return true
  return /\.(png|jpe?g|gif|webp|avif|svg|bmp)([?#].*)?$/i.test(text)
}

/**
 * 这一列能不能当这个角色用。
 *
 * 封面是唯一接受文本列的角色:数据表里图片列只能存本地选的图(data URI),在线封面
 * 必然落在文本列里 —— 只认 `image` 列的话,填了在线地址的表一块封面都渲染不出来。
 * 文本列能不能真的当封面,还要看值像不像图片地址(见 `playlistCover`)。
 */
function acceptsType(role: PlaylistRole, column: DataColumn): boolean {
  if (role === "cover") return column.type === "image" || column.type === "text"
  // 歌名、副标题、时长都落在文本上:时长常写成「3:45」,不是数字列。
  return column.type === "text"
}

function claim(
  columns: readonly DataColumn[],
  used: Set<string>,
  predicate: (column: DataColumn) => boolean,
): DataColumn | null {
  const column = columns.find((item) => !used.has(item.id) && predicate(item)) ?? null
  if (column !== null) used.add(column.id)
  return column
}

/** 取这一列里第一段「像图片地址」的原始文本。封面兜底用 —— 它要看的不是列名而是值。 */
function coverSample(column: DataColumn, rows: readonly DataRow[]): string {
  for (const row of rows) {
    const value = cellValue(row, column)
    if (typeof value === "string" && looksLikeImageSource(value)) return value
  }
  return ""
}

/**
 * 解析出四个语义列。显式设置优先;空串或指向已删列时退回自动识别。
 *
 * 自动识别分三遍,顺序即优先级:先认名字 + 类型,再按类型兜底,封面最后还有一遍
 * 「看值」的兜底。歌名兜底取第一个文本列,副标题兜底取**下一个**没被占用的文本列 ——
 * 参考表的「歌名 / 歌手」两列因此不用配置就能各就各位。
 *
 * `rows` 只给封面的第三遍兜底用:列名既不叫「封面」、类型也不是图片列时,扫一下值
 * 里有没有图片地址。不传就跳过那一遍(导出快照传的是整表行,拿得到)。
 */
export function playlistRoles(
  columns: readonly DataColumn[],
  source: PlaylistSource,
  rows: readonly DataRow[] = [],
): PlaylistRoles {
  const roles: PlaylistRoles = { title: null, subtitle: null, cover: null, duration: null }
  const used = new Set<string>()

  for (const role of PLAYLIST_ROLES) {
    const id = source[PLAYLIST_ROLE_FIELDS[role]]
    if (id === "") continue
    const column = columns.find((item) => item.id === id) ?? null
    roles[role] = column
    if (column !== null) used.add(column.id)
  }

  for (const role of PLAYLIST_ROLES) {
    if (roles[role] !== null) continue
    const names = PREFERRED_NAMES[role]
    roles[role] = claim(
      columns,
      used,
      (column) => acceptsType(role, column) && names.some((name) => normalized(column.name) === name),
    )
  }

  if (roles.title === null) {
    roles.title =
      claim(columns, used, (column) => column.type === "text") ??
      claim(columns, used, (column) => column.type !== "image" && column.type !== "checkbox")
  }
  if (roles.subtitle === null) roles.subtitle = claim(columns, used, (column) => column.type === "text")
  if (roles.cover === null) {
    roles.cover =
      claim(columns, used, (column) => column.type === "image") ??
      claim(columns, used, (column) => column.type === "text" && coverSample(column, rows) !== "")
  }
  // 时长不做类型兜底:没叫「时长」的文本列是歌手 / 专辑的概率远大于它是时长,
  // 拿它顶上就是在行尾印一行不相干的字。

  return roles
}

// ---- 多表绑定 ----

/** 造一条「表 + 它那套映射」的绑定项。缺省全空 = 全部交给自动识别。 */
export function createPlaylistSource(
  path = "",
  roles: Partial<Record<PlaylistRole, string>> = {},
): PlaylistSource {
  return {
    path,
    titleColumnId: roles.title ?? "",
    subtitleColumnId: roles.subtitle ?? "",
    coverColumnId: roles.cover ?? "",
    durationColumnId: roles.duration ?? "",
  }
}

/**
 * 当前激活的那一项绑定。
 *
 * `block.path` 理应是 `sources` 里某项的路径,但盘上的数据可能被手改过、解析失败的
 * 旧文件也可能对不上 —— 那条不变式在这里**兜底成「列表第一项」**,而不是让视图
 * 停在一个空指针上。视图、序列化、取数都从这里读,因此三处看到的永远是同一项。
 */
export function playlistActiveSource(block: PlaylistBlock): PlaylistSource | null {
  return block.sources.find((source) => source.path === block.path) ?? block.sources[0] ?? null
}

/** 当前激活的表路径。没有绑定项时为空串(视图走「尚未指定」提示态)。 */
export function playlistActivePath(block: PlaylistBlock): string {
  return playlistActiveSource(block)?.path ?? ""
}

/**
 * 多歌单的落盘形态:一组绑定项编码成 `data-sources` 的 JSON。
 *
 * 为什么是 JSON 而不是逗号分隔:路径里有 `/`,列 id 是任意串,而一个绑定的列数
 * 是固定的四 —— 用分隔符拼就得再造一套转义规则。JSON 自带转义,`escapeHtml` 再把
 * 双引号转成 `&quot;`,浏览器与解析器都读得回。
 *
 * 键名取短名(`title` 而非 `titleColumnId`):这条属性会出现在每一份导出文件的源码里,
 * 短名读起来更接近「这张表用哪列当歌名」,而长名只是代码里的字段名。
 *
 * **只有一个歌单时不写**:那种情况四个 `data-title` 之类的老属性已经足够,文件里
 * 不必多一行机器味;`data-sources` 只为「这个块有好几份歌单」而存在。
 */
export function encodePlaylistSources(sources: readonly PlaylistSource[]): string {
  if (sources.length < 2) return ""
  return JSON.stringify(
    sources.map((source) => ({
      path: source.path,
      title: source.titleColumnId,
      subtitle: source.subtitleColumnId,
      cover: source.coverColumnId,
      duration: source.durationColumnId,
    })),
  )
}

/**
 * `data-sources` → 绑定项。宽容读取:不是 JSON、不是数组、项不是对象的一律跳过;
 * 缺字段按空串(交给自动识别)。读不出任何一项时返回空数组,调用方退回到
 * 四个 `data-title` 那套单表属性。
 */
export function decodePlaylistSources(raw: string | null): PlaylistSource[] {
  if (raw === null || raw.trim() === "") return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const sources: PlaylistSource[] = []
  for (const item of parsed) {
    if (item === null || typeof item !== "object") continue
    const record = item as Record<string, unknown>
    const pick = (key: string): string => (typeof record[key] === "string" ? (record[key] as string) : "")
    const path = pick("path")
    const source = createPlaylistSource(path, {
      title: pick("title"),
      subtitle: pick("subtitle"),
      cover: pick("cover"),
      duration: pick("duration"),
    })
    // 一条既没有路径、也没有任何映射的空绑定没有信息量,跳过。
    if (path === "" && PLAYLIST_ROLES.every((role) => source[PLAYLIST_ROLE_FIELDS[role]] === "")) continue
    sources.push(source)
  }
  return sources
}

// ---- 取值 ----

export function playlistText(row: DataRow, column: DataColumn | null): string {
  if (column === null) return ""
  return valueText(cellValue(row, column), column).trim()
}

export function playlistTitle(row: DataRow, roles: PlaylistRoles): string {
  const title = playlistText(row, roles.title)
  return title === "" ? "未命名曲目" : title
}

/**
 * 封面地址。图片列的值(data URI 或在线地址)原样用;文本列只认「像图片地址」的值 ——
 * 一格写着「周杰伦」的文本不该被塞进 `<img src>` 变成一张裂图。
 */
export function playlistCover(row: DataRow, roles: PlaylistRoles): string {
  const column = roles.cover
  if (column === null) return ""
  const value = cellValue(row, column)
  if (typeof value !== "string") return ""
  const text = value.trim()
  if (column.type === "image") return text
  return looksLikeImageSource(text) ? text : ""
}

/**
 * 时长显示。表里存什么就显示什么,只补一条「纯秒数转 m:ss」——
 * 用户填 `225` 时不该在行尾看到 `225`。
 */
export function playlistDuration(row: DataRow, roles: PlaylistRoles): string {
  const raw = playlistText(row, roles.duration)
  if (raw === "") return ""
  if (!/^\d+(\.\d+)?$/.test(raw)) return raw
  const total = Math.round(Number(raw))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${seconds.toString().padStart(2, "0")}`
}

/** 时长换算成秒,给「总时长」用。已经是 `m:ss` 的按它自己算;认不出的算 0。 */
export function durationSeconds(row: DataRow, roles: PlaylistRoles): number {
  const raw = playlistText(row, roles.duration)
  if (raw === "") return 0
  const clock = /^(\d+):([0-5]?\d)$/.exec(raw)
  if (clock !== null) return Number(clock[1]) * 60 + Number(clock[2])
  if (!/^\d+(\.\d+)?$/.test(raw)) return 0
  return Math.round(Number(raw))
}

/** 总时长(m:ss)。一首时长的也没有就返回空串 —— 不显示一个假的 0:00。 */
export function totalDurationText(rows: readonly DataRow[], roles: PlaylistRoles): string {
  const total = rows.reduce((sum, row) => sum + durationSeconds(row, roles), 0)
  if (total === 0) return ""
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${seconds.toString().padStart(2, "0")}`
}

/** 整行都是空值 —— 新建预设表带的空行不该算成「1 首歌」。 */
export function playlistIsEmpty(row: DataRow, roles: PlaylistRoles): boolean {
  return (
    playlistText(row, roles.title) === "" &&
    playlistText(row, roles.subtitle) === "" &&
    playlistCover(row, roles) === "" &&
    playlistText(row, roles.duration) === ""
  )
}

// ---- 搜索 ----

/** 搜索词切词:空白分隔、全小写。多个词是**全部命中**,不是任一命中。 */
function searchTokens(query: string): string[] {
  return normalized(query)
    .split(/\s+/)
    .filter((token) => token !== "")
}

/**
 * 一行里能被搜到的文本。
 *
 * 范围是**所有文本列**,不止四个映射列 —— 歌单表里的「专辑」「备注」也是人会去搜的
 * 东西,只搜歌名会让「搜专辑搜不到」变成一个说不通的怪癖。两处刻意排除:
 * 封面列(值是图片地址,搜「com」会命中半张表)、时长列(搜 `3` 会命中每一首)。
 * 图片 / 数字 / 勾选列本来就没有文本投影,`valueText` 也不给。
 */
export function playlistSearchText(
  row: DataRow,
  roles: PlaylistRoles,
  columns: readonly DataColumn[],
): string {
  const parts = [playlistText(row, roles.title), playlistText(row, roles.subtitle)]
  for (const column of columns) {
    if (column.type !== "text") continue
    if (column.id === roles.title?.id || column.id === roles.subtitle?.id) continue
    if (column.id === roles.duration?.id || column.id === roles.cover?.id) continue
    parts.push(valueText(cellValue(row, column), column).trim())
  }
  // 全角空格与不间断空格也当分隔符:从别处粘来的歌名里常有它们。
  return parts.join(" ").replace(/[\u00a0\u3000]/g, " ").toLowerCase()
}

/** 这一行命不命中搜索词。空查询恒真 —— 「没搜」与「搜到全部」是同一种结果。 */
export function playlistMatches(
  row: DataRow,
  roles: PlaylistRoles,
  columns: readonly DataColumn[],
  query: string,
): boolean {
  const tokens = searchTokens(query)
  if (tokens.length === 0) return true
  const haystack = playlistSearchText(row, roles, columns)
  return tokens.every((token) => haystack.includes(token))
}

// ---- 纯文本导出 ----

/**
 * 导出成「导入歌单」的纯文本:一行一首,`歌名 - 歌手`。
 *
 * 这是各大听歌软件(网易云 / QQ 音乐 / Apple Music 的第三方导入工具)共同认得的
 * 最简格式 —— 空格连字符空格是它们用来切「歌名 / 歌手」的分隔。所以这里**只写这两
 * 段**:时长、专辑、封面都不进,多写一段会让对方把整行当成歌名。
 *
 * 副标题就是跟在歌名后面的那一段 —— 自动识别时它优先取「歌手」列,用户也可以自己
 * 指到别的列。两段缺一时只写有的那一段(不写一个光秃秃的「 - 」),都缺则跳过:
 * 空行是表里的留白,不是一首歌。
 */
export function playlistPlainText(rows: readonly DataRow[], roles: PlaylistRoles): string {
  const lines: string[] = []
  for (const row of rows) {
    const title = playlistText(row, roles.title)
    const subtitle = playlistText(row, roles.subtitle)
    if (title !== "" && subtitle !== "") lines.push(`${title} - ${subtitle}`)
    else if (title !== "") lines.push(title)
    else if (subtitle !== "") lines.push(subtitle)
  }
  return lines.join("\n")
}

// ---- 预设表 ----

export interface PlaylistPreset {
  table: DataTable
  roles: Partial<Record<PlaylistRole, string>>
}

/**
 * 新建歌单块时的起手表:歌名 / 歌手 / 专辑 / 时长 / 封面。
 *
 * 五列正是「一眼看得懂一首歌」最小的一组,并且刻意让**歌名列与副标题列相邻**——
 * 自动识别的兜底顺序靠的就是这个位置关系。时长用文本列,因为人写的是 `3:45`;
 * 封面用图片列(可以选本地图,也可以直接粘在线地址),而别人的表里封面是文本列时
 * 自动识别同样认得。
 */
export function createPlaylistPreset(): PlaylistPreset {
  const title = emptyColumn("歌名", "text")
  const artist = emptyColumn("歌手", "text")
  const album = emptyColumn("专辑", "text")
  const duration = emptyColumn("时长", "text")
  const cover = emptyColumn("封面", "image")
  const columns = [title, artist, album, duration, cover]

  return {
    table: { version: DATA_TABLE_VERSION, columns, rows: [emptyRow(columns)] },
    roles: {
      title: title.id,
      subtitle: artist.id,
      duration: duration.id,
      cover: cover.id,
    },
  }
}
