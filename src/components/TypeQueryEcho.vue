<script setup lang="ts">
import { SearchIcon } from "@lucide/vue"

/**
 * 类型菜单顶部的检索回显行。
 *
 * 类型菜单是纯键盘筛的 —— 菜单里没有 input，敲进去的字母只体现在清单变短上，
 * 退格删到第几个全凭记忆。这一行把检索词原样摆出来：敲什么看到什么，
 * 空词时留一句提示，顺手把「这里能敲拼音首字母」这件事说清楚。
 */
defineProps<{
  /** 拼音首字母检索词。空串 = 还没敲，显示提示语。 */
  query: string
}>()
</script>

<template>
  <div
    data-type-query="true"
    class="mb-1 flex select-none items-center gap-1.5 rounded-[7px] bg-muted px-2 py-1 text-[11.5px]"
  >
    <SearchIcon class="size-3 shrink-0 text-muted-foreground" />
    <span v-if="query === ''" class="truncate text-muted-foreground">拼音首字母筛选</span>
    <template v-else>
      <!-- 光标紧跟检索词：光标贴到行尾会让人以为词后还有没显示的内容。 -->
      <span class="truncate font-mono tracking-wider text-foreground">{{ query }}</span>
      <span class="h-3 w-[2px] shrink-0 animate-pulse rounded-full bg-foreground/70" />
    </template>
  </div>
</template>
