<script setup lang="ts">
import type { HeadingEntry } from "@/lib/headings"
import { onBeforeUnmount, onMounted, ref, watch } from "vue"
import { DOM_ATTR, findEditable, focusEditable } from "@/lib/dom"
import { cn } from "@/lib/utils"

/**
 * 标题导航 —— 贴在笔记页右端的标题刻度。
 *
 * 静止时只有一列短横线（当前小节那条更长、近黑），hover 才展开成带标题文字的目录卡：
 * 鼠标扫过一小块窄条就能看到章节名，离开即收起，不占正文一像素。点击跳到对应标题。
 *
 * 数据与判定分两头：标题列表由调用方从块模型投影出来（`lib/headings`），这里只管
 * 「现在读到了哪一节」和「跳过去」。所以菜单不持有文档状态，也不写任何东西 ——
 * 它是 Preference 的产物，不是笔记的一部分。
 *
 * 滚动容器由调用方给（`viewport`），不去 `closest` 自己找：这层 DOM 结构属于
 * `BlockEditor`，导航不该反过来依赖它。
 */
const props = defineProps<{
  items: readonly HeadingEntry[]
  /** 笔记正文的滚动容器。未挂载时是 null，组件在它到位后再挂监听。 */
  viewport: HTMLElement | null
}>()

/**
 * 视口上沿往下这么深的位置算「正在读的那一行」。
 * 取 0 会让刚滚过一个标题的瞬间就跳回上一节 —— 标题尚在屏幕上，眼睛却已经算下一节。
 */
const ACTIVE_LINE = 96

/** 点击后标题停在离视口顶端这么远的位置，别贴着边。 */
const SCROLL_MARGIN = 24

/** 平滑滚动停下后，安静这么久就算「真的停了」（滚动的两帧之间不会有这么长的空档）。 */
const JUMP_SETTLE_MS = 120

/** 兜底上限：环境不派发 scroll 事件（离屏渲染）时，锁也不能一直挂着。 */
const JUMP_MAX_MS = 1000

const activeId = ref<string | null>(null)

/** 按块 id 找标题行的 DOM。块 id 只含字母数字，属性选择器不需要转义。 */
function headingRow(id: string): HTMLElement | null {
  const el = document.querySelector(`[${DOM_ATTR.blockId}="${id}"]`)
  return el instanceof HTMLElement ? el : null
}

/**
 * 16ms 内合并：滚动事件按屏发，量一次要读整列 rect，不能每次都算。
 *
 * 用 `setTimeout` 而不是 `requestAnimationFrame`：后者的回调在没有画面更新的环境里
 * （离屏渲染、「减少动效」、窗口被遮挡）会被压到很稀，量一次当前小节能拖上一秒，
 * 刻度就明显跟不上滚动。16ms 的定时器不依赖帧，两种环境下都是同一个节奏。
 */
let pending = 0

/**
 * 一次程序化跳转的「锁」。
 *
 * `behavior: "smooth"` 的滚动是逐帧挪的，每一帧都会派发 scroll：目标还在半路，
 * 按当前位置算出来的当前小节必然是别的一节。不锁的话，点击刚点亮的那条会被立刻
 * 改回中途的某一节、滚到位再改回来 —— 菜单文字颜色就闪一下（激活态近黑、其余灰）。
 *
 * 释放靠「scroll 停了」：每来一次 scroll 推后一个 `JUMP_SETTLE_MS` 的定时器，
 * 安静下来就交回 measure。另挂一个上限，万一环境不派发 scroll 也不会永远锁着。
 */
let jumping = false
let jumpTimer = 0

function schedule() {
  if (pending !== 0) return
  pending = window.setTimeout(measure, 16)
}

/** 滚动停下（或被上位超时兜底）：把「当前小节」的判断权交回 measure。 */
function releaseJump() {
  window.clearTimeout(jumpTimer)
  jumpTimer = 0
  jumping = false
  schedule()
}

/** 滚动事件的入口：跳转途中一直压着活跃项，滚动停了才放。 */
function onScroll() {
  if (jumping) {
    window.clearTimeout(jumpTimer)
    jumpTimer = window.setTimeout(releaseJump, JUMP_SETTLE_MS)
  }
  schedule()
}

/**
 * 量一次当前小节：取「最后一条还压在上沿之下的标题」。
 * 标题可能还没落进 DOM（刚插的空标题被过滤掉了，但状态里仍可能有一瞬对不上），
 * 找不到就跳过，不因此把当前小节清空。
 */
function measure() {
  pending = 0
  // 程序化跳转还没停：这段位移里每一帧都只代表「路过的位置」，按它算出的当前
  // 小节永远不是刚点的那一条。让位给点击时点亮的那条，否则激活会来回跳。
  if (jumping) return
  const items = props.items
  if (items.length === 0) {
    activeId.value = null
    return
  }
  const viewport = props.viewport
  if (viewport === null) {
    activeId.value = items[0].id
    return
  }
  const line = viewport.getBoundingClientRect().top + ACTIVE_LINE
  // 滚到底了就是最后一节：末尾那一节往往撑不满一屏，它永远到不了这条线，
  // 不特判的话点最后一条会滚到底、高亮却停在倒数第二条。
  if (viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 2) {
    activeId.value = items[items.length - 1].id
    return
  }
  let current = items[0].id
  for (const item of items) {
    const row = headingRow(item.id)
    if (row === null) continue
    if (row.getBoundingClientRect().top > line) break
    current = item.id
  }
  activeId.value = current
}

