<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue"
import { DatabaseIcon, PlusIcon } from "@lucide/vue"
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useWorkspace } from "@/composables/useWorkspace"
import { fileStem } from "@/lib/fs/policy"
import { fileName } from "@/lib/paths"

/**
 * 插引用块前的「选表」对话框(插入与转换共用)。
 *
 * 画册块、书签块和看板块与数据表引用块一样,**先有文件才能插** —— 指向不存在的 `.tbl` 就是
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
  kind: "gallery" | "bookmark" | "kanban" | "ledger"
  /** 插入位置(插入模式)。null 表示不是插入模式。与 `retypeId` 同时为 null 即关闭。 */
  index: number | null
  /** 转换模式:待转换的块 id。null 表示不是转换模式。 */
  retypeId: string | null
}>()

const emit = defineEmits<{ close: [] }>()

const { tablePaths, insertGalleryBlock, insertBookmarkBlock, insertKanbanBlock, insertLedgerBlock, convertBlockToFileType, activePath } = useWorkspace()

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
  await nextTick()
  nameInput.value?.$el?.focus()
})

const tableOptions = computed(() =>
  tablePaths.value.map((path) => ({ path, label: fileName(path).replace(/\.tbl$/i, "") })),
)

const KIND_LABEL = { gallery: "画册", bookmark: "书签", kanban: "看板", ledger: "账目" } as const

/** 确认。插入落了块、或转换真的换了块,才关。 */
async function confirm() {
  const target = selection.value === NEW ? "" : selection.value
  const stem = newName.value.trim()

  if (props.retypeId !== null) {
    const converted = await convertBlockToFileType(props.retypeId, props.kind, target, stem)
    if (converted !== "") emit("close")
    return
  }

  if (props.index === null) return
  const insert =
    props.kind === "gallery"
      ? insertGalleryBlock
      : props.kind === "bookmark"
        ? insertBookmarkBlock
        : props.kind === "kanban"
          ? insertKanbanBlock
          : insertLedgerBlock
  const blockId = await insert(props.index, target, stem)
  if (blockId !== "") emit("close")
}
</script>

<template>
  <AlertDialog :open="open" @update:open="emit('close')">
    <AlertDialogContent class="max-w-sm" @open-auto-focus.prevent>
      <AlertDialogHeader>
        <AlertDialogTitle class="text-[14px]">
          选择数据表
        </AlertDialogTitle>
        <AlertDialogDescription class="text-[12px]">
          {{ KIND_LABEL[kind] }}展示一张数据表的数据 —— 挑工作区里已有的,或新建一张。
        </AlertDialogDescription>
      </AlertDialogHeader>

      <div class="max-h-56 space-y-0.5 overflow-y-auto rounded-md border border-line p-1">
        <label
          v-for="option in tableOptions"
          :key="option.path"
          class="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[13px] hover:bg-muted"
          :class="selection === option.path && 'bg-muted'"
          @click="selection = option.path"
        >
          <input v-model="selection" type="radio" name="file-block-table" :value="option.path" class="accent-foreground">
          <DatabaseIcon class="size-3.5 shrink-0 text-muted-foreground" />
          <span class="truncate">{{ option.label }}</span>
        </label>

        <label
          class="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[13px] hover:bg-muted"
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
        class="h-8 text-[13px]"
        @keydown.enter.prevent="confirm"
      />

      <AlertDialogFooter>
        <AlertDialogCancel as-child>
          <Button variant="ghost" size="sm" class="text-[13px]">取消</Button>
        </AlertDialogCancel>
        <Button size="sm" class="text-[13px]" @click="confirm">插入</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
