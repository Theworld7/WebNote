<script setup lang="ts">
import type { BlockType, LayoutBlock } from "@/types/workspace"
import { computed } from "vue"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ChevronDownIcon, MinusIcon, PlusIcon } from "@lucide/vue"
import { useWorkspace } from "@/composables/useWorkspace"
import { LAYOUT_COLUMNS, orderedIndexes as orderedIndexesOf } from "@/lib/blocks"
import { focusBlockById } from "@/lib/dom"
import BlockItem from "@/components/BlockItem.vue"

/**
 * 布局块视图（ADR-0007）：笔记里唯一的容器块。
 *
 * `cells` 为空 = 刚插入、还没选布局方式 —— 显示网格/弹性选择器（与空表格先挑尺寸
 * 同一套交互）。选完铺两个格子；之后格子里的块就是普通的 `BlockItem`，增删改与
 * 顶层共用同一套操作（`useWorkspace` 按 id 定位到格子里的块列表）。
 *
 * 格子内不支持拖拽排序（+/- 格子与回车增删够用），块手柄在这里只承担菜单。
 */
const props = defineProps<{ block: LayoutBlock }>()

const { setLayoutMode, setLayoutColumns, addLayoutCell, removeLayoutCell, insertBlockAfter, changeBlockType, duplicateBlock, removeBlock } =
  useWorkspace()

const isGrid = computed(() => props.block.mode === "grid")

/** 网格列数 → inline style。flex 不认列数，style 传 undefined 让容器走 flex 类。 */
const gridStyle = computed(() =>
  isGrid.value ? { gridTemplateColumns: `repeat(${props.block.columns ?? 2}, minmax(0, 1fr))` } : undefined,
)

/** 菜单外框，与块手柄菜单同一套参数。 */
const MENU = "w-[148px] rounded-island p-1.5 shadow-pop ring-0"
const TOOL_BUTTON =
  "h-6 gap-1 rounded-full px-2 text-[12px] text-muted-foreground hover:text-foreground"

/** 格子内回车新增块。菜单已在格子内滤掉引用块/容器块，落到这里的都是普通类型。 */
function onInsertAfter(id: string, type: BlockType) {
  void focusBlockById(insertBlockAfter(id, type))
}

/** 格子内「转换为」。目标类型同样已被菜单滤过；changeBlockType 里还有一层容器守卫。 */
function onRetype(id: string, type: BlockType) {
  changeBlockType(id, type)
  void focusBlockById(id)
}

/**
 * 格子内删块。先记下删除后该聚焦谁：同格子的前一块；是首块则落到后一块
 * （删完顶上来）—— 与顶层 handleRemove 的「交给前一个块」同一立场。
 */
function onRemove(id: string) {
  let focus: string | null = null
  for (const cell of props.block.cells) {
    const index = cell.findIndex((item) => item.id === id)
    if (index === -1) continue
    const prev = cell[index - 1]
    const next = cell[index + 1]
    focus = prev !== undefined ? prev.id : (next?.id ?? null)
    break
  }
  removeBlock(id)
  if (focus !== null) void focusBlockById(focus)
}

/** 模式值从菜单回来是 string，收窄成 LayoutMode 再交操作层。 */
function pickMode(value: string) {
  if (value === "grid" || value === "flex") setLayoutMode(props.block.id, value)
}
</script>

<template>
  <!-- 未选布局方式：先挑形态。与空表格「先挑尺寸」同一套交互。 -->
  <div v-if="block.cells.length === 0" class="my-1 rounded-lg bg-muted p-3">
    <div class="mb-2 text-[11px] text-muted-foreground">选择布局方式</div>
    <div class="flex gap-2">
      <Button
        variant="outline"
        class="h-auto flex-1 flex-col items-start gap-0.5 p-3"
        @click="setLayoutMode(block.id, 'grid')"
      >
        <span class="text-sm font-medium">网格</span>
        <span class="text-[11px] font-normal text-muted-foreground">按行列均分，规整对齐</span>
      </Button>
      <Button
        variant="outline"
        class="h-auto flex-1 flex-col items-start gap-0.5 p-3"
        @click="setLayoutMode(block.id, 'flex')"
      >
        <span class="text-sm font-medium">弹性</span>
        <span class="text-[11px] font-normal text-muted-foreground">横向排开、自动换行</span>
      </Button>
    </div>
  </div>

  <div v-else class="group/layout relative my-1">
    <div :class="isGrid ? 'grid gap-3' : 'flex flex-wrap gap-3'" :style="gridStyle">
      <section
        v-for="(cell, cellIndex) in block.cells"
        :key="cellIndex"
        class="min-w-0 rounded-lg border border-line px-2.5 py-1.5"
        :class="!isGrid && 'min-w-[8rem] flex-1'"
      >
        <BlockItem
          v-for="child in cell"
          :key="child.id"
          :block="child"
          :ordered-index="orderedIndexesOf(cell).get(child.id) ?? 0"
          :dragging="false"
          drop-edge="none"
          in-cell
          @insert-after="onInsertAfter"
          @retype="onRetype"
          @duplicate="duplicateBlock"
          @remove="onRemove"
        />
      </section>
    </div>

    <!--
      悬浮工具条，三组功能用分隔线隔开：加/删格子｜布局方式｜列数（仅网格）。
      下拉触发器带 ChevronDown，与纯文字的「格子」区分「点了直接生效」和「点了弹菜单」。
    -->
    <div
      class="absolute -bottom-3.5 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full bg-background p-0.5 shadow-island opacity-0 transition-opacity group-hover/layout:opacity-100 focus-within:opacity-100"
    >
      <Button
        variant="ghost"
        size="sm"
        :class="TOOL_BUTTON"
        aria-label="添加格子"
        title="添加格子"
        @click="addLayoutCell(block.id)"
      >
        <PlusIcon class="size-3" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        :class="TOOL_BUTTON"
        :disabled="block.cells.length <= 1"
        aria-label="删除末尾格子"
        title="删除末尾格子"
        @click="removeLayoutCell(block.id)"
      >
        <MinusIcon class="size-3" />
      </Button>

      <span class="mx-0.5 h-4 w-px bg-line" aria-hidden="true" />

      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" size="sm" :class="TOOL_BUTTON">
            {{ isGrid ? "网格" : "弹性" }}
            <ChevronDownIcon class="size-3 text-muted-foreground/70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent :class="MENU" :side-offset="6">
          <DropdownMenuLabel class="px-2 pb-1 pt-1.5 text-[11px] font-normal text-muted-foreground">
            布局方式
          </DropdownMenuLabel>
          <DropdownMenuCheckboxItem
            :checked="isGrid"
            @select="pickMode('grid')"
          >
            网格
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            :checked="!isGrid"
            @select="pickMode('flex')"
          >
            弹性
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu v-if="isGrid">
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" size="sm" :class="TOOL_BUTTON">
            {{ block.columns ?? 2 }} 列
            <ChevronDownIcon class="size-3 text-muted-foreground/70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent :class="MENU" :side-offset="6">
          <DropdownMenuLabel class="px-2 pb-1 pt-1.5 text-[11px] font-normal text-muted-foreground">
            每行列数
          </DropdownMenuLabel>
          <DropdownMenuCheckboxItem
            v-for="count in LAYOUT_COLUMNS"
            :key="count"
            :checked="(block.columns ?? 2) === count"
            @select="setLayoutColumns(block.id, count)"
          >
            {{ count }} 列
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </div>
</template>
