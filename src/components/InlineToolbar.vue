<script setup lang="ts">
import type { Component } from "vue"
import { onBeforeUnmount, ref, watch } from "vue"
import type { InlineMark } from "@/types/workspace"
import { BoldIcon, CodeIcon, HighlighterIcon, LinkIcon, PaletteIcon, StrikethroughIcon, UnderlineIcon } from "@lucide/vue"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { MARK_REGISTRY, TEXT_COLORS } from "@/lib/inline"
import { cn } from "@/lib/utils"

/**
 * 选中文本后浮在选区上方的行内格式条。
 *
 * 只放加粗 / 下划线 / 删除线 / 高亮 / 行内代码五项：斜体虽然模型与解析都支持，
 * 但中文排版几乎不用，先不给按钮 —— 菜单里摆一排用不上的东西只会让人犹豫。
 *
 * **按钮顺序与注册表顺序无关**：注册表那一列是序列化的嵌套顺序（由外到内，`code`
 * 在 `highlight` 之前才包得对），而按钮怎么排是 UI 决定（按使用频率）。两者硬绑
 * 在一起会让改序列化顺序意外挪动按钮。
 * 按钮的存废与名字仍由注册表的 `label` 说了算 —— 这里只决定「先给谁」。
 *
 * 链接是最后一项，与标记按钮之间留了分隔线：标记是开关，链接要弹浮层输地址，
 * 交互形态不同，不放同一排。
 */
const BUTTON_ORDER: readonly InlineMark[] = ["bold", "underline", "strike", "highlight", "code"]

const ICONS: Readonly<Partial<Record<InlineMark, Component>>> = {
  bold: BoldIcon,
  underline: UnderlineIcon,
  strike: StrikethroughIcon,
  highlight: HighlighterIcon,
  code: CodeIcon,
}

const ITEMS = BUTTON_ORDER.flatMap((mark) => {
  const spec = MARK_REGISTRY.find((item) => item.mark === mark)
  const icon = ICONS[mark]
  if (spec?.label === undefined || icon === undefined) return []
  return [{ mark, label: spec.label, icon }]
})

const props = defineProps<{
  /** 选区起点处生效的标记，用来把对应的按钮标成激活态。 */
  marks: readonly InlineMark[]
  /** 选区起点处的文本颜色；默认色为 null。色板按钮的激活态与色块下划线用。 */
  color?: string | null
  /** 选区起点处是否已在链接上 —— 「链接」按钮的激活态。不放链接按钮时可省。 */
  link?: boolean
  /** 视口坐标，浮条以此为底部中心点。 */
  anchor: { top: number; left: number }
  /** 是否隐藏「链接」按钮。表格单元格里关掉：链接浮层（w-72）会盖住相邻格，
   * 且「内联样式」不含链接 —— 链接不是 mark（见 CONTEXT.md），浮层形态也不同。
   * 用否定式而非 withLink 默认 true：可选 boolean 不传时 Vue 会 cast 成 false，
   * 「不传 = 显示」这个默认方向表达不出来（与 inCell 等既有 prop 同一惯例）。 */
  noLink?: boolean
}>()

const emit = defineEmits<{
  (event: "toggle", mark: InlineMark): void
  (event: "color", value: string | null): void
  (event: "link"): void
}>()

// ---- 颜色色板 ----

/** 色板开合。点色应用后即收；点浮条外（正文等）由 document 监听收起，选区还在。 */
const colorOpen = ref(false)
const toolbarRoot = ref<HTMLElement | null>(null)

function onDocMouseDown(event: MouseEvent) {
  if (toolbarRoot.value?.contains(event.target as Node) !== true) colorOpen.value = false
}

watch(colorOpen, (open) => {
  if (open) document.addEventListener("mousedown", onDocMouseDown, true)
  else document.removeEventListener("mousedown", onDocMouseDown, true)
})
onBeforeUnmount(() => document.removeEventListener("mousedown", onDocMouseDown, true))

