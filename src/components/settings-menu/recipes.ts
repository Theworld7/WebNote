/**
 * 设置菜单的观感配方。**只有这一处定义** —— 各块视图只声明自己有哪些字段。
 *
 * 三层：外框（`MENU_SHELL`，宽度由 `BlockMenu` 给）、分组标题 / 字段行、控件。
 * 类名都写成常量而不是各自在模板里重写，是因为原先有 36 份分组标题、20 份字段壳、
 * 13 份下拉控件分头维护 —— 改一次观感要摸 13 个文件，还摸不全。
 *
 * 圆角一律走 `--rad-*` 刻度（`rounded` 是 `--rad-control`，`rounded-md` 是 `--rad-md`），
 * 不写任意值：界面的圆角偏好得管得到菜单（ADR-0040）。
 */

/** 外框：浮岛圆角 + 双层阴影 + 一圈 hairline。宽度不由它管。 */
export const MENU_SHELL = "rounded-island p-1.5 shadow-pop ring-1 ring-line/70"

/**
 * 菜单项。勾选 / 单选类菜单项把它挂在 shadcn 的 item 上，与普通项对齐。
 *
 * 字号必须显式写：shadcn 的 `DropdownMenuItem` / `DropdownMenuCheckboxItem` 默认带
 * `text-sm`（14px），不覆盖的话同一张菜单里分组标题 11px、控件 12px、菜单项 14px，
 * 勾选项会比旁边的下拉控件大 2px。`cn()` 已把 `text-*` 档位登记进 font-size 组，
 * 所以这里的 `text-12` 能干净地顶掉默认的 `text-sm`。
 */
export const MENU_ITEM = "gap-2.5 rounded-md px-2 py-1 text-12"

/** 分隔线。 */
export const MENU_SEPARATOR = "mx-2 my-1 bg-line"

/** 分组标题（`MenuSection` 用的就是它）。 */
export const MENU_SECTION = "px-2 pb-1 pt-1.5 text-11 font-normal text-muted-foreground"

/** 字段行里的小字标签：贴在控件上方，不占一整行。 */
export const MENU_FIELD_LABEL = "mb-0.5 text-11 text-muted-foreground"

/** 字段行的壳。 */
export const MENU_FIELD = "px-2 pb-1.5"

/** 下拉控件。 */
export const MENU_CONTROL =
  "w-full cursor-pointer rounded border border-line bg-transparent px-1.5 py-1 text-12 outline-none"

/** 字段行里的说明文字（菜单底部那句解释）。 */
export const MENU_HINT = "px-2 py-1 text-11 leading-relaxed text-muted-foreground"

/** 工具条上那颗胶囊入口（「设置」「打开数据表」「添加歌曲」…）。 */
export const TOOL_PILL =
  "h-6 gap-1 rounded-full bg-popover px-2 text-12 text-muted-foreground hover:text-foreground"

/** 浮在卡片上的同一颗胶囊：多一层阴影，压得住底下的图。 */
export const TOOL_PILL_ELEVATED = `${TOOL_PILL} shadow-sm`

/** 不带底的胶囊：贴在表格 / 布局这类本身就是一块面的地方，再垫一层底色会显脏。 */
export const TOOL_PILL_PLAIN =
  "h-6 gap-1 rounded-full px-2 text-12 text-muted-foreground hover:text-foreground"
