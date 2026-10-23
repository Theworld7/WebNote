<script setup lang="ts">
import type { DataCellValue, DataRow } from "@/types/data-table"
import type { PlaylistBlock, PlaylistSource } from "@/types/workspace"
import type { PlaylistRole } from "@/lib/playlist"
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue"
import { CheckIcon, CopyIcon, DatabaseIcon, MusicIcon, PlusIcon, SearchIcon, Settings2Icon, XIcon } from "@lucide/vue"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import PlaylistAddDialog from "@/components/PlaylistAddDialog.vue"
import TableRefNotice from "@/components/TableRefNotice.vue"
import { useWorkspace } from "@/composables/useWorkspace"
import { useTableEntry } from "@/composables/useTableEntry"
import * as dt from "@/lib/data-table"
import { fileStem } from "@/lib/fs/policy"
import { fileName } from "@/lib/paths"
import {
  createPlaylistSource,
  PLAYLIST_ROLE_FIELDS,
  PLAYLIST_ROLE_LABELS,
  PLAYLIST_ROLES,
  playlistActivePath,
  playlistActiveSource,
  playlistCover,
  playlistDuration,
  playlistIsEmpty,
  playlistMatches,
  playlistPlainText,
  playlistRoles,
  playlistText,
  playlistTitle,
  totalDurationText,
} from "@/lib/playlist"

/**
 * 歌单块:一张(或几张)数据表 → 曲目列表,块上原地切换。
 *
 * 每行是一首歌:序号、封面、歌名 / 副标题、时长。四列的角色由 `lib/playlist` 的
 * 字段映射解析(显式设置优先,留空按列名与类型识别),这里只负责排版。
 *
 * **这个块就是那张表的一个视图**:添加 = 往表里加一行,删除 = 从表里删一行。
 * 不做「块的私有曲目列表」—— 同一张表被两篇笔记引用时,两处看到的就是同一份歌单。
 * 改动走 `change`,与笔记共用保存出口。
 *
 * 绑多张表时,顶部胶囊标签就是切换器,标签名取表文件名 —— 用户给自己的歌单起的名字
 * 本来就在文件名上,不另存一份「显示名」。每张表带自己那套字段映射,切过去不会错位。
 * 切换是**看哪一张**,不是改内容:它不点亮未保存标记(见 `setPlaylistActive`)。
 *
 * 时长与曲目数是**从行里现算的投影**,不进 `.tbl` 也不进块:落进存储就是第二份真源。
 */
const props = defineProps<{ block: PlaylistBlock }>()

const { openFile, setPlaylistSources, setPlaylistActive, createPlaylistTable, tablePaths } = useWorkspace()

/** 当前激活的绑定项。盘上数据被手改过时 `playlistActiveSource` 兜底成第一项。 */
const active = computed<PlaylistSource | null>(() => playlistActiveSource(props.block))

const activePath = computed(() => playlistActivePath(props.block))

const { state, table, columns, rows, change } = useTableEntry(() => activePath.value)

/** 没有绑定项时给一个空映射,让 `playlistRoles` 走纯自动识别(不至于整块空着)。 */
const EMPTY_SOURCE = createPlaylistSource()

const roles = computed(() => playlistRoles(columns.value, active.value ?? EMPTY_SOURCE, rows.value))

/** 空行不算曲目 —— 预设表自带一行空的,不该显示成「1 首 · 未命名曲目」。 */
const tracks = computed(() => rows.value.filter((row) => !playlistIsEmpty(row, roles.value)))

// ---- 搜索 ----

/**
 * 搜索是**块内的临时视图状态**,不进块、不进 `.tbl`(ADR-0005)。
 *
 * 关掉笔记再打开时搜索框是收起的:一个块的过滤条件留在磁盘上,下次看到一张缺了
 * 一半曲目的歌单,很难想起是自己两个月前搜过什么。
 */
const query = ref("")
const searchOpen = ref(false)
const searchInput = ref<HTMLInputElement | null>(null)

const filtering = computed(() => query.value.trim() !== "")

