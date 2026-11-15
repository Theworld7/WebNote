<script setup lang="ts">
import type { DataSelectOption } from "@/types/data-table"
import { computed, nextTick, onBeforeUnmount, ref } from "vue"
import { CheckIcon, ChevronDownIcon, PlusIcon } from "@lucide/vue"
import { placeBelow, watchScrollHosts } from "@/lib/floating"

/**
 * 选择格：一格一组选项的那套交互，只有这一个家。
 *
 * **Tab 落到格子上就展开** —— 这是它存在的全部理由。原生 `<select>` 的键盘模型是
 * 「Tab 只是选中它，还要再按一次回车或空格才展开」，展开后方向键 / Esc / Tab 全交给
 * 系统控件，页面无从插手。这里要的是另一套：
 *
 *   回车/空格 开 → ↑↓ 移高亮 → 回车选中 / Esc 收起 → 回车再开 → Tab 才走
 *
 * 焦点**从不进面板**：面板上所有 mousedown 都 prevent，选项是 `div` 而不是 `button`，
 * 于是 Tab 序列里没有它们，一次 Tab 直接落到下一格；Esc 之后也不用把焦点搬回来。
 *
 * 浮层挂到 body 上、`fixed` 定位：引用块的表格外面套着 `overflow-x-auto`，长在格内的
 * 浮层在靠下的行会被裁掉。几何与滚动订阅在 `lib/floating`，与账目的日期月历同一套。
 *
 * 只负责「选一个值」—— 写盘口径、行与列的重新定位都留在调用方（那些是各块的读法）。
 */
const props = withDefaults(
  defineProps<{
    /** 当前值：选项 id，空串 = 未选。指向已删选项时按空显示（与 `valueText` 同一口径）。 */
    modelValue: string
    options: readonly DataSelectOption[]
    /** 空值那一项的文案。它**占一项** —— 清空是一个真实的选择，不该藏在面板外面。 */
    emptyLabel?: string
    /** 面板底部那句出路提示，只在一个真选项都没有时出现。空串 = 不提示。 */
    emptyHint?: string
    /** 格子里要不要那颗小箭头。 */
    chevron?: boolean
    /**
     * 能不能就地新增选项。
     *
     * 开了的话面板底部多一行「＋ 新增选项」：进去填个名字回车就建，建完由父组件去
     * 改表（`create` 事件带着那个名字），本格随即指向它。
     */
    creatable?: boolean
  }>(),
  {
    emptyLabel: "未选择",
    emptyHint: "这一列还没有选项 —— 去数据表里加。",
    chevron: true,
    creatable: false,
  },
)

// `class` / `aria-label` 这类透传要落在**按钮**上，而模板有两个根节点（按钮 + Teleport），
// 自动透传在这种情况下会失效并告警，所以关掉自动透传、手动绑 `v-bind="$attrs"`。
defineOptions({ inheritAttrs: false })

const emit = defineEmits<{ pick: [value: string]; create: [name: string] }>()

/** 面板最高与单项高度（含内边距）。用来估总高，决定往下放还是往上翻。 */
const MAX_HEIGHT = 232
const ITEM_HEIGHT = 27
/** 面板最小宽度：跟着格子走，免得短选项挤成一小块、与格子对不齐。 */
const MIN_WIDTH = 112
const MAX_WIDTH = 260

const anchor = ref<HTMLButtonElement | null>(null)
const list = ref<HTMLElement | null>(null)
const open = ref(false)
const active = ref("")
const placement = ref<ReturnType<typeof placeBelow> | null>(null)
let stopScroll: (() => void) | null = null

/**
 * 「新增选项」那一行的哨兵 id。它不是选项 id —— 真选项的 id 是 `o` 打头的，撞不上，
 * 所以可以直接拿它当「高亮停在建名那一行」的标记。
 */
const CREATE_ROW = "\u0000create"

/** 正在建名：面板底部那一行换成了输入框。 */
const creating = ref(false)
/** 建名时输入框里的字。 */
const draft = ref("")
const draftInput = ref<HTMLInputElement | null>(null)
/**
 * 焦点还给格子时那次 `focus` 会顺手把面板再打开一次 —— 面板刚收掉，得挡一下。
 * 只在还焦点的这一瞬间挡（`focus()` 是同步派发 focus 事件的，挡完立刻撤）。
 */
let suppressOpen = false

/** 「未选择」排在最前，其余按列里定义的顺序。 */
const optionItems = computed(() => [
  { id: "", label: props.emptyLabel },
  ...props.options.map((option) => ({ id: option.id, label: option.name })),
])

/**
 * 键盘走的一串：真实选项 + 末尾的「新增选项」那一行（可建时才有）。
 *
 * 它排在最后，于是「↓ 到底」停在建名那一行而不是绕回第一项 —— 「到底就停住」这条
 * 规矩不变，只是多了一个能停的地方。
 */
const items = computed(() => [
  ...optionItems.value,
  ...(props.creatable ? [{ id: CREATE_ROW, label: "新增选项" }] : []),
])

