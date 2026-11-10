<script setup lang="ts">
import type { DataColumn, DataRow } from "@/types/data-table"
import type { VaultBlock } from "@/types/workspace"
import { computed, nextTick, ref } from "vue"
import { CheckIcon, CopyIcon, DatabaseIcon, EyeIcon, EyeOffIcon, KeyRoundIcon, LockIcon, PlusIcon, Trash2Icon } from "@lucide/vue"
import PassphraseFields from "@/components/PassphraseFields.vue"
import VaultIconDialog from "@/components/VaultIconDialog.vue"
import { Input } from "@/components/ui/input"
import { useCopied } from "@/composables/useCopied"
import { useTableEntry } from "@/composables/useTableEntry"
import { useTables } from "@/composables/useTables"
import { useToast } from "@/composables/useToast"
import { useWorkspace } from "@/composables/useWorkspace"
import { describeError } from "@/lib/errors"
import * as dt from "@/lib/data-table"
import { SECRET_MASK } from "@/lib/secret"
import { passphraseProblem, resolveVaultRoles } from "@/lib/vault"
import { NOTICE_INLINE } from "@/components/ui/notice/recipes"

/**
 * 密码本块：一张凭据清单，每行一条账号。
 *
 * 与其它引用块同源（ADR-0005）：记录在 `.tbl` 里，块上只有路径与「哪一列是密码」。
 * 唯一的不同是那张 `.tbl` 在盘上是**加密的**（ADR-0052）—— 所以这个视图多一态：
 * **已锁定**。锁着的时候只有一句提示与一个口令框，连条数都不给。
 *
 * 三条红线：
 *
 * 1. **明文默认不上屏**。密码格默认是掩码，点眼睛才换成一个输入框（打开就是为了改）。
 *    明文态是**组件状态**，不落盘 —— 重新挂载就回到掩码。
 * 2. **导出的 `.html` 里没有内容**。这个块在盘上只留一个指针（见 `serialize.ts`），
 *    所以笔记分享出去时凭据不会跟着走。
 * 3. **口令不落盘**。解出来的密钥只在内存里（注册表的 `vaultKeys`），应用一关就没了。
 */
const props = defineProps<{ block: VaultBlock }>()

const { openFile, rebindTable, tablePaths } = useWorkspace()
const { notify } = useToast()
const { copied, flash } = useCopied()
const tables = useTables()

const { state, table, rows, change } = useTableEntry(() => props.block.path)

/**
 * 五个列角色。认不出来就是空串 —— 视图据此少显示一栏，而不是显示错的一栏。
 *
 * 表还没读到时给一组全空 —— 那是「还没读」而不是「没有密码列」，两种情况在界面上
 * 本来就分开（一个是读盘提示，一个是解锁后的清单），不会混淆。
 */
const roles = computed(() =>
  table.value === null
    ? { name: "", account: "", password: "", icon: "", site: "" }
    : resolveVaultRoles(table.value, props.block.passwordColumn),
)

function columnById(id: string): DataColumn | null {
  if (id === "" || table.value === null) return null
  return table.value.columns.find((column) => column.id === id) ?? null
}

/** 密码列。认不出就没有密码格 —— 绝不拿别的列顶替。 */
const passwordColumn = computed(() => columnById(roles.value.password))
const iconColumn = computed(() => columnById(roles.value.icon))

/** 一格里的文字。 */
function cellText(row: DataRow, column: DataColumn | null): string {
  if (column === null) return ""
  const value = dt.cellValue(row, column)
  return typeof value === "string" ? value : value === null ? "" : String(value)
}

/** 图标格当前画出来的地址（data URI 或 URL）；空串 = 还没有图标。 */
function iconSrc(row: DataRow): string {
  const column = iconColumn.value
  if (column === null) return ""
  const value = dt.cellValue(row, column)
  return typeof value === "string" ? value : ""
}

// ---- 配置图标 ----

/**
 * 正在配置图标的那一行（行 id）；空串 = 弹窗关着。
 *
 * 图标就地可配（不必绕去数据表编辑页）：点条目左边那颗图标就弹表单，本地图片与
 * 在线地址二选一，输完即时预览。落进图标格的仍是一个能当 `<img src>` 用的字符串 ——
 * 与数据表图片列同一口径，没有图标列（表里那张 image 列被删了）时这颗图标不可点。
 */
