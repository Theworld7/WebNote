<script setup lang="ts">
import type { CreateTarget } from "@/types/workspace"
import { nextTick, ref, watch } from "vue"
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useWorkspace } from "@/composables/useWorkspace"

/**
 * 新建命名对话框。
 *
 * 名字一次性问清、确认后才碰磁盘 —— 行内输入需要往树里塞一个与 `FileNode` 平行的
 * 临时节点，是这份代码里最大的复杂度增量，而这里两条路径都不必碰树。
 *
 * 失败**不关闭**：冲突与非法名字都只在盘上检查得出来（`exists`），关掉对话框等于让
 * 用户重开一次、重新输一遍。
 */
const props = defineProps<{
  /** 待新建项的目标。null 表示对话框关着。 */
  target: CreateTarget | null
}>()

const emit = defineEmits<{ close: [] }>()

const { createNoteIn, createFolderIn } = useWorkspace()

const name = ref("")
const input = ref<InstanceType<typeof Input> | null>(null)

const isFolder = () => props.target?.kind === "folder"

watch(
  () => props.target,
  async (target) => {
    if (target === null) return
    name.value = ""
    await nextTick()
    input.value?.$el?.focus()
  },
)

/** 确认。成功才关 —— 失败时 `createInto` 已经把原因写进 `fsError`，对话框留着让人改。 */
async function confirm() {
  const target = props.target
  if (target === null) return
  const ok = target.kind === "folder"
    ? await createFolderIn(target.parentPath, name.value)
    : await createNoteIn(target.parentPath, name.value)
  if (ok) emit("close")
}
</script>

<template>
  <AlertDialog :open="target !== null" @update:open="emit('close')">
    <AlertDialogContent class="max-w-sm" @open-auto-focus.prevent>
      <AlertDialogHeader>
        <AlertDialogTitle class="text-[14px]">
          {{ isFolder() ? "新建文件夹" : "新建笔记" }}
        </AlertDialogTitle>
        <AlertDialogDescription class="text-[12px]">
          {{ target?.parentPath === "" ? "位置：工作区根目录" : `位置：${target?.parentPath}` }}
        </AlertDialogDescription>
      </AlertDialogHeader>

      <Input
        ref="input"
        v-model="name"
        :placeholder="isFolder() ? '文件夹名' : '笔记名（不必写 .html）'"
        class="h-8 text-[13px]"
        @keydown.enter.prevent="confirm"
      />

      <AlertDialogFooter>
        <AlertDialogCancel as-child>
          <Button variant="ghost" size="sm" class="text-[13px]">取消</Button>
        </AlertDialogCancel>
        <Button size="sm" class="text-[13px]" @click="confirm">创建</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