/** 格子上显示的文案。值指向已删选项时退回空标签（与 `valueText` 同一口径，不漏 id 给人看）。 */
const label = computed(() => props.options.find((option) => option.id === props.modelValue)?.name ?? props.emptyLabel)

function scrollActiveIntoView(): void {
  void nextTick(() => {
    list.value?.querySelector<HTMLElement>("[data-active='true']")?.scrollIntoView({ block: "nearest" })
  })
}

/** 展开。幂等：`focus` 与点击两条入口都会走到这里，重复调用不该把面板关掉。 */
function openPanel(): void {
  if (open.value) return
  const el = anchor.value
  if (el === null) return
  creating.value = false
  draft.value = ""
  place(el)
  active.value = props.modelValue
  open.value = true
  scrollActiveIntoView()
  // 订阅推迟一帧再挂。Tab 到屏幕外的格子时，浏览器会先把格子滚进视口 —— 那一滚发生在
  // focus 之后，立刻订阅就会把它当成「用户在滚动」，刚开的面板当场被关掉。等一帧，
  // 该发生的滚动已经发生，顺便按滚完的位置重算一次落点。
  stopScroll?.()
  stopScroll = null
  requestAnimationFrame(() => {
    if (!open.value) return
    const current = anchor.value
    if (current === null) return
    place(current)
    stopScroll = watchScrollHosts(current, closePanel)
  })
}

function place(el: HTMLElement): void {
  const rect = el.getBoundingClientRect()
  placement.value = placeBelow(rect, {
    height: Math.min(MAX_HEIGHT, items.value.length * ITEM_HEIGHT + 10),
    width: Math.max(rect.width, MIN_WIDTH),
    maxWidth: MAX_WIDTH,
  })
}

function closePanel(): void {
  stopScroll?.()
  stopScroll = null
  open.value = false
  placement.value = null
}

/** ↑↓ 移高亮。到顶 / 到底就停住，不绕回 —— 绕回会让「已经到底了」这件事没手感。 */
function moveActive(step: number): void {
  const index = items.value.findIndex((item) => item.id === active.value)
  const next = Math.min(items.value.length - 1, Math.max(0, (index === -1 ? 0 : index) + step))
  active.value = items.value[next].id
  scrollActiveIntoView()
}

/** 选中一项：先收面板再报出去，**焦点留在按钮上**（它本来就没离开过）。 */
function pick(value: string): void {
  // 「新增选项」那一行不是选择，是进建名态。
  if (value === CREATE_ROW) {
    startCreate()
    return
  }
  closePanel()
  emit("pick", value)
}

/**
 * 进建名态：面板底部那一行换成输入框，焦点进去。
 *
 * 焦点**要**进去 —— 中文输入要一个真的输入框才成。面板平时「焦点从不进来」那条
 * 规矩在这一态是破例的，破例只在这一态：进建名态时输入框是面板里唯一可聚焦的东西。
 */
function startCreate(): void {
  creating.value = true
  draft.value = ""
  void nextTick(() => {
    draftInput.value?.focus()
    const el = anchor.value
    if (el !== null) place(el)
  })
}

/**
 * 建名态的收尾：把名字交出去（空名不算），面板收掉。
 *
 * `keepFocus` 决定要不要把焦点还给格子 —— 回车要（人还在这一格，接着 Tab 就能走），
 * 失焦不要（人已经点到别处去了，把焦点抢回来是添乱）。
 */
function finishCreate(keepFocus: boolean): void {
  const name = draft.value.trim()
  creating.value = false
  draft.value = ""
  closePanel()
  if (name !== "") emit("create", name)
  if (keepFocus) focusCell()
}

/** 建名态 Esc：这个名字不要了，回列表（面板还开着，方向键接着能用）。 */
function cancelCreate(): void {
  creating.value = false
  draft.value = ""
  focusCell()
}

/** 建名态失焦：有名字就交出去（与别处的「失焦提交」同一口径），没名字就放弃。 */
function onDraftBlur(): void {
  if (!creating.value) return
  finishCreate(false)
}

/** 焦点还给格子。那次 `focus` 会顺手把面板再打开一次 —— 挡一下，挡完就撤。 */
function focusCell(): void {
  const el = anchor.value
  if (el === null) return
  suppressOpen = true
  el.focus()
  suppressOpen = false
}

/** 鼠标划过某一项 → 高亮跟着走，点下去选中的就是它。 */
function hover(id: string): void {
  if (active.value !== id) active.value = id
}

/**
 * 键盘。挂在按钮上，焦点从不离开它，所以这条链是完整的：
 * 回车/空格 开 → 方向键移 → 回车选 / Esc 收 → 回车再开 → Tab 才走。
 */
function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Enter" || event.key === " ") {
    // 不拦的话，回车会再合成一次 click（按钮的默认行为），等于开完立刻又点一下。
    event.preventDefault()
    if (open.value) pick(active.value)
    else openPanel()
    return
  }

  if (event.key === "Escape") {
    if (!open.value) return
    // 只收面板，不 blur：焦点留在这一格是这套交互的前提。
    event.preventDefault()
    closePanel()
    return
  }

  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault()
    if (!open.value) openPanel()
    else moveActive(event.key === "ArrowDown" ? 1 : -1)
  }
}

