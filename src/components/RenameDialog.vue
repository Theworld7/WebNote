<script setup lang="ts">
import type { TreeTarget } from "@/types/workspace"
import { computed, nextTick, ref, watch } from "vue"
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useWorkspace } from "@/composables/useWorkspace"
import { fileStem } from "@/lib/fs/policy"
import { fileName } from "@/lib/paths"

/**
 * 重命名对话框。
 *
 * 与 `CreateDialog` 同一套约定：名字在框里问清、确认后才碰磁盘，失败不关闭 ——
 * 冲突与非法名字都只在盘上检查得出来，关掉等于让用户重新输一遍。
 *
 * 预填**名字主干**而不是完整文件名：用户改的是名字，后缀由确认时按新建的同一条
 * 规则补 —— 输入框里出现 `日记.html` 会诱导人把后缀当名字的一部分去改。
 */
const props = defineProps<{
  /** 待重命名的目标。null 表示对话框关着。 */
  target: TreeTarget | null
}>()

const emit = defineEmits<{ close: [] }>()

const { renameFile } = useWorkspace()

const name = ref("")
const input = ref<InstanceType<typeof Input> | null>(null)

const placeholder = computed(() => {
  const kind = props.target?.kind
  if (kind === "folder") return "文件夹名"
  if (kind === "table") return "数据表名（不必写 .tbl）"
  return "笔记名（不必写 .html）"
})

watch(
  () => props.target,
  async (target) => {
    if (target === null) return
    // 文件夹名原样预填；文件取主干 —— 与新建的补后缀规则互为逆操作。
    name.value = target.kind === "folder" ? fileName(target.path) : fileStem(fileName(target.path))
    await nextTick()
    input.value?.$el?.focus()
  },
)

/** 确认。成功才关 —— 失败时 `renameFile` 已经把原因写进 `fsError`，对话框留着让人改。 */
async function confirm() {
  const target = props.target
  if (target === null) return
  const ok = await renameFile(target.path, name.value, target.kind)
  if (ok) emit("close")
}
</script>

<template>
  <AlertDialog :open="target !== null" @update:open="emit('close')">
    <AlertDialogContent class="max-w-sm" @open-auto-focus.prevent>
      <AlertDialogHeader>
        <AlertDialogTitle class="text-[14px]">重命名</AlertDialogTitle>
        <AlertDialogDescription class="text-[12px]">
          {{ target === null ? "" : `原名：${fileName(target.path)}` }}
        </AlertDialogDescription>
      </AlertDialogHeader>

      <Input
        ref="input"
        v-model="name"
        :placeholder="placeholder"
        class="h-8 text-[13px]"
        @keydown.enter.prevent="confirm"
      />

      <AlertDialogFooter>
        <AlertDialogCancel as-child>
          <Button variant="ghost" size="sm" class="text-[13px]">取消</Button>
        </AlertDialogCancel>
        <Button size="sm" class="text-[13px]" @click="confirm">重命名</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
