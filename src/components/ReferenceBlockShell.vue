<script setup lang="ts">
import type { TableLoadState } from "@/composables/useTables"
import { computed, ref } from "vue"
import { DatabaseIcon } from "@lucide/vue"
import { Button } from "@/components/ui/button"
import TableRefNotice from "@/components/TableRefNotice.vue"
import { useWorkspace } from "@/composables/useWorkspace"
import { TOOL_PILL } from "@/components/settings-menu"

/**
 * 引用块的外壳:三段提示态(空指针 / 读不到 / 读取中),以及读完之后的悬停工具条
 * (打开数据表 + 各类型自己的设置菜单)。
 *
 * 取数**不在**这一层:`columns` / `rows` / `change` 是各视图算自己那份展示时就要用的,
 * 从槽位参数递回去只会让它们先等一次渲染。所以这里只吃一个 `state`,只管「画什么壳」;
 * 数据仍由各视图的 `useTableEntry` 提供 —— 同一路径取到的本来就是同一个条目。
 *
 * 画册 / 书签 / 看板 / 账目 / 订阅五块的壳完全同形,收在这一处。另外三块各有各的形状,
 * 不硬套:数据表块的工具条挂在表的下沿(加行 / 加列贴着表走),歌单块的三段态在标签条
 * **下面**(切到一张读不到的表也要能切回去),指标块的空指针自己画一张。
 */
const props = defineProps<{
  /** 块的 id:重新指向数据表时用它定位。 */
  blockId: string
  /** 块指向的表路径。 */
  path: string
  /** 块的显示名,进三段态的文案。 */
  label: string
  /** 取数状态,来自视图的 `useTableEntry`。 */
  state: TableLoadState
  /**
   * 工具条按钮加一层浅阴影。书签块的入口浮在卡片底色上,需要这一点把浮岛托起来 ——
   * 其余几块底下是正文,不加。这是既有观感,不是新开关。
   */
  lifted?: boolean
}>()

const buttonClass = computed(() => (props.lifted === true ? `${TOOL_PILL} shadow-sm` : TOOL_PILL))

const { openFile, rebindTable, tablePaths } = useWorkspace()

/** 外壳的根元素。书签块把它交给 `ResizeObserver` 量截断。 */
const root = ref<HTMLElement | null>(null)

defineExpose({ root })

/** 打开数据表本身:切到它的标签页。引用块的「深潜」入口。 */
function openTable(): void {
  if (props.path === "") return
  // 走工作区的打开入口 —— 标签、按需读都由它统一管。
  openFile(props.path)
}
</script>

<template>
  <!-- 空指针(转换流程修好前的遗留块 / 手工编辑):如实说没指定,而不是永远转圈。 -->
  <TableRefNotice v-if="path === ''" kind="unset" :label="label" />

  <!-- 引用的文件读不到:提示态,不是错误态 —— 提示条自带一条重新指向的出路。 -->
  <TableRefNotice
    v-else-if="state === 'missing' || state === 'failed'"
    kind="missing"
    :label="label"
    :path="path"
    :tables="tablePaths"
    @reselect="(next: string) => rebindTable(blockId, next)"
  />

  <!-- 还没读完。 -->
  <TableRefNotice v-else-if="state === 'locked'" kind="locked" :label="label" />

  <TableRefNotice v-else-if="state !== 'loaded'" kind="loading" :label="label" />

  <div v-else ref="root" class="group/ref relative my-4">
    <!-- 块操作入口:右上角,悬停浮现。z-20 压过块内容的浮层,否则右侧内容会盖住它。 -->
    <div
      class="absolute -top-2 right-0 z-20 flex items-center gap-1 opacity-0 transition-opacity group-hover/ref:opacity-100 focus-within:opacity-100"
    >
      <Button variant="ghost" size="sm" :class="buttonClass" @click="openTable">
        <DatabaseIcon class="size-3" />打开数据表
      </Button>
      <slot name="actions" />
    </div>

    <slot />
  </div>
</template>
