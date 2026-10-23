<script setup lang="ts">
import type { OpenTab } from "@/types/workspace"
import { computed } from "vue"
import { LoaderCircleIcon, SaveIcon, XIcon } from "@lucide/vue"
import { fileName } from "@/lib/paths"
import { cn } from "@/lib/utils"

const props = defineProps<{
  tab: OpenTab
  active: boolean
  /** 正在写盘。图标换成转圈 —— 慢盘上「点了」与「存好了」必须是两件事。 */
  saving: boolean
}>()

const emit = defineEmits<{
  (event: "activate", path: string): void
  (event: "close", path: string): void
  (event: "save", path: string): void
}>()

const label = computed(() => fileName(props.tab.path))
</script>

<template>
  <button
    type="button"
    :class="cn(
      'group/tab flex h-7 max-w-[230px] shrink-0 items-center gap-1.5 rounded-[9px] pr-2 pl-3 text-xs transition-colors',
      active
        ? 'bg-selection font-medium text-selection-foreground'
        : 'text-muted-foreground hover:bg-muted',
    )"
    @click="emit('activate', tab.path)"
  >
    <span class="min-w-0 truncate">{{ label }}</span>

    <!-- 未保存态分两种：激活的用保存图标按钮（本身就是「点这里存」的入口），非激活的用小圆点。
         写盘在途时同一颗位置换成转圈，位置不动 —— 否则图标会跳一下。 -->
    <span
      v-if="tab.dirty && active"
      class="flex size-4 shrink-0 items-center justify-center rounded-[4px] text-dirty hover:text-foreground"
      :aria-label="saving ? '保存中' : '保存'"
      :aria-busy="saving"
      @click.stop="emit('save', tab.path)"
    >
      <LoaderCircleIcon v-if="saving" class="size-3 animate-spin" />
      <SaveIcon v-else class="size-3" />
    </span>
    <span
      v-if="tab.dirty"
      :class="cn('size-1.5 shrink-0 rounded-full bg-dirty', active ? 'hidden' : 'inline-block')"
    />

    <span
      class="flex size-4 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground opacity-0 group-hover/tab:opacity-100 hover:text-foreground"
      @click.stop="emit('close', tab.path)"
    >
      <XIcon class="size-3" />
    </span>
  </button>
</template>
