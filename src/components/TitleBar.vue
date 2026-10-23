<script setup lang="ts">
import type { Window as TauriWindow } from "@tauri-apps/api/window"
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import { CopyIcon, MinusIcon, MoonIcon, PanelLeftIcon, Redo2Icon, SettingsIcon, SquareIcon, SunIcon, Undo2Icon, XIcon } from "@lucide/vue"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useTheme } from "@/composables/useTheme"
import { useWorkspace } from "@/composables/useWorkspace"
import { isTauriRuntime } from "@/lib/fs"
import EditorTabBar from "./EditorTabBar.vue"
import PageStyleButton from "./PageStyleButton.vue"
import SettingsPanel from "./SettingsPanel.vue"

/**
 * 窗口 chrome —— 整个窗口只有这一条（ADR-0024）。
 *
 * 窗口是无装饰的（`tauri.conf.json` 里 `decorations: false`），所以这一条同时是：
 * 品牌锚点、全局动作（折叠侧栏 / 外观 / 设置）、打开的标签、当前文档的位置与字数、
 * 页面样式入口，以及最小化 / 最大化 / 关闭。
 *
 * 从左到右的次序按「离窗口越远越抽象」排：品牌与全局动作贴着左缘，标签跟着它们，
 * 文档相关的信息收在右端、紧挨窗口按钮。窗口按钮必须贴到右上角，那是用户手指的
 * 肌肉记忆，不要为了对称把它挪进浮岛。
 *
 * 为什么不再让标签条自带浮岛外壳：那层壳连同它与编辑区之间的 10px 一起，
 * 把窗口顶部 86px 全部变成了 chrome，正文要等这么久才出现。并进一条后是 48px。
 */
defineProps<{ sidebarCollapsed: boolean }>()
const emit = defineEmits<{ (event: "toggle-sidebar"): void }>()

/** 与标签栏那批小按钮同一个体量，两个位置的按钮不该长得不一样。 */
const ACTION =
  "size-6 rounded-[5px] p-0 text-muted-foreground hover:text-foreground disabled:opacity-35 disabled:hover:text-muted-foreground"

/**
 * 主题开关。图标画的是**点下去会变成什么**（深色时给太阳），不是当前状态 ——
 * 一颗只有两个态的按钮，用户点它时想知道的是结果。
 */
const { theme, toggle: toggleTheme } = useTheme()
const themeActionLabel = computed(() => (theme.value === "dark" ? "切换到浅色" : "切换到深色"))

/**
 * 文档信息（面包屑 / 字数 / 页面样式）读工作区。它们原先住在编辑区底部的状态栏里，
 * 而 HIG 的 macOS 条款明确反对把「控制与关键信息」放窗口底部：用户常把窗口移到底部，
 * 底边会被屏幕边缘裁掉。搬上来之后底部那一条整体撤掉，字数不再需要单独一条 32px。
 */
const { tabs, activeTab, charCount, undo, redo, canUndo, canRedo } = useWorkspace()
const hasDocument = computed(() => activeTab.value !== null)

/** 设置抽屉的开合。它是 chrome 上的一个动作，不是工作区状态。 */
const settingsOpen = ref(false)

/** 浏览器里（`pnpm dev`）没有窗口这回事，右侧三颗窗口按钮干脆不渲染。 */
const inTauri = isTauriRuntime()

/**
 * 浏览器里没有窗口按钮，chrome 右缘就没有「贴边」的东西了 —— 文档信息区要自己收住
 * 右边距，否则页面样式那颗按钮会顶在窗口边上。
 */
const DOC_INFO = inTauri ? "" : "pr-3"

/**
 * 现在是不是最大化。只为了决定右上角画「最大化」还是「还原」——
 * 不从窗口状态里反推，因为窗口可以被打不到我们的方式改变（贴边、双击、快捷键），
 * 所以订阅 onResized 而不是只在点击后更新。
 */
