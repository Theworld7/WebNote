<script setup lang="ts">
import type { DataCellValue, DataColumn } from "@/types/data-table"
import { computed, ref, watch } from "vue"
import { ImageIcon, XIcon } from "@lucide/vue"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { emptyValueOf, parseCellInput } from "@/lib/data-table"
import { markImageBroken, usableImage } from "@/lib/broken-images"
import { isImageFile, readImageFile } from "@/lib/image"

/**
 * 往歌单的表里加一首歌。
 *
 * 表单字段**按表的列现生成**,不预设「歌名 / 歌手 / 时长」—— 歌单展示的就是那张
 * 表,表单要是只认固定几列,表里多出来的列就永远录不进新记录。控件类型跟着列类型
 * 走:text / number / date / select / checkbox / image 各一种,与数据表编辑页的
 * 单元格入口同一套语义(`parseCellInput` 负责把输入收成合法值)。
 *
 * 只填想填的:空着的列就是空值,不逼着人补全 —— 一张歌单里「专辑」留空的歌多得是。
 * 一处都没填时确认键禁用,免得往表里塞一条什么都没有的空记录。
 */
const props = defineProps<{
  /** 打开中。与 `columns` 一起由父组件给 —— 对话框自己不认识那张表。 */
  open: boolean
  /** 目标表的列,决定表单长什么样。 */
  columns: readonly DataColumn[]
}>()

const emit = defineEmits<{
  (event: "submit", values: Record<string, DataCellValue>): void
  (event: "close"): void
}>()

/** 草稿:列 id → 值。打开时按列类型铺一遍空值。 */
const draft = ref<Record<string, DataCellValue>>({})

watch(
  () => props.open,
  (open) => {
    if (!open) return
    const next: Record<string, DataCellValue> = {}
    for (const column of props.columns) next[column.id] = emptyValueOf(column.type)
    draft.value = next
  },
  { immediate: true },
)

function valueOf(column: DataColumn): DataCellValue {
  const value = draft.value[column.id]
  return value === undefined ? emptyValueOf(column.type) : value
}

function textOf(column: DataColumn): string {
  const value = valueOf(column)
  return typeof value === "string" ? value : ""
}

/** 预览能不能画。失败过的按空处理，回落到下面那个图标占位。 */
function imagePreviewOf(column: DataColumn): string {
  return usableImage(textOf(column))
}

function boolOf(column: DataColumn): boolean {
  return valueOf(column) === true
}

function onText(column: DataColumn, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  draft.value = { ...draft.value, [column.id]: parseCellInput(target.value, column.type) }
}

function onSelect(column: DataColumn, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLSelectElement)) return
  draft.value = { ...draft.value, [column.id]: target.value === "" ? null : target.value }
}

function onToggle(column: DataColumn, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  draft.value = { ...draft.value, [column.id]: target.checked }
}

async function onPickImage(column: DataColumn, event: Event): Promise<void> {
  const target = event.target
  if (!(target instanceof HTMLInputElement) || target.files === null) return
  const file = target.files[0]
  // 先清空再读:清掉后重选同一个文件也能触发 change。
  target.value = ""
  if (file === undefined || !isImageFile(file)) return
  draft.value = { ...draft.value, [column.id]: await readImageFile(file) }
}

/**
 * 图片列里那串 data URI 不进网址框 —— 它是选文件的结果,几千个字符塞进输入框
 * 既没法读也没法改。网址框只在值是**在线地址**时显示它。
 */
function imageUrlOf(column: DataColumn): string {
  const value = textOf(column)
  return value.startsWith("data:") ? "" : value
}

/** 粘贴在线封面地址。歌单的封面大多在别人服务器上,只能选本地文件等于半个功能。 */
function onImageUrl(column: DataColumn, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  const url = target.value.trim()
  draft.value = { ...draft.value, [column.id]: url === "" ? null : url }
}