/**
 * 鼠标点击。`mousedown.prevent` 挡住了「点一下就聚焦」，所以这里补上聚焦 ——
 * `focus` 是展开面板的另一条入口（Tab 走的是同一条），补完焦点面板自己会开。
 * 已经展开时再点一次才是「收起」。
 */
function onClick(): void {
  if (open.value) {
    closePanel()
    return
  }
  if (anchor.value !== null && anchor.value.ownerDocument.activeElement !== anchor.value) anchor.value.focus()
  openPanel()
}

/**
 * 聚焦即展开 —— Tab 落到格子上不用再按一次键。
 *
 * 挡的那一下是「焦点还给格子」那一条路：面板刚收掉，不能因为还焦点就又弹回来。
 */
function onFocus(): void {
  if (suppressOpen) return
  openPanel()
}

/**
 * 失焦即收面板。
 *
 * 建名态下焦点是让给面板里那个输入框的，那不算「人走了」—— 面板交给输入框的
 * `blur` 去收。
 */
function onBlur(): void {
  if (creating.value) return
  closePanel()
}

onBeforeUnmount(() => {
  stopScroll?.()
  stopScroll = null
})
</script>

<template>
  <button
    ref="anchor"
    v-bind="$attrs"
    type="button"
    class="flex w-full min-w-0 items-center gap-1 text-left"
    aria-haspopup="listbox"
    :aria-expanded="open"
    @mousedown.prevent
    @focus="onFocus"
    @click="onClick"
    @keydown="onKeydown"
    @blur="onBlur"
  >
    <slot :label="label" :is-empty="modelValue === ''">
      <span class="truncate">{{ label }}</span>
    </slot>
    <ChevronDownIcon v-if="chevron" class="ml-auto size-3 shrink-0 opacity-50" />
  </button>

  <!-- 浮层挂在 body 上：块的表格外层是 `overflow-x-auto`，格内浮层会被裁掉。
       `mousedown.prevent` 是命门 —— 点选项时按钮不失焦，焦点不用搬，方向键一直有效。 -->
  <Teleport to="body">
    <div
      v-if="open && placement !== null"
      class="fixed z-50 overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10"
      :style="{
        top: `${placement.top}px`,
        left: `${placement.left}px`,
        minWidth: `${placement.width}px`,
        maxWidth: `${MAX_WIDTH}px`,
      }"
      @mousedown.prevent
    >
      <div
        ref="list"
        role="listbox"
        class="m-0 overflow-y-auto p-1"
        :style="{ maxHeight: `${MAX_HEIGHT}px` }"
      >
        <div
          v-for="item in optionItems"
          :key="item.id"
          role="option"
          :aria-selected="item.id === active"
          :data-active="item.id === active"
          class="flex cursor-pointer items-center gap-1.5 rounded-[6px] px-1.5 py-[0.3125rem] text-12"
          :class="[item.id === active ? 'bg-selection' : 'hover:bg-muted/60', item.id === '' && 'text-muted-foreground']"
          @mouseenter="hover(item.id)"
          @click="pick(item.id)"
        >
          <span class="truncate">{{ item.label }}</span>
          <CheckIcon v-if="item.id === active" class="ml-auto size-3 shrink-0 opacity-70" />
        </div>
        <div v-if="options.length === 0 && emptyHint !== '' && !creatable" class="px-1.5 py-1 text-11 text-muted-foreground">
          {{ emptyHint }}
        </div>
      </div>

      <!-- 新增选项：可建时才有。它在列表**外面**（列表是 listbox，里面只该有选项），
           但键盘走得到 —— ↑↓ 能停在它身上，回车进建名态。
           建名态里那个输入框是面板里唯一可聚焦的东西：面板「焦点从不进来」那条
           规矩在这里破例一次。 -->
      <div v-if="creatable" class="border-t border-line/60 p-1">
        <input
          v-if="creating"
          ref="draftInput"
          v-model="draft"
          class="w-full rounded-[6px] bg-transparent px-1.5 py-[0.3125rem] text-12 outline-none ring-1 ring-foreground/20"
          placeholder="新选项名，回车确认"
          @mousedown.stop
          @keydown.enter.prevent="finishCreate(true)"
          @keydown.esc.prevent="cancelCreate"
          @blur="onDraftBlur"
        >
        <div
          v-else
          role="option"
          :aria-selected="false"
          :data-active="active === CREATE_ROW"
          class="flex cursor-pointer items-center gap-1.5 rounded-[6px] px-1.5 py-[0.3125rem] text-12 text-muted-foreground"
          :class="active === CREATE_ROW ? 'bg-selection' : 'hover:bg-muted/60'"
          @mouseenter="hover(CREATE_ROW)"
          @click="startCreate"
        >
          <PlusIcon class="size-3 shrink-0" />
          <span>新增选项</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>