/** 可见曲目。没搜时就是全部 —— 同一条渲染路径,不给「搜索模式」另写一套。 */
const shown = computed(() =>
  filtering.value
    ? tracks.value.filter((row) => playlistMatches(row, roles.value, columns.value, query.value))
    : tracks.value,
)

/** 总时长跟着可见曲目走:搜出五首时,「总时长」若还是整张表的就是在说假话。 */
const totalText = computed(() => totalDurationText(shown.value, roles.value))

function openSearch(): void {
  searchOpen.value = true
  void nextTick(() => searchInput.value?.focus())
}

/** 收起 = 连搜索词一起清掉。留着词却看不见输入框,下一次搜索会从一个看不见的条件开始。 */
function closeSearch(): void {
  searchOpen.value = false
  query.value = ""
}

function toggleSearch(): void {
  if (searchOpen.value) closeSearch()
  else openSearch()
}

function clearQuery(): void {
  query.value = ""
  searchInput.value?.focus()
}

// 换歌单(切标签 / 解绑 / 新建)时清掉搜索:两张表的列结构不同,一个跨表的过滤条件
// 只会让切过去的那张看起来像空的。
watch(activePath, () => {
  searchOpen.value = false
  query.value = ""
})

// 表被删空时也收起搜索:空表不渲染头部,一个看不见的过滤条件会让下一首加进来就「消失」。
watch(
  () => tracks.value.length,
  (length) => {
    if (length === 0) closeSearch()
  },
)

// ---- 复制成纯文本 ----

const copied = ref(false)
let copiedTimer: number | undefined

/**
 * 复制成「歌名 - 歌手」的纯文本,用于导入听歌软件。
 *
 * 复制的是**当前可见**的曲目:搜出周杰伦的十首再点复制,拿到的就是这十首 ——
 * 否则用户还得手动删掉另外三十行。没有任何可见曲目时按钮是禁用的,不会往剪贴板
 * 里塞一个空串。
 */
async function copyPlainText(): Promise<void> {
  const text = playlistPlainText(shown.value, roles.value)
  if (text === "") return
  await navigator.clipboard.writeText(text)
  copied.value = true
  window.clearTimeout(copiedTimer)
  copiedTimer = window.setTimeout(() => (copied.value = false), 1500)
}

onBeforeUnmount(() => window.clearTimeout(copiedTimer))

/**
 * 加载失败的封面地址。
 *
 * 在线封面挂在别人的服务器上:断网、对方删图、防盗链都会让 `<img>` 变成一张裂图。
 * 与其在行首摆一个破图标,不如退成「没有封面」—— 记下失败的地址,渲染时当作空。
 * 只记地址不记行 id:同一张专辑的封面失败一次就都失败,不必逐行重试。
 */
const brokenCovers = ref<ReadonlySet<string>>(new Set())

function coverOf(row: DataRow): string {
  const src = playlistCover(row, roles.value)
  return src === "" || brokenCovers.value.has(src) ? "" : src
}

function markCoverBroken(src: string): void {
  if (src === "") return
  const next = new Set(brokenCovers.value)
  next.add(src)
  brokenCovers.value = next
}

function subtitleOf(row: DataRow): string {
  return playlistText(row, roles.value.subtitle)
}

function durationOf(row: DataRow): string {
  return playlistDuration(row, roles.value)
}

// ---- 歌单切换 / 绑定 ----

interface SourceTab {
  path: string
  /** 标签上显示的名字 —— 表文件名,不另存显示名。 */
  name: string
  id: string
}

const tabs = computed<SourceTab[]>(() =>
  props.block.sources.map((source) => ({
    path: source.path,
    name: source.path === "" ? "未指定" : fileStem(fileName(source.path)),
    id: source.path === "" ? "\u0000" : source.path,
  })),
)

const canUnbind = computed(() => props.block.sources.length > 1)

/** 当前那张歌单的名字(标签上的名字),设置菜单与提问里都要用它。 */
const activeName = computed(() => tabs.value.find((tab) => tab.path === activePath.value)?.name ?? "")

