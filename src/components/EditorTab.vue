<script setup lang="ts">
import type { OpenTab } from "@/types/workspace"
import { computed } from "vue"
import { XIcon } from "@lucide/vue"
import { fileName } from "@/lib/paths"
import { cn } from "@/lib/utils"

const props = defineProps<{
  tab: OpenTab
  active: boolean
}>()

const emit = defineEmits<{
  (event: "activate", path: string): void
  (event: "close", path: string): void
}>()

const label = computed(() => fileName(props.tab.path))
</script>

<template>
  <button
    type="button"
    :class="cn(
      'group/tab flex h-7 max-w-[230px] items-center gap-1.5 rounded-[9px] pr-2 pl-3 transition-colors',
      active
        ? 'bg-selection font-medium text-selection-foreground'
        : 'text-muted-foreground hover:bg-muted',
    )"
    @click="emit('activate', tab.path)"
  >
    <span class="min-w-0 truncate">{{ label }}</span>

    <!-- 未保存态按原型分两种：激活的用文字 tag，非激活的用小圆点，两者常驻 DOM 靠显示切换。 -->
    <span
      v-if="tab.dirty"
      :class="cn(
        'shrink-0 rounded-full bg-dirty-soft px-[7px] py-px text-[11px] leading-[1.5] font-medium whitespace-nowrap text-dirty',
        active ? 'inline-block' : 'hidden',
      )"
    >未保存</span>
    <span
      v-if="tab.dirty"
      :class="cn('size-1.5 shrink-0 rounded-full bg-dirty', active ? 'hidden' : 'inline-block')"
    />

    <span
      class="flex size-4 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground opacity-0 group-hover/tab:opacity-100 hover:text-foreground"
      @click.stop="emit('close', tab.path)"
    >
      <XIcon class="size-[13px]" />
    </span>
  </button>
</template>
