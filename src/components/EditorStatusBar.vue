<script setup lang="ts">
import { useWorkspace } from "@/composables/useWorkspace"

const { crumbs, charCount } = useWorkspace()
</script>

<!-- 面包屑取代了原先的格式标签（HTML），落在左下角；字数紧随其后，右侧留白。 -->
<template>
  <div class="flex h-8 flex-none items-center gap-3.5 px-[22px] text-[11px] text-muted-foreground">
    <span class="flex min-w-0 items-center gap-1.5 overflow-hidden">
      <template v-for="(crumb, index) in crumbs" :key="`${crumb.name}-${index}`">
        <span class="truncate" :class="crumb.isFile && 'text-foreground'">{{ crumb.name }}</span>
        <span v-if="!crumb.isFile" class="flex-none text-muted-foreground/45">/</span>
      </template>
    </span>
    <span class="flex-none">{{ charCount }} 字</span>
  </div>
</template>
