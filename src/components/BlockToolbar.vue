<script setup lang="ts">
import type { BlockMenuKind, BlockType } from "@/types/workspace"
import { GripVerticalIcon, PlusIcon } from "@lucide/vue"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import BlockTypeMenuItems from "./BlockTypeMenuItems.vue"

defineProps<{
  /** 当前打开的是哪个菜单，由父级 BlockItem 持有 —— 因为 `/` 输入也要程序化打开类型菜单。 */
  openMenu: BlockMenuKind
  typeMenuMode: "insert" | "convert"
}>()

const emit = defineEmits<{
  (event: "update:openMenu", value: BlockMenuKind): void
  (event: "insert", type: BlockType): void
  (event: "retype", type: BlockType): void
  (event: "duplicate"): void
  (event: "remove"): void
}>()

/** 手柄按钮：24px 见方，比 shadcn 默认图标按钮更小，靠 class 覆盖 size variant。 */
const TOOL = "size-6 rounded-[5px] p-0 text-muted-foreground hover:text-foreground"

/**
 * 拖拽手柄。
 *
 * `[-webkit-user-drag:element]` 是给 WKWebView（Tauri 在 macOS 上的实际渲染器）兜底的：
 * WebKit 里光有 `draggable="true"` 不足以让 `<button>` 发起原生拖拽，还得声明这个属性。
 */
const GRIP = `${TOOL} cursor-grab active:cursor-grabbing [-webkit-user-drag:element]`

/** 菜单外框：244px 定宽、浮岛圆角、去掉 shadcn 默认的 1px ring，换成原型那套双层阴影。 */
const MENU = "w-[244px] rounded-island p-1.5 shadow-pop ring-0"

const ITEM = "gap-2.5 rounded-[7px] px-2 py-1"

const MARKER = "w-5.5 shrink-0 text-center font-mono text-[11.5px] text-muted-foreground"
</script>

<template>
  <div
    class="absolute left-[-50px] flex gap-0.5 transition-opacity"
    :class="openMenu === '' ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'"
    :style="{ top: 'var(--tools-top, 2px)' }"
  >
    <!-- +：在当前块下方插入。`/` 输入时复用同一个菜单，只是 mode 换成 convert。 -->
    <DropdownMenu
      :open="openMenu === 'type'"
      @update:open="(open: boolean) => emit('update:openMenu', open ? 'type' : '')"
    >
      <DropdownMenuTrigger as-child>
        <Button variant="ghost" :class="TOOL" aria-label="添加块">
          <PlusIcon class="size-[15px]" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent :class="MENU" :side-offset="6">
        <DropdownMenuLabel class="px-2 pb-1 pt-1.5 text-[11px] font-normal text-muted-foreground">
          {{ typeMenuMode === "insert" ? "在当前块下方插入" : "转换为" }}
        </DropdownMenuLabel>
        <BlockTypeMenuItems
          @pick="(type: BlockType) => (typeMenuMode === 'insert' ? emit('insert', type) : emit('retype', type))"
        />
      </DropdownMenuContent>
    </DropdownMenu>

    <!-- ⋮⋮：点击开块操作菜单，按住拖动则是排序手柄。
         拖拽由 BlockEditor 在容器上统一接管（dragstart 会冒泡），这里只负责让元素可拖。 -->
    <DropdownMenu
      :open="openMenu === 'action'"
      @update:open="(open: boolean) => emit('update:openMenu', open ? 'action' : '')"
    >
      <DropdownMenuTrigger as-child>
        <Button
          variant="ghost"
          :class="GRIP"
          draggable="true"
          data-drag-handle="true"
          aria-label="块操作菜单，拖动可重排"
        >
          <GripVerticalIcon class="size-[15px]" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent :class="MENU" :side-offset="6">
        <DropdownMenuItem :class="ITEM" @select="emit('duplicate')">
          <span :class="MARKER">⧉</span>
          <span>复制块</span>
        </DropdownMenuItem>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger :class="ITEM">
            <span :class="MARKER">↻</span>
            <span>转为…</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent :class="MENU">
            <BlockTypeMenuItems @pick="(type: BlockType) => emit('retype', type)" />
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator class="mx-2 my-1 bg-line" />

        <DropdownMenuItem variant="destructive" :class="ITEM" @select="emit('remove')">
          <span :class="MARKER">✕</span>
          <span>删除块</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>
