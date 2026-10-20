<script setup lang="ts">
import type { BlockInsertPosition, BlockMenuKind, BlockType } from "@/types/workspace"
import { computed, nextTick, ref, watch } from "vue"
import { PlusIcon } from "@lucide/vue"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import BlockTypeMenuItems from "./BlockTypeMenuItems.vue"
import TypeQueryEcho from "./TypeQueryEcho.vue"
import { blockTypeMeta, blockTypeOptions } from "@/lib/blocks"
import { arrowTargetIndex, type MenuArrow } from "@/lib/menu-nav"
import { TYPE_OPTION_SELECTOR, flushPendingEditableFocus } from "@/lib/dom"
import { useSettings } from "@/composables/useSettings"

const props = defineProps<{
  /** 块类型：把类型标识（BLOCK_TYPES 的 marker）嵌进拖拽把手，hover 时就知道这是块什么。 */
  blockType: BlockType
  /** 当前打开的是哪个菜单，由父级 BlockItem 持有 —— 因为 `/` 输入也要程序化打开类型菜单。 */
  openMenu: BlockMenuKind
  typeMenuMode: "insert" | "convert"
  /** 类型菜单要滤掉的类型。格子内滤容器块与引用块（ADR-0007），顶层不滤。 */
  excludeTypes?: readonly BlockType[]
  /** 是否渲染在布局格子里：手柄贴内容左缘，而不是伸到行外 50px（格子外没地方伸）。 */
  inside?: boolean
  /**
   * 停靠进布局块的底部悬浮条：由悬浮条统一排布与开关，自己不再贴左缘外挂。
   * 布局块的手柄若留在 `left:-50px`，会和格子里首个块的手柄落在同一坐标上被盖住。
   */
  docked?: boolean
}>()

const emit = defineEmits<{
  (event: "update:openMenu", value: BlockMenuKind): void
  (event: "insert", type: BlockType, position: BlockInsertPosition): void
  (event: "retype", type: BlockType): void
  (event: "duplicate"): void
  (event: "copy-content"): void
  (event: "remove"): void
}>()

const { menuGroupLayout } = useSettings()

/** 类型标识字符。与类型菜单左列同源（都取 BLOCK_TYPES 的 marker），不另立一套图标。 */
const meta = computed(() => blockTypeMeta(props.blockType))

/**
 * 插入位置：相对当前块的上方或下方。只作用于 insert 模式，默认下方 ——
 * 与「+」按钮多年来的行为一致，老习惯不被打扰；菜单关掉就复位，下次打开还是下方。
 */
const insertAbove = ref(false)

/** 检索词：菜单里敲的拼音首字母（`dmk` 筛出代码块）。菜单一换一关就清空，下次敲 `/` 是干净的。 */
const typeQuery = ref("")

/** 检索词筛完的清单。菜单渲染与 Enter 落块共用它 —— 两边各筛一套就会「落下的块不在眼前」。 */
const visibleTypes = computed(() => blockTypeOptions(typeQuery.value, props.excludeTypes))

watch(
  () => props.openMenu,
  (open) => {
    if (open !== "type") insertAbove.value = false
    typeQuery.value = ""
  },
)

/** 手柄按钮：24px 见方，比 shadcn 默认图标按钮更小，靠 class 覆盖 size variant。 */
const TOOL = "size-6 rounded-[5px] p-0 text-muted-foreground hover:text-foreground"

/**
 * 拖拽手柄：块类型标识（marker）独自成一颗按钮 —— 与类型菜单左列同源，不另立一套图标。
 * 尺寸与「＋」一致（24px 方形），工具条左偏移随之为 `left:-52px`
 * （＋24 + gap 2 + 把手 24，再让 2px 呼吸位，见模板）。
 *
 * `[-webkit-user-drag:element]` 是给 WKWebView（Tauri 在 macOS 上的实际渲染器）兜底的：
 * WebKit 里光有 `draggable="true"` 不足以让 `<button>` 发起原生拖拽，还得声明这个属性。
 */
const GRIP = `${TOOL} cursor-grab active:cursor-grabbing [-webkit-user-drag:element]`

/**
 * 菜单外框：浮岛圆角、去掉 shadcn 默认的 1px ring，换成原型那套双层阴影。
 * 宽度随「块菜单」设置走 —— 纵向 244px 定宽；横向组要并排，改 `w-max`
 * 让内容撑开（定宽会把横排的组挤换行，「横向」就不成立了）。
 */