/** 菜单里列已经绑过的表没意义 —— 只列工作区里还没绑的。 */
const unboundTables = computed(() => {
  const bound = new Set(props.block.sources.map((source) => source.path))
  return tablePaths.value.filter((path) => !bound.has(path))
})

/** 切到另一张已绑定的歌单。只是换「看哪张」,不算改动 —— 所以不走 `setPlaylistSources`。 */
function switchTo(path: string): void {
  if (path === activePath.value) return
  setPlaylistActive(props.block.id, path)
}

/** 绑上一张已有的表,并立刻切过去 —— 用户点它的意思就是要看它。 */
function bind(path: string): void {
  setPlaylistSources(props.block.id, [...props.block.sources, createPlaylistSource(path)], path)
}

/** 解绑。解掉的正是当前这张时,退到剩下的第一张 —— 块不能没有「当前这张表」。 */
function unbind(path: string): void {
  if (!canUnbind.value) return
  const rest = props.block.sources.filter((source) => source.path !== path)
  const next = path === activePath.value ? (rest[0]?.path ?? "") : activePath.value
  setPlaylistSources(props.block.id, rest, next)
}

// ---- 新建歌单表 ----

const creating = ref(false)
const newName = ref("歌单")

function openCreate(): void {
  newName.value = "歌单"
  creating.value = true
}

/**
 * 新建(或复用同名的)歌单表并绑上去。
 *
 * 撞名复用是既有规则(`客户.html` 里插数据表就认准 `客户.tbl`);复用到一张**已经绑过**
 * 的表时不重复追加,直接切过去 —— 那正是用户想要的那份歌单。
 */
async function confirmCreate(): Promise<void> {
  const name = newName.value.trim()
  if (name === "") return
  creating.value = false
  const created = await createPlaylistTable(name)
  if (created === null) return
  if (props.block.sources.some((source) => source.path === created.path)) {
    switchTo(created.path)
    return
  }
  setPlaylistSources(props.block.id, [...props.block.sources, created], created.path)
}

// ---- 增删 ----

const adding = ref(false)

/**
 * 加一首:先按表的列造一行(值全空),再把表单里填的逐格写进去。
 *
 * 不用 `dt.addRow` 之后另找那一行 —— 它返回新表,新行就是最后一行;这样「表结构由
 * 表的列定义」这条口径不用第二处判断,列被改了也照样对得上。
 */
async function addTrack(values: Record<string, DataCellValue>): Promise<void> {
  adding.value = false
  await change((current) => {
    const appended = dt.addRow(current)
    const created = appended.rows[appended.rows.length - 1]
    if (created === undefined) return appended
    let filled = created
    for (const column of current.columns) {
      const value = values[column.id]
      if (value === undefined) continue
      filled = dt.setCell(filled, column.id, value)
    }
    return dt.replaceRow(appended, filled)
  })
}

/** 从歌单里去掉一首 = 从表里删掉那一行。与账目块同一个立场:块不另存一份「不显示」名单。 */
async function removeTrack(row: DataRow): Promise<void> {
  await change((current) => dt.removeRow(current, row.id))
}

// ---- 字段映射设置(按当前这张表各存一份) ----

const ROLE_ITEMS = PLAYLIST_ROLES.map((role) => ({ role, label: PLAYLIST_ROLE_LABELS[role] }))

/** 下拉里展示的值。空串 = 自动识别。 */
function roleValue(role: PlaylistRole): string {
  return active.value?.[PLAYLIST_ROLE_FIELDS[role]] ?? ""
}

function withRole(source: PlaylistSource, role: PlaylistRole, columnId: string): PlaylistSource {
  const next = { ...source }
  next[PLAYLIST_ROLE_FIELDS[role]] = columnId
  return next
}

function setRole(role: PlaylistRole, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLSelectElement)) return
  const current = active.value
  if (current === null) return
  const value = target.value
  const next = props.block.sources.map((source) =>
    source === current ? withRole(source, role, value) : source,
  )
  setPlaylistSources(props.block.id, next, activePath.value)
}

