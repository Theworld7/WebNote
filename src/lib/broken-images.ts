import { ref } from "vue"

/**
 * 加载失败的图片地址。
 *
 * 图片有好几种来源：数据表里的链接、歌单的在线封面、订阅块的头像。它们都挂在
 * 别人的服务器上 —— 断网、对方删图、防盗链、链接写错，都会让 `<img>` 变成一张
 * 裂图，而 `<img>` 失败时**不会**有任何提示，页面只是安静地少一块。
 *
 * 与其在每个视图里各摆一个破图标，不如按地址记下来，让视图自己的「没有图」分支
 * 接住（那些分支本来就有：占位图标、首字母、空白格）。
 *
 * 按地址而不是按行 id 记：同一张图失败一次就都失败，不必逐行重试。
 *
 * 这是**模块级单例**而不是 composable —— 一张图在画册里失败过，歌单里也不该再
 * 裂一次；每处各自持一份只是把同一个结论重算几遍。
 */
const broken = ref<ReadonlySet<string>>(new Set())

/** 记下一个画不出来的地址。视图的 `@error` 直接调它。 */
export function markImageBroken(src: string): void {
  if (src === "" || broken.value.has(src)) return
  const next = new Set(broken.value)
  next.add(src)
  broken.value = next
}

/**
 * 这个地址还能不能画。失败过的一律当作空串 —— 调用方的 `v-if="src !== ''"` /
 * `v-else` 占位照旧生效，不需要为「裂图」再写一套分支。
 */
export function usableImage(src: string): string {
  return src === "" || broken.value.has(src) ? "" : src
}