const MENU = computed(() =>
  menuGroupLayout.value === "horizontal"
    ? "w-max rounded-island p-1.5 shadow-pop ring-0"
    : "w-[244px] rounded-island p-1.5 shadow-pop ring-0",
)

const ITEM = "gap-2.5 rounded-[7px] px-2 py-1"

const MARKER = "w-5.5 shrink-0 text-center font-mono text-[11.5px] text-muted-foreground"

/** 位置两项的公共数据：方向、符号、文案一次定义，纵向横向两个排布共用。 */
const POSITIONS = [
  { above: true, marker: "↑", label: "在上方插入" },
  { above: false, marker: "↓", label: "在下方插入" },
] as const

/** 按键 → 方向。只认这四个方向键：Esc 关菜单归菜单自己，检索键走 `onQueryKey`。 */
const ARROWS: Readonly<Record<string, MenuArrow | undefined>> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
}

/** 菜单里能落焦点的项。分组标题不是 menuitem，禁用项不该被选中；宽度为 0 的是没渲染。 */
function menuItems(content: HTMLElement): HTMLElement[] {
  return [...content.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')].filter(
    (item) => item.getBoundingClientRect().width > 0,
  )
}

/**
 * 横向布局下的方向键寻路（纵向布局完全不管，交回菜单原生行为）。
 *
 * 菜单原生的上 / 下走的是 **DOM 顺序**，而横向布局只是把分组「摆」成了几列，DOM 仍是
 * 一条直线 —— 列底按 ↓ 会跳到下一列顶上，想去右边那列只能把整列按完。这里按几何位置
 * 挪焦点（见 `lib/menu-nav.ts`），箭头指哪儿焦点去哪儿，列间移动用 ←/→。
 *
 * 挂在 `keydown` 的**捕获阶段**：菜单自己的导航是冒泡阶段挂在 content 上的处理器，
 * 捕获先到才能改道。`preventDefault` 不够 —— 它不看这个标记，照样会按 DOM 顺序再挪一次，
 * 所以还得 `stopPropagation` 把事件截在捕获层，让原生动作彻底不发生。
 */
function onMenuArrow(event: KeyboardEvent) {
  if (menuGroupLayout.value !== "horizontal") return
  const arrow = ARROWS[event.key]
  if (arrow === undefined) return
  const content = event.currentTarget
  if (!(content instanceof HTMLElement)) return

  const focused = event.target instanceof Element ? event.target.closest('[role="menuitem"]') : null
  // 焦点还在菜单外壳上（刚打开）、或停在子菜单触发器上：让菜单自己处理 ——
  // 前者要它把焦点落到第一项，后者 → 得能展开子菜单。
  if (!(focused instanceof HTMLElement) || focused.getAttribute("aria-haspopup") === "menu") return

  const items = menuItems(content)
  const current = items.indexOf(focused)
  if (current === -1) return

  const target = arrowTargetIndex(items.map((item) => item.getBoundingClientRect()), current, arrow)
  if (target === null) {
    // 上下走到列底就停住，不翻到旁边的列；左右走到列边则放行 —— 子菜单里的 ←
    // 还得能把菜单收回父级。
    if (arrow === "up" || arrow === "down") {
      event.preventDefault()
      event.stopPropagation()
    }
    return
  }

  event.preventDefault()
  event.stopPropagation()
  items[target].focus()
}

/**
 * 菜单关闭时把焦点留在块里。
 *
 * 菜单默认会在关闭时把焦点还给触发按钮（那个 24px 的「+」）—— 于是「点完类型菜单」
 * 的结果是焦点停在一颗按钮上，得再点一下正文才能打字；插入 / 转换时更糟：它会把
 * `BlockEditor` 刚交给新块的焦点抢走。焦点由块那边统一交还（新块 / 转换后的块 /
 * 本块），菜单不必再插手 —— 只把先前压住的那次聚焦落下去（见 lib/dom 的
 * `requestEditableFocus`）。
 */
function keepFocusInBlock(event: Event) {
  event.preventDefault()
  flushPendingEditableFocus()
}

/** 「+」/「/」类型菜单的按键：先走检索词，再走方向键寻路。 */
function onTypeMenuKey(event: KeyboardEvent) {
  onQueryKey(event, pickByMode)
  onMenuArrow(event)
}

/** 「转为…」子菜单的按键：子菜单只有「转换」一种落块口径，别按插入模式落块。 */
function onSubMenuKey(event: KeyboardEvent) {
  onQueryKey(event, pickRetype)
  onMenuArrow(event)
}