const iconRowId = ref("")

const iconDialogOpen = computed(() => iconRowId.value !== "")

/** 弹窗里编辑的当前值：打开那一刻那一行的图标。 */
const iconDialogValue = computed(() => {
  if (iconRowId.value === "") return ""
  const row = rows.value.find((item) => item.id === iconRowId.value)
  return row === undefined ? "" : iconSrc(row)
})

function openIconDialog(row: DataRow): void {
  if (iconColumn.value === null) return
  iconRowId.value = row.id
}

function closeIconDialog(): void {
  iconRowId.value = ""
}

/** 提交图标：空串落 `null`（清除），其余原样存进图标格。 */
function commitIcon(value: string): void {
  const rowId = iconRowId.value
  iconRowId.value = ""
  const column = iconColumn.value
  if (rowId === "" || column === null) return
  const row = rows.value.find((item) => item.id === rowId)
  if (row === undefined) return
  const next = value === "" ? null : value
  if (next === dt.cellValue(row, column)) return
  void change((current) => dt.replaceRow(current, dt.setCell(row, column.id, next)))
}

/**
 * 重新挑一张表。选完把下拉复位到占位项 —— 换过去要是读不到，下拉不归位就会停在
 * 一个「看起来已经选好了」的错值上。
 */
function onReselect(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLSelectElement)) return
  const picked = target.value
  target.value = ""
  if (picked !== "") rebindTable(props.block.id, picked)
}

/** 打开密码本表本身：切到它的标签页。 */
function openTable(): void {
  if (props.block.path === "") return
  openFile(props.block.path)
}

// ---- 锁定与解锁 ----

/** 口令输入框的值。组件状态，不落盘。 */
const passphrase = ref("")
const unlocking = ref(false)

/** 解锁。口令错就说口令错 —— 不说「文件坏了」，那会让人怀疑自己的文件。 */
async function unlock(): Promise<void> {
  if (props.block.path === "" || passphrase.value === "") return
  unlocking.value = true
  try {
    const failure = await tables.unlockVault(props.block.path, passphrase.value)
    if (failure !== null) {
      notify(failure, "error")
      return
    }
    passphrase.value = ""
  } finally {
    unlocking.value = false
  }
}

/**
 * 锁回去：丢掉密钥，内存里那份数据也不在手边了。
 *
 * **先落盘再锁** —— 锁了就没有密钥了，而落盘要用它加密。带着未落盘的改动锁回去，
 * 那些改动就再也写不出去了（`flush` 会说「密码本已锁定,没法落盘」）。
 */
async function lock(): Promise<void> {
  const failure = await tables.flush(props.block.path)
  if (failure !== null) {
    notify(failure, "error")
    return
  }
  tables.lockVault(props.block.path)
  passphrase.value = ""
}

// ---- 换口令 ----

/**
 * 换口令的面板（ADR-0053）。
 *
 * 换口令要重新加密整张表，所以这一步不是「改一个字段」而是**一次写盘**：
 * 原口令先验，验过了才动盘上那份。填完提交，成功就收起面板 —— 口令不进任何状态，
 * 关掉面板也一并清掉输入框里的字符。
 */
const changingPassphrase = ref(false)
const oldPassphrase = ref("")
const newPassphrase = ref("")
const newPassphraseConfirm = ref("")
const savingPassphrase = ref(false)

/** 新口令不合规矩的那句话。空串 = 合规，或还没填。 */
const newPassphraseProblem = computed(() =>
  newPassphrase.value === "" ? "" : passphraseProblem(newPassphrase.value),
)

/** 三个字段都到位才让按 —— 少一个都只会换来一句「口令不对」。 */
const canChangePassphrase = computed(
  () =>
    oldPassphrase.value !== "" &&
    newPassphrase.value !== "" &&
    passphraseProblem(newPassphrase.value) === "" &&
    newPassphrase.value === newPassphraseConfirm.value,
)

function openPassphraseChange(): void {
  changingPassphrase.value = true
  oldPassphrase.value = ""
  newPassphrase.value = ""
  newPassphraseConfirm.value = ""
}

