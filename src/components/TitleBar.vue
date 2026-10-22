<script setup lang="ts">
import type { Window as TauriWindow } from "@tauri-apps/api/window"
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import { CopyIcon, MinusIcon, MoonIcon, PanelLeftIcon, SettingsIcon, SquareIcon, SunIcon, XIcon } from "@lucide/vue"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useTheme } from "@/composables/useTheme"
import { isTauriRuntime } from "@/lib/fs"
import SettingsPanel from "./SettingsPanel.vue"

/**
 * 窗口标题栏。窗口是无装饰的（`tauri.conf.json` 里 `decorations: false`），
 * 所以这一条既承担原来的系统标题栏（拖拽 / 最小化 / 最大化 / 关闭），
 * 也收留了全局动作（折叠侧栏、深浅切换、设置）—— 它们原先挤在标签浮岛的右端。
 *
 * 布局是「左端动作 + 中间拖拽空白 + 右端窗口按钮」：窗口按钮必须贴到右上角，
 * 那是用户手指的肌肉记忆，不要为了对称把它挪进浮岛。
 */
defineProps<{ sidebarCollapsed: boolean }>()
const emit = defineEmits<{ (event: "toggle-sidebar"): void }>()

/** 与标签栏那批小按钮同一个体量，两个位置的按钮不该长得不一样。 */
const ACTION = "size-6 rounded-[5px] p-0 text-muted-foreground hover:text-foreground"

/**
 * 主题开关。图标画的是**点下去会变成什么**（深色时给太阳），不是当前状态 ——
 * 一颗只有两个态的按钮，用户点它时想知道的是结果。
 */
const { theme, toggle: toggleTheme } = useTheme()
const themeActionLabel = computed(() => (theme.value === "dark" ? "切换到浅色" : "切换到深色"))

/** 设置抽屉的开合。它是浮岛上的一个动作，不是工作区状态。 */
const settingsOpen = ref(false)

/** 浏览器里（`pnpm dev`）没有窗口这回事，右侧三颗窗口按钮干脆不渲染。 */
const inTauri = isTauriRuntime()

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

/** 窗口按钮：直角、贴边，跟 Windows 原生那三颗一样大；只有关闭键在 hover 时变红。 */
const WINDOW_BTN =
  "flex h-9 w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
const CLOSE_BTN = `${WINDOW_BTN} hover:bg-[#c42b1c] hover:text-white`
</script>

<template>
  <!-- 整条都是拖拽区（`data-tauri-drag-region` 只看事件目标自己带不带这个属性，
       所以按钮不吃它，点得动）。双击标题栏最大化由 Tauri 内建处理。 -->
  <header class="flex h-9 flex-none items-center justify-between select-none" data-tauri-drag-region>
    <div class="flex flex-none items-center gap-0.5 pl-2">
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
            <PanelLeftIcon class="size-[15px]" />
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
            <SunIcon v-if="theme === 'dark'" class="size-[15px]" />
            <MoonIcon v-else class="size-[15px]" />
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
            <SettingsIcon class="size-[15px]" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>设置</TooltipContent>
      </Tooltip>
    </div>

    <div class="h-full min-w-0 flex-1" data-tauri-drag-region />

    <div v-if="inTauri" class="flex flex-none items-center">
      <button type="button" :class="WINDOW_BTN" aria-label="最小化" @click="minimize">
        <MinusIcon class="size-[15px]" />
      </button>
      <button
        type="button"
        :class="WINDOW_BTN"
        :aria-label="maximized ? '还原' : '最大化'"
        @click="toggleMaximize"
      >
        <CopyIcon v-if="maximized" class="size-[13px]" />
        <SquareIcon v-else class="size-[13px]" />
      </button>
      <button type="button" :class="CLOSE_BTN" aria-label="关闭" @click="closeWindow">
        <XIcon class="size-[15px]" />
      </button>
    </div>
  </header>

  <SettingsPanel v-model:open="settingsOpen" />
</template>
