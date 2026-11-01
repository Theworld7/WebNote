import { ref } from "vue"
import { BASE_FONT_REFERENCE_PX } from "./typography"

/**
 * 当前基础字号（px）。
 *
 * **模块级 ref，不走 provide/inject**：读它的组件（代码块、HTML 块）只是想知道「根字号
 * 现在多大」，不该因此要求调用方提供整个设置上下文 —— 自检页挂这些块时没有 provider，
 * 注入会当场抛错，而那跟字号一点关系都没有。
 *
 * 写入只有一处：`useSettings` 里那个把档位落到 `<html>` 上的 watcher。默认值就是标准档，
 * 没开设置面板时读到的也是正确值。
 */
export const rootFontPx = ref(BASE_FONT_REFERENCE_PX)

export function setRootFontPx(value: number): void {
  rootFontPx.value = value
}
