/**
 * File System Access API 的类型补丁。
 *
 * TS 内置的 `lib.dom` 只收了 `FileSystemHandle` / `FileSystemDirectoryHandle` 这一族
 * （见 lib.dom.d.ts 14626 行起），**没有**收「向用户要一个目录」的入口 ——
 * `showDirectoryPicker` 至今没进 WHATWG 的 DOM 标准，所以只能自己补。
 *
 * 只补缺的那一个签名：句柄类型、`createWritable`、异步迭代器全部复用内置定义，
 * 不另抄一套（抄了迟早跟标准漂移）。
 */

/** `showDirectoryPicker` 的选项。`mode: "readwrite"` 会在选择时就申请写权限。 */
interface DirectoryPickerOptions {
  /** 固定 id 让浏览器记住上次的目录，再次打开时直接落在那儿。 */
  id?: string
  mode?: "read" | "readwrite"
  /** 起始目录，可以是某个已有句柄，也可以是 `"documents"` 这类良构名字。 */
  startIn?: FileSystemHandle | string
}

interface Window {
  showDirectoryPicker(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>
}
