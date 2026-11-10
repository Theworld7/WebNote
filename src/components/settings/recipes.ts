/** 设置面板里「一行选项」的观感。选择组与开关行共用同一份选中态。 */
export const OPTION_ROW = "rounded-lg border p-2.5 text-left transition-colors"

/**
 * 选中时用边框 + 底色，不用对勾 —— 对勾放在左侧会与图标打架，
 * 放右侧又离文字太远；整行高亮更直白。
 */
export function optionRowClass(active: boolean): string {
  return active
    ? "border-foreground/25 bg-muted"
    : "border-line hover:border-foreground/15 hover:bg-muted/50"
}
