/**
 * app 层的按钮形状刻度。**不改 `buttonVariants` 的 cva**：那是 shadcn CLI 的生成物，
 * `add` 一次就可能被覆盖，而且它给的是通用四档（`h-8 / text-sm / rounded-lg`），
 * 与本项目真正用的三档（`h-6 / h-7 / h-8` + 九档字号的 `text-12 / text-13`）不是一套数。
 * 结果就是每个调用点都得补一串 class 才能把按钮拉回设计里的样子 —— 原来 101 处
 * `<Button>` 有 100 处带 class。与其重定义上游，不如把「补的那一串」变成有名字的刻度。
 *
 * 圆角一律用 `--rad-*` 刻度类（`rounded / rounded-md / rounded-lg`），不写任意 px：
 * 界面圆角偏好要管得到按钮（ADR-0040）。原先的 5/7/10px 恰好是 medium 档三档的
 * 近似值，换档时不动、切到「直角」时却不会归零 —— 就是那个漏网。
 */

/** 24px 见方的图标按钮：块手柄、格式条、抽屉关闭、标题栏动作。 */
export const BTN_ICON = "size-6 rounded p-0 text-muted-foreground hover:text-foreground"

/** 24px 高的紧凑文字按钮：格式条的输入框旁、链接气泡。 */
export const BTN_COMPACT = "h-6 rounded px-2 text-12 text-muted-foreground hover:text-foreground"

/** 24px 高的小文字按钮：批量操作条这类带图标 + 文案的行内入口。 */
export const BTN_MINI = "h-6 gap-1 rounded px-2 text-12"

/** 28px 高的表格 / 表单行内按钮。 */
export const BTN_FIELD =
  "h-7 gap-1 rounded-md px-2 text-12 text-muted-foreground hover:text-foreground"

/** 28px 高的对话框确定 / 取消按钮。 */
export const BTN_DIALOG = "h-7 px-3 text-13"

/** 32px 高的首页大按钮。 */
export const BTN_BLOCK = "h-8 gap-1.5 rounded-lg px-3.5 text-13"

/** 只把上游的 `text-sm` 换回项目九档里的 13px。 */
export const BTN_TEXT = "text-13"