const maximized = ref(false)

/**
 * 窗口操作统一走这里：`@tauri-apps/api/window` 动态 import，失败不静默。
 *
 * 不在模块作用域缓存 `getCurrentWindow()`：它得等 import 落地，多一帧无所谓，
 * 而在模块里存一份就得额外处理「还没加载完就被点了」。
 */
async function runWindowAction(run: (win: TauriWindow) => Promise<void>) {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window")
    await run(getCurrentWindow())
  } catch (error: unknown) {
    console.warn("[webnote] 窗口操作失败", error)
  }
}

const minimize = () => runWindowAction((win) => win.minimize())

const toggleMaximize = () =>
  runWindowAction(async (win) => {
    await win.toggleMaximize()
    maximized.value = await win.isMaximized()
  })

/** 关窗交给窗口自己走：脏标签的拦截在 App.vue 的 beforeunload 里，不在这里另起一套。 */
const closeWindow = () => runWindowAction((win) => win.close())

let unlistenResized: (() => void) | null = null

/**
 * 标签区放不下时要重新量，但「标签变多」这件事现在发生在别的组件里（EditorTabBar 自己管
 * 滚动），chrome 只在窗口宽度变化时补一次 —— 交叉轴上标签高度是固定的，不需要订阅内容。
 */
onMounted(() => {
  if (!inTauri) return
  void (async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window")
    const win = getCurrentWindow()
    maximized.value = await win.isMaximized()
    unlistenResized = await win.onResized(async () => {
      maximized.value = await win.isMaximized()
    })
  })().catch((error: unknown) => {
    console.warn("[webnote] 没能订阅窗口尺寸（右上角的图标可能不跟着变）", error)
  })
})

onBeforeUnmount(() => {
  unlistenResized?.()
})

/** 窗口按钮：直角、贴边，跟 Windows 原生那三颗一样高；只有关闭键在 hover 时变红。 */
const WINDOW_BTN =
  "flex h-full w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
const CLOSE_BTN = `${WINDOW_BTN} hover:bg-[#c42b1c] hover:text-white`

/** 面包屑末段（文件名）不让位：路径被截断时，用户最先要看的是自己在哪个文件里。 */
</script>