function clearImage(column: DataColumn): void {
  draft.value = { ...draft.value, [column.id]: null }
}

/** 一处都没填 —— 唯一拦下确认的情形。`checkbox` 的 `false` 不算填过。 */
const hasInput = computed(() =>
  props.columns.some((column) => {
    const value = valueOf(column)
    if (typeof value === "string") return value.trim() !== ""
    if (typeof value === "number") return true
    return value === true
  }),
)

function submit(): void {
  if (!hasInput.value) return
  emit("submit", { ...draft.value })
}
</script>

<template>
  <AlertDialog :open="props.open" @update:open="emit('close')">
    <AlertDialogContent class="max-w-md">
      <AlertDialogHeader>
        <AlertDialogTitle class="text-[14px]">添加歌曲</AlertDialogTitle>
        <AlertDialogDescription class="text-[12px]">
          字段跟这张表的列走 —— 只填想填的，其余留空。
        </AlertDialogDescription>
      </AlertDialogHeader>

      <div class="max-h-[52vh] space-y-2.5 overflow-y-auto pr-1">
        <div v-for="column in props.columns" :key="column.id">
          <label class="mb-1 block text-[11px] text-muted-foreground">{{ column.name }}</label>

          <Input
            v-if="column.type === 'text' || column.type === 'number' || column.type === 'date'"
            :type="column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : 'text'"
            class="h-8 text-[13px]"
            :model-value="textOf(column)"
            @input="onText(column, $event)"
          />

          <label v-else-if="column.type === 'checkbox'" class="flex cursor-pointer items-center gap-2 text-[13px]">
            <input type="checkbox" class="size-3.5 accent-brand" :checked="boolOf(column)" @change="onToggle(column, $event)">
            <span class="text-muted-foreground">勾选</span>
          </label>

          <select
            v-else-if="column.type === 'select'"
            class="h-8 w-full cursor-pointer rounded-md border border-line bg-transparent px-2 text-[13px] outline-none"
            :value="textOf(column)"
            @change="onSelect(column, $event)"
          >
            <option value="">（空）</option>
            <option v-for="option in column.options" :key="option.id" :value="option.id">{{ option.name }}</option>
          </select>

          <!-- 图片列。放在 v-else 收尾:六种列类型里前面已分派掉五种,剩下的就是它。 -->
          <div v-else class="space-y-1.5">
            <div class="flex items-center gap-2">
              <div class="size-10 shrink-0 overflow-hidden rounded-md border border-line bg-muted/40">
                <img
                  v-if="imagePreviewOf(column)"
                  :src="imagePreviewOf(column)"
                  alt=""
                  class="size-full object-cover"
                  @error="markImageBroken(textOf(column))"
                />
                <div v-else class="flex size-full items-center justify-center text-muted-foreground">
                  <ImageIcon class="size-4" />
                </div>
              </div>
              <label class="cursor-pointer rounded-md border border-line px-2 py-1 text-[12px] text-muted-foreground hover:text-foreground">
                选择图片
                <input type="file" accept="image/*" class="hidden" @change="onPickImage(column, $event)">
              </label>
              <Button
                v-if="textOf(column)"
                variant="ghost"
                size="icon-sm"
                class="size-6 text-muted-foreground"
                aria-label="清除图片"
                @click="clearImage(column)"
              >
                <XIcon class="size-3.5" />
              </Button>
            </div>
            <Input
              type="url"
              class="h-8 text-[12px]"
              placeholder="或粘贴图片链接 https://…"
              :model-value="imageUrlOf(column)"
              @input="onImageUrl(column, $event)"
            />
          </div>
        </div>
      </div>

      <AlertDialogFooter>
        <AlertDialogCancel as-child>
          <Button variant="ghost" size="sm" class="text-[13px]">取消</Button>
        </AlertDialogCancel>
        <Button size="sm" class="text-[13px]" :disabled="!hasInput" @click="submit">添加</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
