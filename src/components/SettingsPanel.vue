<script setup lang="ts">
import type { ContentWidth, MenuGroupLayout, TableEffect } from "@/composables/useSettings"
import type { Component } from "vue"
import { onMounted, ref } from "vue"
import { CheckIcon, Columns2Icon, ListIcon, MoveHorizontalIcon, WrapTextIcon, XIcon } from "@lucide/vue"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet"
import { CONTENT_WIDTH_PX, useSettings } from "@/composables/useSettings"
import { listSystemFonts } from "@/lib/fonts"
import FontPicker from "./FontPicker.vue"

/**
 * 设置面板。
 *
 * 结构固定成「左侧分区 + 右侧内容」两栏：现在只有一个「显示」分区，但设置项
 * 天然会长，先把骨架立住比事后改结构便宜。分区只有一项时不隐藏分区栏 ——
 * 藏起来会让后面加第二个分区时面板宽度突然变化。
 *
 * 面板本身不持有任何状态：开着关着由调用方（`EditorTabBar`）的 `v-model:open` 控制，
 * 设置值直接读写 `useSettings()`，所以关掉再打开不会丢，也不需要「应用 / 取消」。
 */
const open = defineModel<boolean>("open", { required: true })

const { tableEffect, setTableEffect, contentWidth, setContentWidth, menuGroupLayout, setMenuGroupLayout, contentFont, setContentFont, codeFont, setCodeFont } = useSettings()

/**
 * 本机字体列表。打开面板时才去取（桌面端要扫一遍系统字体），拿到之前选择框里
 * 只有「系统默认」一项 —— 用户可以就地等一下，不会看到空下拉。
 * 取不到时 `listSystemFonts` 自己降级，这里不需要错误分支。
 */
const fonts = ref<string[]>([])
onMounted(() => {
  void listSystemFonts().then((names) => (fonts.value = names))
})

/** 分区。加新分区时在这里加一条，右侧内容按 `CURRENT` 分派。 */
const SECTIONS = [{ id: "display", label: "显示" }] as const

/** 当前分区。只有一个分区时它恒为首项；将来多个分区改成 `ref` 并接上点击即可。 */
const CURRENT = SECTIONS[0].id

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
 * 画出来比任何象形图标都直白;`standard` 就是这个偏好出现之前的 800px。
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
            <XIcon class="size-[15px]" />
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
              sectionClass(section.id === CURRENT),
            ]"
          >
            {{ section.label }}
          </button>
        </nav>

        <!-- 内容区 -->
        <ScrollArea class="min-h-0 flex-1">
          <div v-if="CURRENT === 'display'" class="flex flex-col gap-4 p-3.5">
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
                    <span class="text-[11.5px] leading-[1.45] text-muted-foreground">
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
                  <span class="text-[11.5px] leading-[1.45] text-muted-foreground">
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
                  <span class="text-[11.5px] leading-[1.45] text-muted-foreground">{{ option.hint }}</span>
                </button>
              </div>
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
            <p class="text-[11.5px] leading-[1.5] text-muted-foreground">
              此设置只影响编辑器里的显示。导出的 HTML 始终是规范形态，换台机器打开也不会变。
            </p>
          </div>
        </ScrollArea>
      </div>
    </SheetContent>
  </Sheet>
</template>