<template>
  <!-- 整条都是拖拽区（`data-tauri-drag-region` 只看事件目标自己带不带这个属性，
       所以按钮和标签不吃它，点得动）。双击标题栏最大化由 Tauri 内建处理。
       标签条后面那段 flex-1 空白是主要的拖拽面 —— 标签少时窗口也有地方可拖。 -->
  <header class="flex h-11 flex-none items-center gap-2 pr-3 pl-3 select-none" data-tauri-drag-region>
    <!-- 品牌名从侧栏顶部搬上来：它描述的是窗口（与 productName 同一件事），不是侧栏。
         留在 chrome 里还顺带解决了「折叠侧栏时标签整排左跳 40px」。 -->
    <span class="flex-none text-[13px] font-medium tracking-[0.01em]">玉简</span>

    <div class="flex flex-none items-center gap-0.5">
      <!-- 三颗按钮都 `@mousedown.prevent`：点下去不抢焦点。否则点完焦点留在按钮上，
           接着按空格 / 回车会把「刚才那个动作」再触发一次。键盘用户照旧 Tab 得到它。 -->
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            :class="ACTION"
            aria-label="折叠侧栏"
            @mousedown.prevent
            @click="emit('toggle-sidebar')"
          >
            <PanelLeftIcon class="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{ sidebarCollapsed ? "展开侧栏" : "折叠侧栏" }}</TooltipContent>
      </Tooltip>

      <!-- 自动模式下它只覆盖当前时段，具体到下一个跳变点会不会被自动接管，看设置面板里的「外观」。 -->
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            :class="ACTION"
            :aria-label="themeActionLabel"
            @mousedown.prevent
            @click="toggleTheme"
          >
            <SunIcon v-if="theme === 'dark'" class="size-3.5" />
            <MoonIcon v-else class="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{ themeActionLabel }}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            :class="ACTION"
            aria-label="设置"
            @mousedown.prevent
            @click="settingsOpen = true"
          >
            <SettingsIcon class="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>设置</TooltipContent>
      </Tooltip>

      <!-- 撤销 / 重做。与上面那三颗之间隔一道线：那组改的是**应用**（侧栏、外观、设置），
           这两颗改的是**当前这篇文档**。以前只有快捷键，界面上没有任何入口 ——
           删错一个块的用户不该需要先知道 Ctrl+Z 才能救回来。
           禁用态来自文档级历史（`canUndo` / `canRedo`），与浏览器自带的那套无关。 -->
      <span class="mx-0.5 h-4 w-px flex-none bg-line" aria-hidden="true" />

      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" :class="ACTION" aria-label="撤销" :disabled="!canUndo" @mousedown.prevent @click="undo">
            <Undo2Icon class="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>撤销 · Ctrl+Z</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" :class="ACTION" aria-label="重做" :disabled="!canRedo" @mousedown.prevent @click="redo">
            <Redo2Icon class="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>重做 · Ctrl+Shift+Z</TooltipContent>
      </Tooltip>
    </div>

    <!-- 动作区与标签区之间那道竖线：它分的是「两堆东西」，没有标签时右边那堆是空的，
         留着就只是一根悬在半空的短线。跟标签条同生共死。 -->
    <span v-if="tabs.length > 0" class="h-4 w-px flex-none bg-line" aria-hidden="true" />

    <!-- 标签条按内容收缩（不 flex-1），后面跟一段拖拽空白：标签少时整条 chrome 仍可拖，
         标签多到放不下时它自己横向滚动。 -->
    <div class="flex min-w-0 flex-1 items-center gap-2">
      <EditorTabBar class="min-w-0" />
      <div class="h-full min-w-4 flex-1" data-tauri-drag-region />
    </div>

    <!-- 右端文档信息：窄窗口先让字数，页面样式与窗口按钮永远留位 ——
         前者是整篇笔记排版的唯一入口，后者是平台约定。
         这里曾经有一段面包屑（`文件夹 / 文件名`），删了：文件名在标签上已经有了，
         文件夹层级在文件树里高亮着，占着右端最值钱的位置只是重复。 -->
    <div class="flex min-w-0 flex-none items-center gap-3" :class="DOC_INFO">
      <!-- 字数每敲一字都变：定宽 + 等宽数字，变化只发生在自己这一格里，
           不会推着右边的页面样式按钮和窗口按钮来回动。 -->
      <span
        v-if="hasDocument"
        class="w-[52px] flex-none text-right text-[11px] tabular-nums text-muted-foreground max-[820px]:hidden"
      >
        {{ charCount }} 字
      </span>

      <!-- 页面样式入口住在 chrome 右端，抽屉本身仍挂编辑区（见 PageStyleButton）。 -->
      <PageStyleButton v-if="hasDocument" />
    </div>

    <div v-if="inTauri" class="-mr-3 flex h-full flex-none items-center">
      <button type="button" :class="WINDOW_BTN" aria-label="最小化" @click="minimize">
        <MinusIcon class="size-3.5" />
      </button>
      <button
        type="button"
        :class="WINDOW_BTN"
        :aria-label="maximized ? '还原' : '最大化'"
        @click="toggleMaximize"
      >
        <CopyIcon v-if="maximized" class="size-3" />
        <SquareIcon v-else class="size-3" />
      </button>
      <button type="button" :class="CLOSE_BTN" aria-label="关闭" @click="closeWindow">
        <XIcon class="size-3.5" />
      </button>
    </div>
  </header>

  <SettingsPanel v-model:open="settingsOpen" />
</template>