/** 插入模式下按当前选的插入位置落块；转换模式就是换类型。 */
function pickByMode(type: BlockType) {
  if (props.typeMenuMode === "insert") emit("insert", type, insertAbove.value ? "above" : "below")
  else emit("retype", type)
}

function pickRetype(type: BlockType) {
  emit("retype", type)
}

/** 「转为…」子菜单一展开就清检索词：下次进来看到的仍是全量清单（父菜单没换，watch 不会响）。 */
function onSubOpen(open: boolean) {
  if (open) typeQuery.value = ""
}

/**
 * 检索词这一路的按键：字母 / 数字攒词，退格删一个，Enter 落到清单第一项。
 *
 * 挂捕获阶段并压掉这些键：菜单自己的 `handleKeyDown` 头一行就看 `defaultPrevented`，
 * 压掉之后它不会再按 DOM 顺序做「按首字母跳项」。`pick` 是 Enter 要发的动作 ——
 * 插入 / 转换 / 子菜单三种落块口径由各调用点传进来，这里不猜。
 *
 * Enter 只在焦点不在任何一项上时才接管：焦点已经在某一项上（方向键挪过去的），
 * 那是用户在挑那一项，得让菜单自己点它。
 */
function onQueryKey(event: KeyboardEvent, pick: (type: BlockType) => void) {
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return
  const key = event.key

  if (key === "Enter" && typeQuery.value !== "") {
    // 焦点落在某个块类型上（方向键 / hover 挪过去的）：那是用户在挑那一项，让菜单自己点它。
    // 落在插入位置项上则不算 —— 菜单一打开焦点就可能被挪到那里，不能因此让 Enter 去改插入位置。
    if (event.target instanceof Element && event.target.closest(TYPE_OPTION_SELECTOR) !== null) return
    const first = visibleTypes.value[0]
    // 筛空了就压住 Enter，别让它把菜单关掉却什么都不发生。
    if (first === undefined) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    pick(first.type)
    return
  }

  if (key.length === 1 && /^[a-z0-9]$/i.test(key)) typeQuery.value += key.toLowerCase()
  else if (key === "Backspace" && typeQuery.value !== "") typeQuery.value = typeQuery.value.slice(0, -1)
  else return

  event.preventDefault()
  event.stopPropagation()

  const content = event.currentTarget
  if (!(content instanceof HTMLElement)) return
  // 被筛掉的那一项若正落着焦点，节点一删 DOM 焦点就掉到 body，后面敲的键再也听不见。
  // 交给筛出来的第一个块类型；筛空了退回菜单外壳（键盘焦点会替我们落到第一项上）。
  void nextTick(() => {
    if (content.contains(document.activeElement)) return
    const option = content.querySelector(TYPE_OPTION_SELECTOR)
    if (option instanceof HTMLElement) option.focus({ preventScroll: true })
    else content.focus({ preventScroll: true })
  })
}
</script>

