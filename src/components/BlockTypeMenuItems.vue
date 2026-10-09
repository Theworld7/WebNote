<script setup lang="ts">
import type { BlockType } from "@/types/workspace"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { BLOCK_TYPES } from "@/lib/blocks"

/**
 * 块类型列表项。插入菜单与「转为…」子菜单共用，避免两处各写一遍类型表。
 * DropdownMenuItem 靠 inject 找 root，放在子组件里不影响菜单行为。
 */
const emit = defineEmits<{ (event: "pick", type: BlockType): void }>()
</script>

<template>
  <DropdownMenuItem
    v-for="meta in BLOCK_TYPES"
    :key="meta.type"
    class="gap-2.5 rounded-[7px] px-2 py-1"
    @select="emit('pick', meta.type)"
  >
    <span class="w-5.5 shrink-0 text-center font-mono text-[11.5px] text-muted-foreground">
      {{ meta.marker }}
    </span>
    <span class="min-w-0 flex-1 truncate">{{ meta.label }}</span>
  </DropdownMenuItem>
</template>