const MENU = "w-[224px] rounded-island p-1.5 shadow-pop ring-1 ring-line/70"
const BIND_MENU = "max-h-[280px] w-[240px] overflow-y-auto rounded-island p-1.5 shadow-pop ring-1 ring-line/70"
const SELECT = "w-full cursor-pointer rounded border border-line bg-transparent px-1.5 py-1 text-[12px] outline-none"

function openTable() {
  if (activePath.value === "") return
  openFile(activePath.value)
}

/** 工具条上的小胶囊按钮:与订阅 / 账目块同一套体量。 */
const TOOL = "h-6 gap-1 rounded-full bg-popover px-2 text-[12px] text-muted-foreground hover:text-foreground"

/** 标签胶囊:未选中是灰字,选中是浅底 + 深字 —— 换主题时靠 token 自动跟着走。 */
const TAB = "flex h-[26px] max-w-[11rem] items-center gap-1 rounded-full px-2.5 text-[12px] transition-colors"
const TAB_ON = "bg-foreground/8 font-medium text-foreground"
const TAB_OFF = "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"

/** 头部行的小图标按钮:与标签胶囊同高,悬停才浮出底色,平时只是一颗灰图标。 */
const ICON_BTN =
  "flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"

/** 搜索输入框:胶囊形,和标签条站在同一套体量上。 */
const SEARCH =
  "h-6 w-[9.5rem] shrink-0 rounded-full border border-line bg-transparent px-2.5 text-[12px] outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-foreground/25"
</script>