<template>
    <div
      class="flex gap-0.5"
      :class="[
        // 左外负定位悬浮，不占文档流也不压内容：顶层与格内统一伸到块左缘外侧。
        // 宽度 = ＋24 + gap 2 + 把手 24，再让 2px 呼吸位 —— 把手的右缘正好停在正文左缘外，
        // 改动手柄尺寸时必须同步这里，否则它会开始压住首字。
        // 停靠态（docked）没有自己的定位与显隐，交给外部悬浮条。
        docked === true ? '' : 'absolute left-[-52px] transition-opacity',
        docked === true
          ? ''
          : openMenu === ''
            ? 'opacity-0 group-hover:opacity-100'
            : 'opacity-100',
      ]"
      :style="docked === true ? undefined : { top: 'var(--tools-top, 2px)' }"
    >
    <!-- +：在当前块上/下方插入，方向由菜单里的位置两项决定。`/` 输入时复用同一个菜单，只是 mode 换成 convert。 -->
    <DropdownMenu
      :open="openMenu === 'type'"
      @update:open="(open: boolean) => emit('update:openMenu', open ? 'type' : '')"
    >
      <DropdownMenuTrigger as-child>
        <Button variant="ghost" :class="[TOOL, inside && 'bg-background']" aria-label="添加块">
          <PlusIcon class="size-[15px]" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        :class="MENU"
        :side-offset="6"
        @keydown.capture="onTypeMenuKey"
        @close-auto-focus="keepFocusInBlock"
      >
        <!-- 检索回显：菜单里没有输入框，敲的字母得在这儿看得见（空词时是提示语）。 -->
        <TypeQueryEcho :query="typeQuery" />
        <DropdownMenuLabel v-if="typeMenuMode === 'convert'" class="px-2 pb-1 pt-1.5 text-[11px] font-normal text-muted-foreground">
          转换为
        </DropdownMenuLabel>
        <!-- 插入位置：方向已由 ↑/↓ 表明，不再放顶部提示。纵向竖叠在最上；横向并成
             第一列（带「位置」列头），与类型组同构。选中项右侧标 ✓；select.prevent
             让菜单保持打开，接着挑块类型才真正落块。 -->
        <template v-if="typeMenuMode === 'insert'">
          <template v-if="menuGroupLayout === 'vertical'">
            <div class="flex flex-col">
              <DropdownMenuItem
                v-for="position in POSITIONS"
                :key="position.marker"
                :class="ITEM"
                @select.prevent="insertAbove = position.above"
              >
                <span :class="MARKER">{{ position.marker }}</span>
                <span>{{ position.label }}</span>
                <DropdownMenuShortcut v-if="insertAbove === position.above" class="tracking-normal">✓</DropdownMenuShortcut>
              </DropdownMenuItem>
            </div>
            <DropdownMenuSeparator class="mx-2 my-1 bg-line" />
            <BlockTypeMenuItems :query="typeQuery" :exclude="excludeTypes" @pick="(type: BlockType) => emit('insert', type, insertAbove ? 'above' : 'below')" />
          </template>
          <div v-else class="flex items-start gap-x-3">
            <div class="flex min-w-[104px] shrink-0 flex-col">
              <DropdownMenuLabel class="px-2 pb-1 pt-1.5 text-[11px] font-normal text-muted-foreground">位置</DropdownMenuLabel>
              <DropdownMenuItem
                v-for="position in POSITIONS"
                :key="position.marker"
                :class="ITEM"
                @select.prevent="insertAbove = position.above"
              >
                <span :class="MARKER">{{ position.marker }}</span>
                <span>{{ position.label }}</span>
                <DropdownMenuShortcut v-if="insertAbove === position.above" class="tracking-normal">✓</DropdownMenuShortcut>
              </DropdownMenuItem>
            </div>
            <BlockTypeMenuItems :query="typeQuery" :exclude="excludeTypes" @pick="(type: BlockType) => emit('insert', type, insertAbove ? 'above' : 'below')" />
          </div>
        </template>
        <BlockTypeMenuItems v-else :query="typeQuery" :exclude="excludeTypes" @pick="(type: BlockType) => emit('retype', type)" />
      </DropdownMenuContent>
    </DropdownMenu>

    <!-- 类型标识（¶ / H1 / • / </> / ⊞ …）：点击开块操作菜单，按住拖动则是排序手柄。
         与类型菜单左列同源（都取 BLOCK_TYPES 的 marker）—— hover 上来一眼就知道在操作什么块。
         拖拽由 BlockEditor 在容器上统一接管（dragstart 会冒泡），这里只负责让元素可拖。 -->
    <DropdownMenu
      :open="openMenu === 'action'"
      @update:open="(open: boolean) => emit('update:openMenu', open ? 'action' : '')"
    >
      <DropdownMenuTrigger as-child>
        <Button
          variant="ghost"
          :class="[GRIP, inside && 'bg-background']"
          draggable="true"
          data-drag-handle="true"
          :aria-label="`${meta.label}块操作菜单，拖动可重排`"
        >
          <span class="text-center font-mono text-[11.5px] leading-none">{{ meta.marker }}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        :class="MENU"
        :side-offset="6"
        @keydown.capture="onMenuArrow"
        @close-auto-focus="keepFocusInBlock"
      >
        <DropdownMenuItem :class="ITEM" @select="emit('duplicate')">
          <span :class="MARKER">⧉</span>
          <span>复制块</span>
        </DropdownMenuItem>

        <DropdownMenuItem :class="ITEM" @select="emit('copy-content')">
          <span :class="MARKER">⎘</span>
          <span>复制内容</span>
        </DropdownMenuItem>

        <DropdownMenuSub @update:open="onSubOpen">
          <DropdownMenuSubTrigger :class="ITEM">
            <span :class="MARKER">↻</span>
            <span>转为…</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent :class="MENU" @keydown.capture="onSubMenuKey" @close-auto-focus="keepFocusInBlock">
            <!-- 子菜单里敲的也是同一个检索词，回显跟着走一份，别让人以为没敲进去。 -->
            <TypeQueryEcho :query="typeQuery" />
            <BlockTypeMenuItems :query="typeQuery" :exclude="excludeTypes" @pick="(type: BlockType) => emit('retype', type)" />
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
