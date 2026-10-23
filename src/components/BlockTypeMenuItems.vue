<script setup lang="ts">
import type { BlockType, BlockTypeMeta } from "@/types/workspace"
import { computed } from "vue"
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { blockTypeOptions } from "@/lib/blocks"
import { useSettings } from "@/composables/useSettings"

/**
 * 块类型列表项。插入菜单与「转为…」子菜单共用，避免两处各写一遍类型表。
 * DropdownMenuItem 靠 inject 找 root，放在子组件里不影响菜单行为。
 *
 * 条目按登记表的 `group` 字段分组，组与组之间渲染小标题。排布方向由
 * 「块菜单」设置驱动：纵向是组竖叠（现状），横向是组并排成一列列。
 * `exclude` 供特定语境滤类型：布局格子内滤掉容器块与引用块（ADR-0007）。
 * `query` 是键盘敲进来的检索词（拼音首字母），筛完仍按登记表顺序分组。
 */
const props = defineProps<{
  /** 要从菜单里隐去的块类型。缺省全显。 */
  exclude?: readonly BlockType[]
  /** 拼音首字母检索词。缺省空 = 全显。 */
  query?: string
}>()

const emit = defineEmits<{ (event: "pick", type: BlockType): void }>()

const { menuGroupLayout } = useSettings()

/**
 * 把筛完的登记表切成连续的段：同名组在登记表里相邻（编译期不查这个，
 * 但条目按族写在一起是登记表的既定秩序），遇到新组名即起新段。
 * 滤空的组自然消失 —— 整组被 exclude 或检索词滤掉时不留孤儿小标题。
 */
const groups = computed(() => {
  const sections: { title: string; items: BlockTypeMeta[] }[] = []
  for (const meta of blockTypeOptions(props.query ?? "", props.exclude)) {
    const last = sections[sections.length - 1]
    if (last !== undefined && last.title === meta.group) last.items.push(meta)
    else sections.push({ title: meta.group, items: [meta] })
  }
  return sections
})

/** 检索词筛空了：给一行提示，别让菜单只剩个空盒子（用户可以退格改词）。 */
const empty = computed(() => groups.value.length === 0)
</script>

<template>
  <!-- 纵向：组竖叠，组间用分隔线。 -->
  <template v-if="menuGroupLayout === 'vertical'">
    <template v-for="(section, index) in groups" :key="section.title">
      <DropdownMenuSeparator v-if="index > 0" class="mx-2 my-1 bg-line" />
      <DropdownMenuLabel class="px-2 pb-1 pt-1.5 text-[11px] font-normal text-muted-foreground">
        {{ section.title }}
      </DropdownMenuLabel>
      <DropdownMenuItem
        v-for="meta in section.items"
        :key="meta.type"
        class="gap-2.5 rounded-[7px] px-2 py-1"
        data-type-option="true"
        @select="emit('pick', meta.type)"
      >
        <span class="w-5.5 shrink-0 text-center font-mono text-[12px] text-muted-foreground">
          {{ meta.marker }}
        </span>
        <span class="min-w-0 flex-1 truncate">{{ meta.label }}</span>
      </DropdownMenuItem>
    </template>
    <!-- 检索词筛空：菜单不能只剩个空盒子，给一句话，用户可以退格改词。 -->
    <DropdownMenuLabel v-if="empty" class="px-2 py-1.5 text-[11px] font-normal text-muted-foreground">
      没有匹配的块类型
    </DropdownMenuLabel>
  </template>

  <!-- 横向：组并排，每组一列（标题在列顶、条目竖排在列内），菜单宽度交给内容撑。 -->
  <div v-else class="flex items-start gap-x-3">
    <div v-for="section in groups" :key="section.title" class="flex min-w-[104px] flex-col">
      <DropdownMenuLabel class="px-2 pb-1 pt-1.5 text-[11px] font-normal text-muted-foreground">
        {{ section.title }}
      </DropdownMenuLabel>
      <DropdownMenuItem
        v-for="meta in section.items"
        :key="meta.type"
        class="gap-2.5 rounded-[7px] px-2 py-1"
        data-type-option="true"
        @select="emit('pick', meta.type)"
      >
        <span class="w-5.5 shrink-0 text-center font-mono text-[12px] text-muted-foreground">
          {{ meta.marker }}
        </span>
        <span class="min-w-0 flex-1 truncate">{{ meta.label }}</span>
      </DropdownMenuItem>
    </div>
    <!-- 横向同样是「筛空了就说一句」：这里没有分组列可挂，提示自成一段。 -->
    <DropdownMenuLabel v-if="empty" class="px-2 py-1.5 text-[11px] font-normal text-muted-foreground">
      没有匹配的块类型
    </DropdownMenuLabel>
  </div>
</template>