<template>
  <div class="group/pl relative my-4" data-playlist-view>
    <!-- 块操作入口:右上角,悬停浮现。没读到表时什么都操作不了,干脆不显示。 -->
    <div
      v-if="table !== null"
      class="absolute -top-2 right-0 z-20 flex items-center gap-1 opacity-0 transition-opacity group-hover/pl:opacity-100 focus-within:opacity-100"
    >
      <Button variant="ghost" size="sm" :class="TOOL" @click="adding = true">
        <PlusIcon class="size-3" />添加歌曲
      </Button>
      <Button variant="ghost" size="sm" :class="TOOL" @click="openTable">
        <DatabaseIcon class="size-3" />打开数据表
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" size="sm" :class="TOOL">
            <Settings2Icon class="size-3" />设置
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent :class="MENU" align="end">
          <DropdownMenuLabel class="px-2 pb-1 pt-1.5 text-[11px] font-normal text-muted-foreground">
            字段映射 · {{ activeName }}
          </DropdownMenuLabel>
          <div v-for="item in ROLE_ITEMS" :key="item.role" class="px-2 pb-1.5">
            <div class="mb-0.5 text-[10.5px] text-muted-foreground">{{ item.label }}</div>
            <select :class="SELECT" :value="roleValue(item.role)" @change="setRole(item.role, $event)">
              <option value="">自动识别</option>
              <option v-for="column in columns" :key="column.id" :value="column.id">{{ column.name }}</option>
            </select>
          </div>
          <DropdownMenuSeparator class="mx-2 my-1 bg-line" />
          <div class="px-2 py-1 text-[10.5px] leading-relaxed text-muted-foreground">
            每张歌单各存一份映射；留「自动识别」时按列名与列类型找，列改名或删除后也会自动退让。
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <!-- 歌单标签条:多个歌单在同一个块里切换,标签名就是表文件名。 -->
    <div class="mb-2 flex items-center gap-1">
      <div class="-mx-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1 py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div v-for="tab in tabs" :key="tab.id" class="group/tab relative flex shrink-0 items-center">
          <button
            type="button"
            :class="[TAB, tab.path === activePath ? TAB_ON : TAB_OFF, canUnbind ? 'pr-6' : '']"
            :title="tab.path"
            @click="switchTo(tab.path)"
          >
            <span class="truncate">{{ tab.name }}</span>
          </button>
          <!-- 解除绑定:只在悬停那颗标签时露出来,平时列表上不该常驻一排叉。 -->
          <button
            v-if="canUnbind"
            type="button"
            class="absolute right-1 top-1/2 flex size-4 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/10 hover:text-foreground group-hover/tab:opacity-100 focus-visible:opacity-100"
            :aria-label="`解除绑定 ${tab.name}`"
            @click.stop="unbind(tab.path)"
          >
            <XIcon class="size-3" />
          </button>
        </div>

        <!-- 再加一份歌单:绑已有的表,或新建一张预设表。 -->
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <button
              type="button"
              class="flex size-[26px] shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
              aria-label="绑定歌单"
            >
              <PlusIcon class="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent :class="BIND_MENU" align="start">
            <DropdownMenuLabel class="px-2 pb-1 pt-1.5 text-[11px] font-normal text-muted-foreground">绑定已有数据表</DropdownMenuLabel>
            <template v-if="unboundTables.length > 0">
              <DropdownMenuItem
                v-for="path in unboundTables"
                :key="path"
                class="gap-2 text-[12.5px]"
                @select="bind(path)"
              >
                <MusicIcon class="size-3.5 shrink-0 text-muted-foreground" />
                <span class="truncate">{{ fileStem(fileName(path)) }}</span>
              </DropdownMenuItem>
            </template>
            <div v-else class="px-2 py-1.5 text-[11px] text-muted-foreground">工作区里的表都已绑定</div>
            <DropdownMenuSeparator class="mx-2 my-1 bg-line" />
            <DropdownMenuItem class="gap-2 text-[12.5px]" @select="openCreate">
              <PlusIcon class="size-3.5 shrink-0 text-muted-foreground" />
              新建歌单表…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>

    <!-- 表的状态在标签条**下面**:切到一张读不到的表也要能切回去 —— 把标签条一起
         换掉会把用户困在那张表上。空指针同理:那里正是「绑定一张表」要出现的地方。 -->
    <TableRefNotice v-if="activePath === ''" kind="unset" label="歌单" />

    <TableRefNotice
      v-else-if="state === 'missing' || state === 'failed'"
      kind="missing"
      label="歌单"
      :path="activePath"
    />

    <TableRefNotice v-else-if="table === null" kind="loading" label="歌单" />

    <template v-else>
      <!-- 头部(曲目数 / 总时长 / 搜索 / 复制)只在表里有歌时出现:空表上摆一个
           「0 首」和一颗禁用的复制键,只是噪音。 -->
      <div v-if="tracks.length > 0" class="mb-1.5 flex items-center gap-3.5 px-1">
        <span class="text-[12.5px] font-medium">{{ shown.length }} 首</span>
        <span v-if="totalText !== ''" class="text-[11.5px] text-muted-foreground">总时长 {{ totalText }}</span>
        <span v-if="filtering" class="text-[11.5px] text-muted-foreground">筛选自 {{ tracks.length }} 首</span>

        <!-- 复制反馈:短暂出现,不占位很久,也不弹 toast。 -->
        <span v-if="copied" class="ml-auto shrink-0 text-[11px] text-muted-foreground">已复制</span>

        <div :class="['flex shrink-0 items-center gap-0.5', copied ? '' : 'ml-auto']">
          <!-- 搜索:平时只是一颗图标,点开才展开输入框。 -->
          <input
            v-if="searchOpen"
            ref="searchInput"
            v-model="query"
            type="text"
            placeholder="搜歌名 / 歌手 / 专辑"
            aria-label="搜索曲目"
            :class="SEARCH"
            @keydown.esc.prevent="closeSearch"
          >
          <button
            v-if="searchOpen && filtering"
            type="button"
            :class="ICON_BTN"
            aria-label="清空搜索"
            @mousedown.prevent
            @click="clearQuery"
          >
            <XIcon class="size-3.5" />
          </button>
          <button
            type="button"
            :class="[ICON_BTN, searchOpen ? 'bg-foreground/5 text-foreground' : '']"
            :aria-label="searchOpen ? '收起搜索' : '搜索曲目'"
            :title="searchOpen ? '收起搜索' : '搜索曲目'"
            @mousedown.prevent
            @click="toggleSearch"
          >
            <SearchIcon class="size-3.5" />
          </button>

          <!-- 一键复制成导进听歌软件的纯文本。 -->
          <button
            type="button"
            :class="ICON_BTN"
            :title="copied ? '已复制' : `复制 ${shown.length} 首（歌名 - 歌手）`"
            :aria-label="copied ? '已复制' : '复制为纯文本歌单'"
            :disabled="shown.length === 0"
            @mousedown.prevent
            @click="copyPlainText"
          >
            <CheckIcon v-if="copied" class="size-3.5" />
            <CopyIcon v-else class="size-3.5" />
          </button>
        </div>
      </div>

      <!-- 空表:与账目 / 订阅同一句引导。 -->
      <div
        v-if="tracks.length === 0"
        class="rounded-xl border border-dashed border-line px-4 py-8 text-center text-[12px] text-muted-foreground"
      >
        这张表还没有曲目 —— 点右上角「添加歌曲」加一首。
      </div>

      <!-- 表里有歌,但一个都不匹配:说清楚是搜索没命中,不是这张表空了。
           这段与列表是同级分支,头部(含搜索框)留在上面 —— 否则一打出无结果的词,
           输入框自己消失,用户连删一个字都做不到。 -->
      <div
        v-else-if="shown.length === 0"
        class="rounded-xl border border-dashed border-line px-4 py-7 text-center text-[12px] text-muted-foreground"
      >
        没有匹配「{{ query.trim() }}」的曲目
        <button type="button" class="ml-1 text-foreground hover:underline" @click="clearQuery">清空搜索</button>
      </div>

      <ol v-else class="m-0 p-0">
        <li
          v-for="(row, index) in shown"
          :key="row.id"
          class="group/track flex items-center gap-2.5 rounded-md px-1 py-1.5 transition-colors hover:bg-muted/40"
        >
          <span class="w-[18px] shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">{{ index + 1 }}</span>

          <span class="flex size-[34px] shrink-0 items-center justify-center overflow-hidden rounded-[6px] bg-muted/60 text-muted-foreground">
            <img
              v-if="coverOf(row)"
              :src="coverOf(row)"
              alt=""
              loading="lazy"
              decoding="async"
              referrerpolicy="no-referrer"
              class="size-full object-cover"
              @error="markCoverBroken(coverOf(row))"
            >
            <MusicIcon v-else class="size-4" />
          </span>

          <span class="flex min-w-0 flex-1 flex-col">
            <span class="truncate text-[13px] leading-snug">{{ playlistTitle(row, roles) }}</span>
            <span v-if="subtitleOf(row)" class="truncate text-[11.5px] text-muted-foreground">{{ subtitleOf(row) }}</span>
          </span>

          <span v-if="durationOf(row)" class="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">{{ durationOf(row) }}</span>

          <!-- 删除:悬停该行才出现,挪走就消失 —— 曲目列表里不该常驻一排叉。 -->
          <Button
            variant="ghost"
            size="icon-sm"
            class="size-6 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover/track:opacity-100 focus-visible:opacity-100"
            aria-label="删除这首"
            @click="removeTrack(row)"
          >
            <XIcon class="size-3.5" />
          </Button>
        </li>
      </ol>
    </template>
  </div>

  <PlaylistAddDialog
    :open="adding"
    :columns="columns"
    @submit="addTrack"
    @close="adding = false"
  />

  <AlertDialog :open="creating" @update:open="creating = false">
    <AlertDialogContent class="max-w-sm">
      <AlertDialogHeader>
        <AlertDialogTitle class="text-[14px]">新建歌单表</AlertDialogTitle>
      </AlertDialogHeader>
      <div>
        <Input
          v-model="newName"
          class="h-8 text-[13px]"
          placeholder="歌单名"
          @keydown.enter.prevent="confirmCreate"
        />
        <p class="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
          表建在这篇笔记旁边，带上「歌名 / 歌手 / 专辑 / 时长 / 封面」五列；同名表已存在时直接用它。
        </p>
      </div>
      <AlertDialogFooter>
        <AlertDialogCancel as-child>
          <Button variant="ghost" size="sm" class="text-[13px]">取消</Button>
        </AlertDialogCancel>
        <Button size="sm" class="text-[13px]" :disabled="newName.trim() === ''" @click="confirmCreate">新建</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
