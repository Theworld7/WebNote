<script setup lang="ts">
import type { ContentWidth, MenuGroupLayout, TableEffect } from "@/composables/useSettings"
import type { ThemeMode } from "@/types/workspace"
import type { Component } from "vue"
import { computed, onMounted, ref } from "vue"
import {
  CheckIcon,
  ClockIcon,
  Columns2Icon,
  FolderTreeIcon,
  ListIcon,
  ListTreeIcon,
  MonitorIcon,
  MoonIcon,
  MoveHorizontalIcon,
  RotateCcwIcon,
  SunIcon,
  SunriseIcon,
  WrapTextIcon,
  XIcon,
} from "@lucide/vue"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet"
import { CONTENT_WIDTH_PX, HEADING_NAV_MIN_FLOOR, useSettings } from "@/composables/useSettings"
import { listSystemFonts } from "@/lib/fonts"
import { resolvePlace } from "@/lib/place"
import { dayOf, sunTimes } from "@/lib/sun"
import { minutesOf } from "@/lib/theme-mode"
import FontPicker from "./FontPicker.vue"

/**
 * 设置面板。
 *
 * 结构固定成「左侧分区 + 右侧内容」两栏。分区只有一项时不隐藏分区栏 ——
 * 藏起来会让后面加第二个分区时面板宽度突然变化。
 *
 * 面板本身不持有任何状态：开着关着由调用方（`EditorTabBar`）的 `v-model:open` 控制，
 * 设置值直接读写 `useSettings()`，所以关掉再打开不会丢，也不需要「应用 / 取消」。
 */
const open = defineModel<boolean>("open", { required: true })

const { tableEffect, setTableEffect, contentWidth, setContentWidth, menuGroupLayout, setMenuGroupLayout, integrateTables, setIntegrateTables, headingNav, setHeadingNav, headingNavMin, setHeadingNavMin, contentFont, setContentFont, codeFont, setCodeFont, theme, setTheme } = useSettings()

/**
 * 本机字体列表。打开面板时才去取（桌面端要扫一遍系统字体），拿到之前选择框里
 * 只有「系统默认」一项 —— 用户可以就地等一下，不会看到空下拉。
 * 取不到时 `listSystemFonts` 自己降级，这里不需要错误分支。
 */
const fonts = ref<string[]>([])
onMounted(() => {
  void listSystemFonts().then((names) => (fonts.value = names))
})

/** 分区。加新分区时在这里加一条，右侧内容按 `activeSection` 分派。 */
const SECTIONS = [
  { id: "display", label: "显示" },
  { id: "appearance", label: "外观" },
] as const

type SectionId = (typeof SECTIONS)[number]["id"]

/** 当前分区。默认停在「显示」—— 它是这块面板打开时的原有落点。 */
const activeSection = ref<SectionId>("display")

interface TableEffectOption {
  value: TableEffect
  label: string
  hint: string
  icon: Component
}

/**
 * 两个互斥选项。顺序与默认值一致 —— `wrap` 在前，因为它是当前行为、也是默认。
 *
 * 文案刻意写全「内容自适应换行不滚动」：只说「换行」会让人以为另一项叫「不换行」，
 * 而真正的差别是**表格会不会横向滚动**（换行只是它的前提）。
 */
const TABLE_EFFECT_OPTIONS: readonly TableEffectOption[] = [
  {
    value: "wrap",
    label: "内容自适应换行不滚动",
    hint: "格子内文字自动换行，表格宽度始终与正文一致",
    icon: WrapTextIcon,
  },
  {
    value: "scroll",
    label: "表格滚动",
    hint: "格子内文字不换行，表格按内容撑开，超出部分横向滚动",
    icon: MoveHorizontalIcon,
  },
]

interface ContentWidthOption {
  value: ContentWidth
  label: string
}

/**
 * 三档内容宽度。图标位置换成一条宽度按档位递增的横条 —— 宽度这个量,
 * 画出来比任何象形图标都直白;`standard` 就是这个偏好出现之前的版心（现为 720px）。
 */
const CONTENT_WIDTH_OPTIONS: readonly ContentWidthOption[] = [
  { value: "narrow", label: "窄" },
  { value: "standard", label: "标准" },
  { value: "wide", label: "宽" },
]

