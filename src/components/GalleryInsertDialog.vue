<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue"
import { DatabaseIcon, PlusIcon } from "@lucide/vue"
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import PassphraseFields from "@/components/PassphraseFields.vue"
import { useWorkspace } from "@/composables/useWorkspace"
import { fileStem } from "@/lib/fs/policy"
import { fileName } from "@/lib/paths"
import { passphraseProblem } from "@/lib/vault"

/**
 * 插引用块前的「选表」对话框(插入与转换共用)。
 *
 * 画册块、书签块、看板块、账目块、统计卡与订阅块与数据表引用块一样,**先有文件才能插** —— 指向不存在的 `.tbl` 就是
 * 插一个永远读不到的提示态。区别在于数据表块是自动撞名/新建,这些块把选择权交给
 * 用户:列出工作区全部表挑一张,或点名新建一张。
 *
 * `kind` 决定确认后落哪种块,文案跟着换 —— 对话框本身对两者是同一个交互。
 *
 * `retypeId` 非空时是**转换模式**:不插新块,把那个块原地转换并指向所选的表
 * (`/` 菜单与手柄的「转换为」从这条路进来,同样必须先挑表)。
 *
 * 确认**不自动关**:新建撞名会直接引用已有文件(与 `resolveDataTableForNote` 同一条
 * 规则),路径解析失败也不关 —— 原因已写进 `fsError`,对话框留着让人换一个名字。
 */
const props = defineProps<{
  /** 落哪种引用块。 */
  kind: "gallery" | "bookmark" | "kanban" | "ledger" | "stat" | "subscription" | "playlist" | "vault"
  /** 插入位置(插入模式)。null 表示不是插入模式。与 `retypeId` 同时为 null 即关闭。 */
  index: number | null
  /** 转换模式:待转换的块 id。null 表示不是转换模式。 */
  retypeId: string | null
}>()

const emit = defineEmits<{ close: [] }>()

const { tablePaths, insertReferenceBlock, convertBlockToFileType, activePath } = useWorkspace()

const NEW = "__new__"

/** 选中的表路径;`NEW` 表示「新建一张」。默认选中新建 —— 空工作区也能一步走通。 */
const selection = ref(NEW)
const newName = ref("")

const nameInput = ref<InstanceType<typeof Input> | null>(null)

/** 新建表的名字默认跟笔记同名主干:最常见的意图就是「给这篇笔记配一批链接」。 */
const defaultName = computed(() => {
  const path = activePath.value
  return path === "" ? "" : fileStem(fileName(path))
})

const open = computed(() => props.index !== null || props.retypeId !== null)

/** 每次打开都回到「新建」起点,名字重置为笔记同名主干。 */
watch(open, async (value) => {
  if (!value) return
  selection.value = NEW
  newName.value = defaultName.value
  passphrase.value = ""
  passphraseConfirm.value = ""
  await nextTick()
  nameInput.value?.$el?.focus()
})

const tableOptions = computed(() =>
  tablePaths.value.map((path) => ({ path, label: fileName(path).replace(/\.tbl$/i, "") })),
)

const KIND_LABEL = { gallery: "画册", bookmark: "书签", kanban: "看板", ledger: "账目", stat: "统计卡", subscription: "订阅", playlist: "歌单", vault: "密码本" } as const

/**
 * 密码本的口令与它的确认。
 *
 * **两个字段都要** —— 打错一个字，那份数据就永远读不出来了（ADR-0052：口令不落盘，
 * 忘了就没有找回的路径）。所以这里宁可多敲一遍。规矩与一键生成在 `PassphraseFields`，
 * 块里换口令用的是同一个组件。
 */
const passphrase = ref("")
const passphraseConfirm = ref("")

/**
 * 口令填了、但不合规矩（或两次不一致）—— 拦下。
 *
 * **留空放行**：引用一张已有的密码本时不必填（那张表有自己的口令），那时空口令是合法的。
 */
const passphraseRejected = computed(() => {
  if (props.kind !== "vault" || passphrase.value === "") return false
  return passphraseProblem(passphrase.value) !== "" || passphrase.value !== passphraseConfirm.value
})

/** 确认。插入落了块、或转换真的换了块,才关。 */
async function confirm() {
  const target = selection.value === NEW ? "" : selection.value
  const stem = newName.value.trim()

  // 密码本：口令不合规矩就别往下走 —— 这一步拦不住，后面就再也读不回来了。
  if (passphraseRejected.value) return

  if (props.retypeId !== null) {
    const converted = await convertBlockToFileType(props.retypeId, props.kind, target, stem, passphrase.value)
    if (converted !== "") emit("close")
    return
  }

  if (props.index === null) return
  const blockId = await insertReferenceBlock(props.index, props.kind, target, stem, passphrase.value)
  if (blockId !== "") emit("close")
}
</script>

<template>
  <AlertDialog :open="open" @update:open="emit('close')">
    <AlertDialogContent class="max-w-sm" @open-auto-focus.prevent>
      <AlertDialogHeader>
        <AlertDialogTitle class="text-14">
          选择数据表
        </AlertDialogTitle>
        <AlertDialogDescription class="text-12">
          {{ KIND_LABEL[kind] }}展示一张数据表的数据 —— 挑工作区里已有的,或新建一张。
        </AlertDialogDescription>
      </AlertDialogHeader>

      <div class="max-h-56 space-y-0.5 overflow-y-auto rounded-md border border-line p-1">
        <label
          v-for="option in tableOptions"
          :key="option.path"
          class="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-13 hover:bg-muted"
          :class="selection === option.path && 'bg-muted'"
          @click="selection = option.path"
        >
          <input v-model="selection" type="radio" name="file-block-table" :value="option.path" class="accent-foreground">
          <DatabaseIcon class="size-3.5 shrink-0 text-muted-foreground" />
          <span class="truncate">{{ option.label }}</span>
        </label>

        <label
          class="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-13 hover:bg-muted"
          :class="selection === NEW && 'bg-muted'"
          @click="selection = NEW"
        >
          <input v-model="selection" type="radio" name="file-block-table" :value="NEW" class="accent-foreground">
          <PlusIcon class="size-3.5 shrink-0 text-muted-foreground" />
          <span>新建数据表…</span>
        </label>
      </div>

      <Input
        v-if="selection === NEW"
        ref="nameInput"
        v-model="newName"
        placeholder="数据表名(不必写 .tbl)"
        class="h-8 text-13 md:text-13"
        @keydown.enter.prevent="confirm"
      />

      <!--
        密码本要多两个字段：**口令**与**确认口令**。
        引用一张**已有的密码本**时不用填（那张表有自己的口令，要开的时候自己输）；
        新建、或把一张普通表转成密码本时才用得上 —— 那两种情况口令是必须的。
      -->
      <template v-if="props.kind === 'vault'">
        <p class="mt-3 text-11 text-muted-foreground">
          新建密码本（或把选中的普通表转成密码本）需要一个口令：至少 8 位，含大写字母、小写字母、
          数字与符号。口令不保存在应用里 —— 忘了，这张表就再也读不出来了。可以直接生成一个。
        </p>
        <PassphraseFields v-model:passphrase="passphrase" v-model:confirm="passphraseConfirm" />
      </template>

      <AlertDialogFooter>
        <AlertDialogCancel as-child>
          <Button variant="ghost" size="sm" class="text-13">取消</Button>
        </AlertDialogCancel>
        <Button size="sm" class="text-13" @click="confirm">插入</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