function pickColor(value: string) {
  emit("color", value === "" ? null : value)
  colorOpen.value = false
}

/** 24px 见方的图标按钮，与块左侧手柄同规格。 */
const TOOL = "size-6 rounded-[5px] p-0 text-muted-foreground hover:text-foreground"

const ACTIVE = "bg-accent text-foreground"

/**
 * 按下就吞掉默认行为。
 *
 * 按钮一旦拿到焦点，页面选区当场清空 —— 那样就无从知道要给哪段文字加格式了。
 * 所以这里不靠 click 之前先抢焦点，而是让选区原地不动，click 照常触发。
 */
function keepSelection(event: MouseEvent) {
  event.preventDefault()
}
</script>

<template>
  <div
    ref="toolbarRoot"
    data-inline-toolbar
    class="fixed z-50 flex items-center gap-0.5 rounded-island border border-line bg-background p-1 shadow-pop"
    :style="{ top: `${anchor.top}px`, left: `${anchor.left}px`, transform: 'translate(-50%, -100%)' }"
    @mousedown="keepSelection"
  >
    <!-- tooltip 往下弹:浮条本身悬在选区上方,再往上弹会盖住自己,选区在文档顶部时还会出视口。 -->
    <Tooltip v-for="item in ITEMS" :key="item.mark">
      <TooltipTrigger as-child>
        <Button
          variant="ghost"
          :class="cn(TOOL, props.marks.includes(item.mark) && ACTIVE)"
          :aria-label="item.label"
          :aria-pressed="props.marks.includes(item.mark)"
          @click="emit('toggle', item.mark)"
        >
          <component :is="item.icon" class="size-[14px]" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{{ item.label }}</TooltipContent>
    </Tooltip>

    <!-- 颜色：按钮带当前色下划线，点开下拉色盘（Notion 取值，见 TEXT_COLORS）。
         面板锚在按钮上往下弹 —— 浮条本身贴着选区上沿，往上没有地方。 -->
    <div class="relative flex">
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            :class="cn(TOOL, props.color !== null && ACTIVE)"
            aria-label="颜色"
            :aria-pressed="colorOpen"
            @click="colorOpen = !colorOpen"
          >
            <span class="relative inline-flex size-[14px] items-center justify-center">
              <PaletteIcon class="size-[14px]" />
              <span
                class="absolute -bottom-0.5 h-0.5 w-3.5 rounded-full"
                :style="{ background: props.color ?? 'transparent' }"
                aria-hidden="true"
              />
            </span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">颜色</TooltipContent>
      </Tooltip>

      <div
        v-if="colorOpen"
        class="absolute top-full left-1/2 z-50 mt-1.5 flex -translate-x-1/2 items-center gap-0.5 rounded-island border border-line bg-background p-1 shadow-pop"
      >
        <button
          v-for="item in TEXT_COLORS"
          :key="item.name"
          type="button"
          :aria-label="item.name"
          :aria-pressed="(props.color ?? '') === item.value"
          :class="
            cn(
              'flex size-6 items-center justify-center rounded-[5px] hover:bg-accent',
              (props.color ?? '') === item.value && 'bg-accent',
            )
          "
          @click="pickColor(item.value)"
        >
          <!-- 圆角色块：默认色没有色可填，画个描边空块表示「回到这个」。 -->
          <span
            class="block size-3.5 rounded-[4px] border border-line"
            :style="{ background: item.value === '' ? undefined : item.value }"
            aria-hidden="true"
          />
        </button>
      </div>
    </div>

    <template v-if="!props.noLink">
      <span class="mx-0.5 h-4 w-px bg-line" aria-hidden="true" />

      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            :class="cn(TOOL, props.link && ACTIVE)"
            aria-label="链接"
            :aria-pressed="props.link"
            @click="emit('link')"
          >
            <LinkIcon class="size-[14px]" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">链接</TooltipContent>
      </Tooltip>
    </template>
  </div>
</template>