/** 档位条的宽度类,与档位单调递增对应(12 / 20 / 28px)。字面量,Tailwind 扫描要求。 */
const CONTENT_WIDTH_BAR: Readonly<Record<ContentWidth, string>> = {
  narrow: "w-3",
  standard: "w-5",
  wide: "w-7",
}

interface MenuGroupLayoutOption {
  value: MenuGroupLayout
  label: string
  hint: string
  icon: Component
}

/**
 * 块菜单分组的两种排布。纵向是出现分组小标题以来的原有行为、也是默认；
 * 横向把组并排成几列，菜单矮而宽 —— 项多时不用滚那么深。
 */
const MENU_GROUP_LAYOUT_OPTIONS: readonly MenuGroupLayoutOption[] = [
  {
    value: "vertical",
    label: "纵向",
    hint: "组从上到下依次排，菜单窄而高",
    icon: ListIcon,
  },
  {
    value: "horizontal",
    label: "横向",
    hint: "组并排成几列，菜单矮而宽",
    icon: Columns2Icon,
  },
]

interface ThemeModeOption {
  value: ThemeMode
  label: string
  hint: string
  icon: Component
}

/**
 * 五档互斥。前两档「定死」，后三档自动；自动那三档各自接一块小表单，前两档没有可配的。
 * 顺序按「手动 → 自动、由简到繁」排，跟用户找答案的顺序一致。
 */
const THEME_MODE_OPTIONS: readonly ThemeModeOption[] = [
  { value: "light", label: "浅色", hint: "固定浅色，不随任何东西变", icon: SunIcon },
  { value: "dark", label: "深色", hint: "固定深色，不随任何东西变", icon: MoonIcon },
  { value: "system", label: "跟随系统", hint: "系统换外观时跟着换", icon: MonitorIcon },
  { value: "fixed", label: "固定时间", hint: "每天到点切，跨零点也对", icon: ClockIcon },
  { value: "sun", label: "日出日落", hint: "按所在位置的日出日落切", icon: SunriseIcon },
]

/**
 * 日出日落要一个坐标。用户填过就用他的，没填就按系统时区推测（见 `lib/place`）——
 * 面板把这两件事分开说清楚：地点名 + 坐标各是谁给的。
 *
 * 顺带把算出来的今日时刻摊在下面。坐标填错没有报错可言，唯一征兆就是这两个时刻
 * 不像话，所以它必须能一眼看到。
 */
const place = computed(() => resolvePlace(theme.value))
const sunToday = computed(() => sunTimes(dayOf(new Date()), place.value.latitude, place.value.longitude))

