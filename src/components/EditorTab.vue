<script setup lang="ts">
import type { OpenTab } from "@/types/workspace"
import { computed } from "vue"
import { LoaderCircleIcon, SaveIcon, XIcon } from "@lucide/vue"
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu"
import { isMarkdownFile, isTableFile } from "@/lib/fs/policy"
import { usePressHold } from "@/composables/usePressHold"
import { fileName } from "@/lib/paths"
import { LONG_PRESS_MS } from "@/lib/touch"
import { cn } from "@/lib/utils"
import FileMenuItems from "./FileMenuItems.vue"

const props = defineProps<{
  tab: OpenTab
  active: boolean
  /**
   * 这个标签有未落盘的东西 —— 正文改动，或它引用的数据表改动。
   *
   * 由标签条算好递进来：表的脏态在注册表里，「这篇引用了哪几张表」只有工作区知道。
   */
  unsaved: boolean
  /** 正在写盘。图标换成转圈 —— 慢盘上「点了」与「存好了」必须是两件事。 */
  saving: boolean
}>()

const emit = defineEmits<{
  (event: "activate", path: string): void
  (event: "close", path: string): void
  (event: "save", path: string): void
}>()

const label = computed(() => fileName(props.tab.path))

/** 按住不放的底色。理由与时长见 `usePressHold` 与 `lib/touch`。 */
const { pressed, down: pressDown, move: pressMove, release: pressRelease } = usePressHold()

/**
 * 标签右键给的是**文件树里那一行**的菜单（ADR-0046）：同一条路径、同一批动作。
 * kind 由名字判 —— 标签只存路径，这里按 `lib/fs/policy` 的同一套后缀口径反推。
 */
const kind = computed(() => {
  const name = props.tab.path
  if (isTableFile(name)) return "table"
  if (isMarkdownFile(name)) return "markdown"
  return "note"
})
</script>

<template>
  <ContextMenu :press-open-delay="LONG_PRESS_MS">
    <ContextMenuTrigger as-child>
      <button
        type="button"
        :class="cn(
          // 胶囊（28px 高 → 14px，正好是 `--radius-island`）：标签住在 18px 圆角的卡片里，
          // 9px 和 18px 两颗圆弧挨在一起像在互相较劲；胶囊的曲率不跟任何相邻圆角比大小。
          // 按住那半秒的蓄力与树行同一套：`data-[pressed]:duration-500` 把底色推到
          // `muted-strong`，和 reka 的 `pressOpenDelay`（`LONG_PRESS_MS`）同点。激活的标签
          // 本来就是选中底色，只压暗一点 —— 换成灰底会像是「选中丢了」。
          'group/tab flex h-7 max-w-[14.375rem] shrink-0 items-center gap-1.5 rounded-full pr-2 pl-3 text-xs transition-colors duration-100 data-[pressed]:duration-500',
          active
            ? 'bg-selection font-medium text-selection-foreground data-[pressed]:bg-selection/90'
            : 'text-muted-foreground hover:bg-muted data-[pressed]:bg-muted-strong data-[state=open]:bg-muted-strong',
        )"
        :data-pressed="pressed ? 'true' : undefined"
        @click="emit('activate', tab.path)"
        @pointerdown="pressDown"
        @pointermove="pressMove"
        @pointerup="pressRelease"
        @pointercancel="pressRelease"
      >
        <span class="min-w-0 truncate">{{ label }}</span>

        <!-- 未保存态分两种：激活的用保存图标按钮（本身就是「点这里存」的入口），非激活的用小圆点。
             写盘在途时同一颗位置换成转圈，位置不动 —— 否则图标会跳一下。 -->
        <span
          v-if="props.unsaved && active"
          class="flex size-4 shrink-0 items-center justify-center rounded-[4px] text-dirty hover:text-foreground"
          :aria-label="saving ? '保存中' : '保存'"
          :aria-busy="saving"
          @click.stop="emit('save', tab.path)"
        >
          <LoaderCircleIcon v-if="saving" class="size-3 animate-spin" />
          <SaveIcon v-else class="size-3" />
        </span>
        <span
          v-if="props.unsaved"
          :class="cn('size-1.5 shrink-0 rounded-full bg-dirty', active ? 'hidden' : 'inline-block')"
        />

        <span
          class="flex size-4 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground opacity-0 group-hover/tab:opacity-100 hover:text-foreground"
          @click.stop="emit('close', tab.path)"
        >
          <XIcon class="size-3" />
        </span>
      </button>
    </ContextMenuTrigger>
    <ContextMenuContent>
      <!-- `from-tab`：同一条文件菜单，另外多出「关闭其他 / 左侧 / 右侧」三条 —— 左右邻居
           只有标签条知道，树上那一行没有。 -->
      <FileMenuItems :path="tab.path" :kind="kind" :name="label" surface="context" from-tab />
    </ContextMenuContent>
  </ContextMenu>
</template>
