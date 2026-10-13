<script setup lang="ts">
import type { BlockType } from "@/types/workspace"
import { computed } from "vue"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { BLOCK_TYPES } from "@/lib/blocks"

/**
 * 块类型列表项。插入菜单与「转为…」子菜单共用，避免两处各写一遍类型表。
 * DropdownMenuItem 靠 inject 找 root，放在子组件里不影响菜单行为。
 *
 * `exclude` 供特定语境滤类型：布局格子内滤掉容器块与引用块（ADR-0007）。
 */
const props = defineProps<{
  /** 要从菜单里隐去的块类型。缺省全显。 */
  exclude?: readonly BlockType[]
}>()

const emit = defineEmits<{ (event: "pick", type: BlockType): void }>()

const items = computed(() => BLOCK_TYPES.filter((meta) => props.exclude?.includes(meta.type) !== true))
</script>

<template>
  <DropdownMenuItem
    v-for="meta in items"
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