function clockOf(date: Date | null): string {
  if (date === null) return "—"
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

const sunTodayText = computed(() => {
  if (sunToday.value.polar === "day") return "极昼 · 全天浅色"
  if (sunToday.value.polar === "night") return "极夜 · 全天深色"
  return `日出 ${clockOf(sunToday.value.sunrise)} · 日落 ${clockOf(sunToday.value.sunset)}`
})

/** 从事件里取输入框的值。项目禁类型断言，用 `instanceof` 收窄。 */
function inputValue(event: Event): string | null {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return null
  return target.value
}

function commitTime(field: "lightAt" | "darkAt", event: Event) {
  const value = inputValue(event)
  if (value === null || minutesOf(value) === null) return
  // 分两支写：计算键名会把对象自身推成宽索引签名，这里不吃那个亏。
  if (field === "lightAt") setTheme({ lightAt: value })
  else setTheme({ darkAt: value })
}

/**
 * 坐标以「当前生效的地点」为基准改一格，另一个轴保持原样 —— 第一次改动经纬度时，
 * 另一轴自动从系统时区的推测值接上，不会留下「只填了一个轴」的半截态。
 */
function commitCoordinate(field: "latitude" | "longitude", event: Event) {
  const raw = inputValue(event)
  if (raw === null) return
  const parsed = Number.parseFloat(raw)
  if (!Number.isFinite(parsed)) return
  const next =
    field === "latitude"
      ? { latitude: parsed, longitude: place.value.longitude }
      : { latitude: place.value.latitude, longitude: parsed }
  if (Math.abs(next.latitude) > 90 || Math.abs(next.longitude) > 180) return
  setTheme(next)
}

/** 「按系统时区」：两个轴一起清空，回到 `systemPlace()` 的推测值。 */
function resetPlace() {
  setTheme({ latitude: null, longitude: null })
}

/**
 * 标题导航的出现门槛。
 *
 * 空值 / 非数字 / 低于下限一律落到下限（1）—— 这一项没有「不设」这个状态，最小值就是
 * 「只要有标题就显示」。夹过之后把结果写回输入框：用户敲 0 被夹成 1 时，框里不能还留着 0。
 */
function commitHeadingNavMin(event: Event) {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  const parsed = Number.parseInt(target.value, 10)
  setHeadingNavMin(Number.isNaN(parsed) ? HEADING_NAV_MIN_FLOOR : parsed)
  target.value = String(headingNavMin.value)
}

/** 抽屉标题栏的关闭按钮，与工具栏那批小按钮同一体量。 */
const CLOSE = "size-6 rounded-[5px] p-0 text-muted-foreground hover:text-foreground"

/** 分区项。选中态走 `bg-selection`，与标签条 / 保存按钮同一个强调色。 */
function sectionClass(isActive: boolean): string {
  return isActive
    ? "bg-selection text-selection-foreground"
    : "text-muted-foreground hover:bg-muted hover:text-foreground"
}

/**
 * 选项行。选中时用边框 + 底色，不用对勾 —— 对勾放在左侧会与图标打架，
 * 放右侧又离文字太远；整行高亮更直白。
 */
function optionClass(isActive: boolean): string {
  return isActive
    ? "border-foreground/25 bg-muted"
    : "border-line hover:border-foreground/15 hover:bg-muted/50"
}
</script>

<template>
  <Sheet v-model:open="open">
    <SheetContent>
      <!-- 标题栏：高度与浮岛对齐（p-1 + h-8 内容），关闭键贴在右端。 -->
      <header class="flex flex-none items-center justify-between border-b border-line px-3 py-2.5">
        <SheetTitle>设置</SheetTitle>
        <SheetClose as-child>
          <Button variant="ghost" :class="CLOSE" aria-label="关闭设置">
            <XIcon class="size-3.5" />
          </Button>
        </SheetClose>
      </header>

      <div class="flex min-h-0 flex-1">
        <!-- 分区栏。窄（76px）是有意的：分区名都是两三个字，宽了只会挤掉右边的选项宽度。 -->
        <nav class="flex w-[76px] flex-none flex-col gap-0.5 border-r border-line p-2">
          <button
            v-for="section in SECTIONS"
            :key="section.id"
            type="button"
            :class="[
              'rounded-[7px] px-2 py-1.5 text-left text-[13px] transition-colors',
              sectionClass(section.id === activeSection),
            ]"
            @click="activeSection = section.id"
          >
            {{ section.label }}
          </button>
        </nav>

        <!-- 内容区 -->
        <ScrollArea class="min-h-0 flex-1">
          <div v-if="activeSection === 'display'" class="flex flex-col gap-4 p-3.5">
            <section class="flex flex-col gap-2">
              <h3 class="text-[13px] font-medium text-foreground">表格效果</h3>
              <SheetDescription>
                宽表格超出正文宽度时如何排布。
              </SheetDescription>

              <div class="mt-0.5 flex flex-col gap-1.5">
                <button
                  v-for="option in TABLE_EFFECT_OPTIONS"
                  :key="option.value"
                  type="button"
                  role="radio"
                  :aria-checked="tableEffect === option.value"
                  :class="[
                    'flex items-start gap-2.5 rounded-[9px] border p-2.5 text-left transition-colors',
                    optionClass(tableEffect === option.value),
                  ]"
                  @click="setTableEffect(option.value)"
                >
                  <component
                    :is="option.icon"
                    class="mt-0.5 size-4 flex-none text-muted-foreground"
                  />
                  <span class="flex min-w-0 flex-col gap-0.5">
                    <span class="text-[13px] leading-[1.4] text-foreground">
                      {{ option.label }}
                    </span>
                    <span class="text-[12px] leading-[1.45] text-muted-foreground">
                      {{ option.hint }}
                    </span>
                  </span>
                  <CheckIcon
                    v-if="tableEffect === option.value"
                    class="ml-auto mt-0.5 size-3.5 flex-none text-foreground"
                  />
                </button>
              </div>
            </section>

            <section class="flex flex-col gap-2">
              <h3 class="text-[13px] font-medium text-foreground">内容宽度</h3>
              <SheetDescription>编辑器里正文内容的最大宽度。</SheetDescription>

              <!-- 三档横排:窄 → 宽本身是个一维刻度,横排比竖叠更读得出「档位」。 -->
              <div class="mt-0.5 grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="内容宽度">
                <button
                  v-for="option in CONTENT_WIDTH_OPTIONS"
                  :key="option.value"
                  type="button"
                  role="radio"
                  :aria-checked="contentWidth === option.value"
                  :class="[
                    'flex flex-col items-center gap-1.5 rounded-[9px] border p-2.5 transition-colors',
                    optionClass(contentWidth === option.value),
                  ]"
                  @click="setContentWidth(option.value)"
                >
                  <!-- 档位条:宽度随档位递增,条本身就在回答「这档有多宽」。 -->
                  <span class="flex h-1 items-center">
                    <span
                      :class="['h-1 rounded-full bg-muted-foreground', CONTENT_WIDTH_BAR[option.value]]"
                    />
                  </span>
                  <span class="text-[13px] leading-[1.4] text-foreground">
                    {{ option.label }}
                  </span>
                  <span class="text-[12px] leading-[1.45] text-muted-foreground">
                    {{ CONTENT_WIDTH_PX[option.value] }}px
                  </span>
                </button>
              </div>
            </section>

            <section class="flex flex-col gap-2">
              <h3 class="text-[13px] font-medium text-foreground">块菜单</h3>
              <SheetDescription>插入块与「转为…」菜单里分组的排布方向。</SheetDescription>

              <!-- 两档横排:方向本身是二维的,用图标画出组的走向比文字更直白。 -->
              <div class="mt-0.5 grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="块菜单分组排布">
                <button
                  v-for="option in MENU_GROUP_LAYOUT_OPTIONS"
                  :key="option.value"
                  type="button"
                  role="radio"
                  :aria-checked="menuGroupLayout === option.value"
                  :class="[
                    'flex flex-col items-start gap-1 rounded-[9px] border p-2.5 text-left transition-colors',
                    optionClass(menuGroupLayout === option.value),
                  ]"
                  @click="setMenuGroupLayout(option.value)"
                >
                  <component :is="option.icon" class="size-4 text-muted-foreground" />
                  <span class="text-[13px] leading-[1.4] text-foreground">{{ option.label }}</span>
                  <span class="text-[12px] leading-[1.45] text-muted-foreground">{{ option.hint }}</span>
                </button>
              </div>
            </section>

            <section class="flex flex-col gap-2">
              <h3 class="text-[13px] font-medium text-foreground">文件树</h3>
              <SheetDescription>开启后被笔记引用的数据表收进笔记名下，树更清爽。</SheetDescription>

              <!-- 单独一项布尔偏好：它不是「几选一」，所以不给它凑成两条互斥选项。 -->
              <button
                type="button"
                role="switch"
                :aria-checked="integrateTables"
                :class="[
                  'mt-0.5 flex items-start gap-2.5 rounded-[9px] border p-2.5 text-left transition-colors',
                  optionClass(integrateTables),
                ]"
                @click="setIntegrateTables(!integrateTables)"
              >
                <FolderTreeIcon class="mt-0.5 size-4 flex-none text-muted-foreground" />
                <span class="flex min-w-0 flex-col gap-0.5">
                  <span class="text-[13px] leading-[1.4] text-foreground">整合数据表视图</span>
                  <span class="text-[12px] leading-[1.45] text-muted-foreground">
                    被引用的数据表挂在引用它的笔记下，笔记名隐去 .html 后缀
                  </span>
                </span>
                <CheckIcon v-if="integrateTables" class="ml-auto mt-0.5 size-3.5 flex-none text-foreground" />
              </button>
            </section>

            <section class="flex flex-col gap-2">
              <h3 class="text-[13px] font-medium text-foreground">标题导航</h3>
              <SheetDescription>笔记右端的标题刻度，hover 展开目录，点击跳到那一节。</SheetDescription>

              <!-- 开关默认是开的：这项功能本来就是默认在的，关掉才是选择。 -->
              <button
                type="button"
                role="switch"
                :aria-checked="headingNav"
                :class="[
                  'mt-0.5 flex items-start gap-2.5 rounded-[9px] border p-2.5 text-left transition-colors',
                  optionClass(headingNav),
                ]"
                @click="setHeadingNav(!headingNav)"
              >
                <ListTreeIcon class="mt-0.5 size-4 flex-none text-muted-foreground" />
                <span class="flex min-w-0 flex-col gap-0.5">
                  <span class="text-[13px] leading-[1.4] text-foreground">悬浮标题菜单</span>
                  <span class="text-[12px] leading-[1.45] text-muted-foreground">
                    静止时只有刻度，不占正文位置；鼠标移上去才展开标题
                  </span>
                </span>
                <CheckIcon v-if="headingNav" class="ml-auto mt-0.5 size-3.5 flex-none text-foreground" />
              </button>

              <!-- 门槛跟着开关走：关掉时它没有意义，压暗并禁用，而不是藏起来（藏了会让人以为丢了设置项）。 -->
              <label
                class="mt-0.5 flex items-center justify-between gap-3 px-0.5"
                :class="headingNav ? '' : 'opacity-40'"
              >
                <span class="flex min-w-0 flex-col gap-0.5">
                  <span class="text-[12px] leading-[1.4] text-foreground">出现门槛</span>
                  <span class="text-[12px] leading-[1.45] text-muted-foreground">
                    标题数达到这个数才显示，最少 {{ HEADING_NAV_MIN_FLOOR }} 条
                  </span>
                </span>
                <Input
                  type="number"
                  min="1"
                  step="1"
                  class="w-16 flex-none text-center"
                  :model-value="headingNavMin"
                  :disabled="!headingNav"
                  @change="commitHeadingNavMin"
                />
              </label>
            </section>

            <section class="flex flex-col gap-2">
              <h3 class="text-[13px] font-medium text-foreground">字体</h3>
              <SheetDescription>候选列表读自本机已安装的字体。</SheetDescription>

              <div class="mt-0.5 flex flex-col gap-2">
                <div class="flex flex-col gap-1">
                  <span class="text-[12px] leading-[1.4] text-muted-foreground">内容</span>
                  <FontPicker
                    :model-value="contentFont"
                    :options="fonts"
                    kind="content"
                    @update:model-value="setContentFont"
                  />
                </div>
                <div class="flex flex-col gap-1">
                  <span class="text-[12px] leading-[1.4] text-muted-foreground">代码</span>
                  <FontPicker
                    :model-value="codeFont"
                    :options="fonts"
                    kind="code"
                    @update:model-value="setCodeFont"
                  />
                </div>
              </div>
            </section>

            <!-- 说明这次设置的作用范围：只影响编辑器，不进导出文件。 -->
            <p class="text-[12px] leading-[1.5] text-muted-foreground">
              此设置只影响编辑器里的显示。导出的 HTML 始终是规范形态，换台机器打开也不会变。
            </p>
          </div>

          <div v-else-if="activeSection === 'appearance'" class="flex flex-col gap-4 p-3.5">
            <section class="flex flex-col gap-2">
              <h3 class="text-[13px] font-medium text-foreground">主题</h3>
              <SheetDescription>界面配色。标签栏最右那颗按钮也能就地手动切。</SheetDescription>

              <div class="mt-0.5 flex flex-col gap-1.5" role="radiogroup" aria-label="主题">
                <button
                  v-for="option in THEME_MODE_OPTIONS"
                  :key="option.value"
                  type="button"
                  role="radio"
                  :aria-checked="theme.mode === option.value"
                  :class="[
                    'flex items-start gap-2.5 rounded-[9px] border p-2.5 text-left transition-colors',
                    optionClass(theme.mode === option.value),
                  ]"
                  @click="setTheme({ mode: option.value })"
                >
                  <component
                    :is="option.icon"
                    class="mt-0.5 size-4 flex-none text-muted-foreground"
                  />
                  <span class="flex min-w-0 flex-col gap-0.5">
                    <span class="text-[13px] leading-[1.4] text-foreground">
                      {{ option.label }}
                    </span>
                    <span class="text-[12px] leading-[1.45] text-muted-foreground">
                      {{ option.hint }}
                    </span>
                  </span>
                  <CheckIcon
                    v-if="theme.mode === option.value"
                    class="ml-auto mt-0.5 size-3.5 flex-none text-foreground"
                  />
                </button>
              </div>
            </section>

            <!-- 固定时间：只有两个时刻。先后顺序不限 —— 调度按时刻排序后取「最近一个已过」。 -->
            <section v-if="theme.mode === 'fixed'" class="flex flex-col gap-2">
              <h3 class="text-[13px] font-medium text-foreground">切换时刻</h3>
              <SheetDescription>到点换配色。两个时刻谁先谁后都行，跨零点会对上。</SheetDescription>

              <div class="mt-0.5 grid grid-cols-2 gap-2">
                <label class="flex flex-col gap-1">
                  <span class="text-[12px] leading-[1.4] text-muted-foreground">切浅色</span>
                  <Input
                    type="time"
                    :model-value="theme.lightAt"
                    @change="commitTime('lightAt', $event)"
                  />
                </label>
                <label class="flex flex-col gap-1">
                  <span class="text-[12px] leading-[1.4] text-muted-foreground">切深色</span>
                  <Input
                    type="time"
                    :model-value="theme.darkAt"
                    @change="commitTime('darkAt', $event)"
                  />
                </label>
              </div>
            </section>

            <!-- 日出日落：坐标 + 今日时刻。时刻是坐标填错时唯一的征兆，摆在输入框上面。 -->
            <section v-if="theme.mode === 'sun'" class="flex flex-col gap-2">
              <h3 class="text-[13px] font-medium text-foreground">位置</h3>
              <SheetDescription>日出日落按这个坐标算。不填就跟着系统时区走。</SheetDescription>

              <div class="mt-0.5 flex flex-col gap-2">
                <div class="flex items-baseline justify-between gap-2 text-[12px] leading-[1.4]">
                  <span class="text-foreground">{{ place.label }}</span>
                  <span class="truncate text-muted-foreground">{{ place.zone }}</span>
                </div>
                <div class="text-[12px] leading-[1.4] text-muted-foreground">
                  今日 {{ sunTodayText }}
                </div>

                <div class="grid grid-cols-2 gap-2">
                  <label class="flex flex-col gap-1">
                    <span class="text-[12px] leading-[1.4] text-muted-foreground">纬度</span>
                    <Input
                      type="number"
                      step="0.0001"
                      :model-value="place.latitude.toFixed(4)"
                      @change="commitCoordinate('latitude', $event)"
                    />
                  </label>
                  <label class="flex flex-col gap-1">
                    <span class="text-[12px] leading-[1.4] text-muted-foreground">经度</span>
                    <Input
                      type="number"
                      step="0.0001"
                      :model-value="place.longitude.toFixed(4)"
                      @change="commitCoordinate('longitude', $event)"
                    />
                  </label>
                </div>

                <Button
                  v-if="theme.latitude !== null"
                  variant="ghost"
                  size="sm"
                  class="justify-start gap-1 self-start px-2 text-[12px] text-muted-foreground"
                  @click="resetPlace"
                >
                  <RotateCcwIcon class="size-3.5" />
                  按系统时区
                </Button>
              </div>
            </section>

            <!-- 自动模式下手动切换到底是什么语义，只说一句 —— 它是这颗按钮最容易被误解的地方。 -->
            <p class="text-[12px] leading-[1.5] text-muted-foreground">
              自动模式下，标签栏那颗按钮只改当前这一段：到下一个切换点（日出、日落、固定时刻、
              系统外观翻转）就交回自动，设置里的选择不会被改掉。
            </p>
          </div>
        </ScrollArea>
      </div>
    </SheetContent>
  </Sheet>
</template>
