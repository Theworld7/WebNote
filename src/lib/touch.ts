/**
 * 触摸长按的按住时长。
 *
 * reka 的 `ContextMenu` 默认 `pressOpenDelay = 700`，比系统长按长得多（iOS / Android 都在
 * 500 上下），按住时那 700ms 是最难受的一段纯等待。三个菜单入口（文件夹行 / 文件行 / 标签）
 * 统一传这个值。
 *
 * **样式那一半必须跟它同步**：行与标签上的 `data-[pressed]:duration-500` 就是这条蓄力过渡
 * —— 按下后底色在这段时间里推向 `muted-strong`，到点正好弹菜单。两处数字分别落在 TS 与
 * class 里，`context-menu-check` 会把它们对账，改一边不改另一边会红。
 */
export const LONG_PRESS_MS = 500