function closePassphraseChange(): void {
  changingPassphrase.value = false
  oldPassphrase.value = ""
  newPassphrase.value = ""
  newPassphraseConfirm.value = ""
}

async function submitPassphraseChange(): Promise<void> {
  if (savingPassphrase.value) return
  if (oldPassphrase.value === "") {
    notify("先填原口令 —— 换口令要先证明这是你的密码本", "error")
    return
  }
  if (newPassphraseProblem.value !== "" || newPassphrase.value !== newPassphraseConfirm.value) return
  savingPassphrase.value = true
  try {
    const failure = await tables.changeVaultPassphrase(props.block.path, oldPassphrase.value, newPassphrase.value)
    if (failure !== null) {
      notify(failure, "error")
      return
    }
    closePassphraseChange()
    notify("口令已换 —— 下次要用新口令才打得开")
  } finally {
    savingPassphrase.value = false
  }
}

// ---- 明文开关 ----

/**
 * 哪一行正开着明文。**组件状态** —— 关掉笔记再回来一定是掩码。
 *
 * 用行 id 而不是行下标：删了一行之后下标会移位，开着的就会落到别的行上。
 */
const revealedRow = ref("")

/** 视图根节点。找明文输入框时**只在本视图里找** —— 页面上可能有好几个密码本块。 */
const root = ref<HTMLElement | null>(null)

async function reveal(row: DataRow): Promise<void> {
  revealedRow.value = row.id
  await nextTick()
  const inputs = root.value?.querySelectorAll<HTMLInputElement>("[data-vault-secret-input]") ?? []
  for (const input of inputs) {
    if (input.dataset.rowId === row.id) {
      input.focus()
      break
    }
  }
}

function hide(): void {
  revealedRow.value = ""
}

/** 复制密码。复制的是**明文**，不是掩码 —— 掩码复制出去没有意义。 */
async function copyPassword(row: DataRow): Promise<void> {
  const column = passwordColumn.value
  if (column === null) return
  const text = cellText(row, column)
  if (text === "") return
  try {
    await navigator.clipboard.writeText(text)
  } catch (error) {
    notify(`复制密码失败：${describeError(error)}`, "error")
    return
  }
  flash()
}

// ---- 编辑 ----

/** 提交一格。空串也照收（清空是正常的编辑动作）。 */
function commit(row: DataRow, column: DataColumn | null, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  if (column === null) return
  const parsed = dt.parseCellInput(target.value, column.type)
  if (parsed === dt.cellValue(row, column)) return
  void change((current) => dt.replaceRow(current, dt.setCell(row, column.id, parsed)))
}

/** 一格里的回车 = 收工（失焦即提交）。 */
function blurOnEnter(event: KeyboardEvent): void {
  if (event.key !== "Enter") return
  event.preventDefault()
  if (event.target instanceof HTMLInputElement) event.target.blur()
}

/** 密码格：Esc 先收明文，其余照常 —— 别让它冒到块层去「退出编辑」。 */
function onSecretKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && revealedRow.value !== "") {
    event.stopPropagation()
    hide()
    return
  }
  blurOnEnter(event)
}

/** 加一条凭据。 */
function addEntry(): void {
  void change((current) => dt.addRow(current))
}

/** 删一条凭据 —— 先弹确认（ADR-0037）。空行不弹。 */
const deletingId = ref("")
const deletingSummary = computed(() => {
  if (deletingId.value === "" || table.value === null) return ""
  const row = table.value.rows.find((item) => item.id === deletingId.value)
  if (row === undefined) return ""
  const name = cellText(row, columnById(roles.value.name))
  return name === "" ? "这条凭据" : name
})

function requestDelete(row: DataRow): void {
  if (dt.isBlankRow(row, table.value?.columns ?? [])) {
    void change((current) => dt.removeRow(current, row.id))
    return
  }
  deletingId.value = row.id
}

function closeDelete(): void {
  deletingId.value = ""
}

function confirmDelete(): void {
  const id = deletingId.value
  deletingId.value = ""
  if (id === "") return
  void change((current) => dt.removeRow(current, id))
}
</script>