function jumpTo(id: string, event: MouseEvent) {
  const viewport = props.viewport
  const row = headingRow(id)
  if (viewport === null || row === null) {
    releaseButton(event)
    return
  }
  const offset = row.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop
  // 先点亮目标再滚：点击的手感立刻有着落；锁住是为了让滚动途中的每一帧都别再改它。
  jumping = true
  activeId.value = id
  viewport.scrollTo({ top: Math.max(offset - SCROLL_MARGIN, 0), behavior: "smooth" })
  window.clearTimeout(jumpTimer)
  jumpTimer = window.setTimeout(releaseJump, JUMP_MAX_MS)
  /**
   * 焦点不能留在菜单项上：菜单项是个 `<button>`，点完它一直是 `document.activeElement`，
   * 于是 `focus-within` 把菜单卡在展开态（鼠标移开也不收），键盘（Tab / 方向键）也还
   * 归菜单 —— 用户点完想接着读或改正文，得再点一下正文。
   *
   * 交给目标标题：跳到哪一节，焦点就该在哪一节，落下去就能直接打字。
   * `preventScroll`：位移归上面的 `scrollTo` 管，别让 `focus()` 自带的那次滚到可见
   * 把标题顶到视口边上、顺手打断平滑滚动。
   */
  const editable = findEditable(id)
  if (editable === null) {
    releaseButton(event)
    return
  }
  focusEditable(editable, "start", { preventScroll: true })
}

/** 目标块还没落进 DOM 时的兜底：至少别把焦点和展开态一起挂在菜单项上。 */
function releaseButton(event: MouseEvent) {
  if (event.currentTarget instanceof HTMLElement) event.currentTarget.blur()
}

/**
 * 只在内容变形时重量（换文档、改标题、视口尺寸变）。
 * `flush: "post"`：等块落进 DOM 再量，否则新文档的标题一条都找不到。
 */
watch(
  [() => props.viewport, () => props.items],
  () => {
    // 换文档后旧的那次跳转已经无从谈起：锁得放掉，否则新文档的当前小节
    // 要等兜底超时才量得出来。
    if (jumping) releaseJump()
    else schedule()
  },
  { flush: "post" },
)

watch(
  () => props.viewport,
  (next, previous) => {
    previous?.removeEventListener("scroll", onScroll)
    next?.addEventListener("scroll", onScroll, { passive: true })
  },
  { immediate: true },
)

// 挂载时量一次：菜单是「标题数够了才出现」，出现的那一刻正是它第一次需要知道当前在哪一节。
onMounted(() => {
  window.addEventListener("resize", schedule)
  schedule()
})
onBeforeUnmount(() => {
  window.removeEventListener("resize", schedule)
  props.viewport?.removeEventListener("scroll", onScroll)
  if (pending !== 0) clearTimeout(pending)
  window.clearTimeout(jumpTimer)
})

/**
 * 刻度的三态。**hover 与激活必须看得出差别**：hover 只是「鼠标在这条上」——
 * 略宽、灰得深一点；激活是「你正在读这一节」—— 最长、近黑。两者同宽同色的话，
 * 悬停时满屏都是「当前章节」，刻度就白画了。
 */
function tickClass(active: boolean): string {
  return cn(
    "h-[3px] shrink-0 rounded-full transition-all duration-150",
    active ? "w-5 bg-foreground" : "w-3.5 bg-line group-hover/nav:bg-muted-foreground group-hover/row:w-4",
  )
}

/**
 * 标题文字。收起态靠 `max-w-0` 压掉宽度而不是 `hidden`：宽度是连续量，
 * 展开时才谈得上过渡；`hidden` 会直接切一刀。
 */
const LABEL =
  "max-w-0 overflow-hidden truncate text-[12.5px] leading-[1.35] whitespace-nowrap opacity-0 transition-[max-width,opacity] duration-200 group-hover/nav:max-w-[220px] group-hover/nav:opacity-100 group-focus-within/nav:max-w-[220px] group-focus-within/nav:opacity-100"
</script>

<template>
  <!-- `data-heading-nav` 给自检页当探针钩子（数刻度、点刻度都靠它定位）。 -->
  <nav
    data-heading-nav
    aria-label="标题导航"
    class="group/nav absolute top-1/2 right-3 z-10 max-h-[70vh] -translate-y-1/2 overflow-y-auto rounded-island px-1.5 py-1.5 transition-[background-color,box-shadow] duration-150 hover:bg-card hover:shadow-pop hover:ring-1 hover:ring-line/70"
  >
    <ul class="flex flex-col items-end gap-0.5">
      <li v-for="item in items" :key="item.id" class="flex w-full justify-end">
        <button
          type="button"
          :data-heading-id="item.id"
          :data-active="item.id === activeId ? 'true' : 'false'"
          :aria-current="item.id === activeId ? 'true' : undefined"
          :title="item.text"
          class="group/row flex w-full items-center justify-end gap-2.5 rounded-[6px] px-1 py-[5px] transition-colors hover:bg-muted"
          @click="jumpTo(item.id, $event)"
        >
          <span
            :class="
              cn(
                LABEL,
                item.id === activeId ? 'font-medium text-foreground' : 'text-muted-foreground',
              )
            "
          >
            {{ item.text }}
          </span>
          <span :class="tickClass(item.id === activeId)" />
        </button>
      </li>
    </ul>
  </nav>
</template>
