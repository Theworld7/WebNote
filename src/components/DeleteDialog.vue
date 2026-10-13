<script setup lang="ts">
import type { TreeTarget } from "@/types/workspace"
import { computed } from "vue"
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { useWorkspace } from "@/composables/useWorkspace"
import { fileName, isUnder } from "@/lib/paths"

/**
 * 删除确认框。
 *
 * 删除是不可逆的盘上操作，且没有回收站 —— 确认框是唯一的拦截点。两类追加说明：
 * 文件夹要说「连同全部内容」；受影响的打开标签里有脏的，要说未保存的修改会一并丢弃。
 * 有未落盘改动的**数据表**不在这里警告 —— 那种情况 `deleteFile` 会直接拒绝（改动若
 * 放行，之后任何一次保存都可能把删掉的文件写回来）。
 */
const props = defineProps<{
  /** 待删除的目标。null 表示对话框关着。 */
  target: TreeTarget | null
}>()

const emit = defineEmits<{ close: [] }>()

const { tabs, deleteFile } = useWorkspace()

const isFolder = computed(() => props.target?.kind === "folder")

/** 目标（或其之下）有没有开着且未保存的标签 —— 有就必须先说清楚。 */
const hasDirtyTabs = computed(() => {
  const target = props.target
  if (target === null) return false
  return tabs.value.some((tab) => tab.dirty && isUnder(tab.path, target.path))
})

async function confirm() {
  const target = props.target
  if (target === null) return
  const ok = await deleteFile(target.path)
  if (ok) emit("close")
}
</script>

<template>
  <AlertDialog :open="target !== null" @update:open="emit('close')">
    <AlertDialogContent class="max-w-sm">
      <AlertDialogHeader>
        <AlertDialogTitle class="text-[14px]">
          {{ target === null ? "删除" : `删除「${fileName(target.path)}」` }}
        </AlertDialogTitle>
        <AlertDialogDescription class="text-[12px]">
          {{ isFolder ? "文件夹及其全部内容将从磁盘删除，此操作不可恢复。" : "文件将从磁盘删除，此操作不可恢复。" }}
          <span v-if="hasDirtyTabs">其中打开的标签有未保存的修改，将一并丢弃。</span>
        </AlertDialogDescription>
      </AlertDialogHeader>

      <AlertDialogFooter>
        <AlertDialogCancel as-child>
          <Button variant="ghost" size="sm" class="text-[13px]">取消</Button>
        </AlertDialogCancel>
        <!-- 不用 `AlertDialogAction`：它点击即关闭对话框，`target` 随之清空，
             `confirm` 再读就什么都没有了。删除失败（脏数据表被拦）时要让用户重试。 -->
        <Button variant="destructive" size="sm" class="text-[13px]" @click="confirm">删除</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