<template>
  <!-- 空指针：如实说没指定，而不是永远转圈。 -->
  <div
    v-if="props.block.path === ''"
    :class="NOTICE_INLINE"
  >
    <DatabaseIcon class="size-3.5 shrink-0 text-muted-foreground" />
    <span class="text-12 text-muted-foreground">密码本未指定数据表 —— 删掉这个块，用 / 菜单重新插入。</span>
  </div>

  <!-- 引用的文件读不到：提示态，不是错误态。 -->
  <div
    v-else-if="state === 'missing' || state === 'failed'"
    :class="NOTICE_INLINE"
  >
    <DatabaseIcon class="size-3.5 shrink-0 text-muted-foreground" />
    <span class="min-w-0 flex-1 text-12 text-muted-foreground">
      密码本引用的数据表不存在：<span class="font-mono">{{ props.block.path }}</span>
    </span>
    <select
      v-if="tablePaths.length > 0"
      :value="''"
      class="shrink-0 cursor-pointer rounded border border-line bg-transparent px-1.5 py-1 text-12 outline-none"
      @change="onReselect"
    >
      <option value="" disabled>重新选择数据表…</option>
      <option v-for="item in tablePaths" :key="item" :value="item">{{ item.split('/').pop()?.replace(/\.tbl$/i, '') }}</option>
    </select>
  </div>

  <!--
    锁着。这是**正常状态**，不是错误：用户还没输口令。
    这里只给一个口令框 —— 连条数都不说,那也是信息。
  -->
  <div
    v-else-if="state === 'locked'"
    class="my-4 rounded-lg border border-line bg-muted/30 px-3 py-2.5"
  >
    <div class="flex items-center gap-2.5">
      <LockIcon class="size-3.5 shrink-0 text-muted-foreground" />
      <span class="min-w-0 flex-1 text-12 text-muted-foreground">密码本已锁定</span>
    </div>
    <div class="mt-2 flex items-center gap-1.5">
      <input
        v-model="passphrase"
        type="password"
        data-vault-passphrase
        class="min-w-0 flex-1 rounded-md bg-card px-2 py-1 text-13 outline-none ring-1 ring-line/70"
        placeholder="口令"
        autocomplete="off"
        spellcheck="false"
        @keydown.enter.prevent="unlock"
      >
      <button
        type="button"
        class="shrink-0 rounded-md bg-card px-2.5 py-1 text-12 ring-1 ring-line/70 transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="passphrase === '' || unlocking"
        data-vault-unlock
        @click="unlock"
      >
        解锁
      </button>
    </div>
  </div>

  <!-- 还没读完。 -->
  <div
    v-else-if="table === null"
    class="my-4 flex items-center gap-2.5 rounded-lg border border-line bg-muted/30 px-3 py-2.5"
  >
    <DatabaseIcon class="size-3.5 shrink-0 animate-pulse text-muted-foreground" />
    <span class="text-12 text-muted-foreground">正在读取密码本…</span>
  </div>

  <!-- 解锁后的清单。 -->
  <div v-else ref="root" class="group/vault relative my-4 rounded-lg border border-line bg-muted/30">
    <!--
      标题行**不放钥匙图标**。块的手柄上已经有一颗（块的类型图标，hover 才现���），
      再在这里画一颗，hover 的时候左上角就是两个一样的钥匙 —— 同一个意思说了两遍。
      类型图标归手柄，这里只管说「有几条凭据」。
    -->
    <div class="flex items-center gap-2 border-b border-line px-3 py-2">
      <span class="min-w-0 flex-1 truncate text-12 text-muted-foreground">
        {{ rows.length }} 条凭据
      </span>
      <button
        type="button"
        class="shrink-0 rounded px-1.5 py-0.5 text-12 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        title="换一个口令 —— 会用新口令把这张表重新加密一遍"
        data-vault-change-passphrase
        @click="changingPassphrase ? closePassphraseChange() : openPassphraseChange()"
      >
        改口令
      </button>
      <button
        type="button"
        class="shrink-0 rounded px-1.5 py-0.5 text-12 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        title="锁回去（关掉应用也会自动失效）"
        data-vault-lock
        @click="lock()"
      >
        锁定
      </button>
    </div>

    <!--
      换口令：原口令 + 新口令 + 确认，提交时先把原口令解一次盘上那份。
      面板就嵌在标题行下面 —— 不用弹层：这个动作只有三个字段，弹层反而多一个要关的东西。
    -->
    <div
      v-if="changingPassphrase"
      class="border-b border-line bg-card px-3 py-2"
      data-vault-passphrase-panel
    >
      <p class="text-11 text-muted-foreground">
        换口令会用新口令把这张表重新加密一遍 —— 旧口令之后再也打不开它。
      </p>
      <Input
        v-model="oldPassphrase"
        type="password"
        placeholder="原口令"
        class="mt-1.5 h-8 text-13 md:text-13"
        autocomplete="off"
        spellcheck="false"
        data-vault-old-passphrase
        @keydown.enter.prevent="submitPassphraseChange"
      />
      <PassphraseFields
        v-model:passphrase="newPassphrase"
        v-model:confirm="newPassphraseConfirm"
        @keydown.enter.prevent="submitPassphraseChange"
      />
      <div class="mt-2 flex items-center gap-2">
        <span class="min-w-0 flex-1" />
        <button
          type="button"
          class="shrink-0 rounded px-2 py-1 text-12 text-muted-foreground transition-colors hover:text-foreground"
          @click="closePassphraseChange"
        >
          取消
        </button>
        <button
          type="button"
          class="shrink-0 rounded-md bg-card px-2.5 py-1 text-12 ring-1 ring-line/70 transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="savingPassphrase || !canChangePassphrase"
          data-vault-change-submit
          @click="submitPassphraseChange"
        >
          改口令
        </button>
      </div>
    </div>

    <div v-if="rows.length === 0" class="px-3 py-4 text-12 text-muted-foreground/70">
      还是空的 —— 点下面的「加一条」存第一条凭据。
    </div>

    <ul v-else class="divide-y divide-line">
      <li
        v-for="row in rows"
        :key="row.id"
        data-vault-entry
        :data-row-id="row.id"
        class="group/entry flex items-center gap-2.5 px-3 py-2"
      >
        <!-- 图标：点它就地配置（本地图片 / 在线地址，弹窗里即时预览）。没有图标列时不可点。 -->
        <button
          type="button"
          class="grid size-6 shrink-0 place-items-center overflow-hidden rounded-md transition-opacity hover:opacity-75 disabled:cursor-default disabled:hover:opacity-100"
          :class="iconSrc(row) === '' && 'bg-muted text-10 text-muted-foreground'"
          :disabled="iconColumn === null"
          :title="iconColumn === null ? '没有图标列' : '配置图标'"
          data-vault-icon
          @click="openIconDialog(row)"
        >
          <img
            v-if="iconSrc(row) !== ''"
            :src="iconSrc(row)"
            alt=""
            loading="lazy"
            decoding="async"
            class="size-full object-cover"
          >
          <KeyRoundIcon v-else class="size-3" />
        </button>

        <!-- 名称。 -->
        <input
          v-if="columnById(roles.name)"
          :value="cellText(row, columnById(roles.name))"
          class="min-w-0 flex-1 bg-transparent text-13 font-medium text-foreground outline-none placeholder:text-muted-foreground/60"
          placeholder="名称"
          spellcheck="false"
          @change="(event: Event) => commit(row, columnById(roles.name), event)"
          @keydown.enter="blurOnEnter"
        >
        <span v-else class="min-w-0 flex-1 truncate text-13 text-muted-foreground/70">（没有名称列）</span>

        <!-- 账号。 -->
        <input
          v-if="columnById(roles.account)"
          :value="cellText(row, columnById(roles.account))"
          class="min-w-0 flex-1 bg-transparent text-12 text-muted-foreground outline-none placeholder:text-muted-foreground/50"
          placeholder="账号"
          spellcheck="false"
          @change="(event: Event) => commit(row, columnById(roles.account), event)"
          @keydown.enter="blurOnEnter"
        >

        <!-- 密码：默认掩码，点眼睛才开。 -->
        <div class="flex min-w-0 flex-1 items-center gap-1 rounded-md bg-card px-2 py-1 ring-1 ring-line/70">
          <input
            v-if="revealedRow === row.id"
            :value="cellText(row, passwordColumn)"
            :data-row-id="row.id"
            data-vault-secret
            data-vault-secret-input
            class="min-w-0 flex-1 bg-transparent font-mono text-12 text-foreground outline-none"
            placeholder="密码"
            spellcheck="false"
            autocomplete="off"
            @change="(event: Event) => commit(row, passwordColumn, event)"
            @keydown="onSecretKeydown"
          >
          <button
            v-else
            type="button"
            data-vault-mask
            class="min-w-0 flex-1 truncate text-left font-mono text-12 tracking-[0.12em] text-muted-foreground"
            title="显示明文"
            @click="reveal(row)"
          >
            {{ cellText(row, passwordColumn) === "" ? "—" : SECRET_MASK }}
          </button>

          <button
            type="button"
            class="grid size-5 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="cellText(row, passwordColumn) === ''"
            :title="copied ? '已复制' : '复制密码'"
            @mousedown.prevent
            @click="copyPassword(row)"
          >
            <CheckIcon v-if="copied" class="size-3" />
            <CopyIcon v-else class="size-3" />
          </button>

          <button
            type="button"
            class="grid size-5 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            :title="revealedRow === row.id ? '收起明文' : '显示明文'"
            @mousedown.prevent
            @click="revealedRow === row.id ? hide() : reveal(row)"
          >
            <EyeOffIcon v-if="revealedRow === row.id" class="size-3" />
            <EyeIcon v-else class="size-3" />
          </button>
        </div>

        <!-- 网站。 -->
        <input
          v-if="columnById(roles.site)"
          :value="cellText(row, columnById(roles.site))"
          class="min-w-0 flex-1 bg-transparent text-12 text-muted-foreground outline-none placeholder:text-muted-foreground/50"
          placeholder="网站"
          spellcheck="false"
          @change="(event: Event) => commit(row, columnById(roles.site), event)"
          @keydown.enter="blurOnEnter"
        >

        <button
          type="button"
          class="grid size-6 shrink-0 place-items-center rounded text-muted-foreground opacity-0 transition-colors hover:bg-muted hover:text-foreground focus:opacity-100 group-hover/entry:opacity-100"
          title="删掉这条凭据"
          @click="requestDelete(row)"
        >
          <Trash2Icon class="size-3.5" />
        </button>
      </li>
    </ul>

    <!-- 浮岛：加一条 / 打开这张表。 -->
    <div
      class="absolute -bottom-3.5 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full bg-popover p-0.5 opacity-0 shadow-island transition-opacity group-hover/vault:opacity-100 focus-within:opacity-100"
    >
      <button
        type="button"
        class="flex h-6 items-center gap-1 rounded-full px-2 text-12 text-muted-foreground transition-colors hover:text-foreground"
        @click="addEntry"
      >
        <PlusIcon class="size-3" />加一条
      </button>
      <button
        type="button"
        class="flex h-6 items-center gap-1 rounded-full px-2 text-12 text-muted-foreground transition-colors hover:text-foreground"
        @click="openTable"
      >
        打开
      </button>
    </div>

    <!-- 删一条的确认（ADR-0037：先弹确认，空行不弹）。 -->
    <div
      v-if="deletingId !== ''"
      class="flex items-center gap-2 border-t border-line bg-card px-3 py-2"
    >
      <span class="min-w-0 flex-1 text-12 text-foreground">删掉「{{ deletingSummary }}」这条凭据？</span>
      <button
        type="button"
        class="shrink-0 rounded px-2 py-0.5 text-12 text-muted-foreground hover:text-foreground"
        @click="closeDelete"
      >
        取消
      </button>
      <button
        type="button"
        class="shrink-0 rounded bg-destructive px-2 py-0.5 text-12 text-destructive-foreground"
        @click="confirmDelete"
      >
        删掉
      </button>
    </div>

    <!-- 配置图标的弹窗：本地图片 / 在线地址二选一，即时预览。 -->
    <VaultIconDialog
      :open="iconDialogOpen"
      :value="iconDialogValue"
      @close="closeIconDialog"
      @confirm="commitIcon"
    />
  </div>
</template>
