# WebNote

本地优先的 HTML 笔记编辑器。笔记就是磁盘上的普通 `.html` 文件，应用只做**就地读写** ——
没有私有格式、没有数据库、没有云端账号，删掉这个应用，那些文件照样能双击打开。

## 技术栈

| 层 | 选型 |
|---|---|
| 外壳 | Tauri 2（Rust 侧只做目录授权、目录扫描与文本读写） |
| 前端 | Vue 3 + TypeScript（`strict` + `noUnusedLocals`，全项目零类型断言） |
| 构建 | Vite + pnpm |
| 样式 | Tailwind v4 + shadcn-vue（neutral 主题） |

## 开发

```bash
pnpm install
pnpm tauri dev     # 桌面端：Rust + WebView
pnpm dev           # 只跑前端，走浏览器文件系统实现（调试用）
pnpm build         # vue-tsc 类型检查 + vite build
```

## 现在能做什么

- **块模型编辑**：文本、H1–H3、待办、无序 / 有序列表、引用、代码块、标注、分割线、图片、表格
- **行内格式**：加粗、高亮 —— 选中文字浮出格式条，键盘走 `Cmd/Ctrl+B` 与 `Cmd/Ctrl+Shift+H`
- **文件侧**：左侧目录树、标签栏、未保存标记、关标签时拦截确认，新建笔记 / 文件夹，拖动笔记进出文件夹
- **格式透明**：读的是通用 HTML（`<p>` / `<h2>` / `<ul>` / `<table>` / `<mark>` …），
  别人的文档导进来会被规范化成本项目的写法
- **设置**：浮岛右侧齿轮打开右侧抽屉，分区（当前只有「显示」）+ 选项。首项为
  **显示 → 表格效果**：`内容自适应换行不滚动`（默认）/ `表格滚动`。改设置只影响编辑器显示，
  不写盘、不进笔记文件 —— 导出永远是规范形态，保证「同一个文件在哪台机器上打开都一样」。
  滚动模式把系统那条 15px 粗滚动条换成 6px 圆角细条（无箭头、色压淡），并用 8px 下内边距
  把它从表格底边推开（与表格外框圆角同档，不切进弧线），在「右边还有内容」时于右缘压一层内阴影

## 架构约定

项目小，但有几条硬约定，改代码前值得先读：

- **单一真源**。块类型标识符只在 `lib/blocks.ts` 的 `BLOCK_TYPES`；工作区路径格式只在
  `lib/paths.ts`；目录扫描的过滤与排序只在 `lib/fs/policy.ts`（桌面端与浏览器端两份
  `WorkspaceFs` 实现共用）；「什么算列表族」只在 `isListBlock()` 一处。
- **正文是 `InlineRun[]`**，不是字符串。需要纯文本时投影（`runsText` / `blockText`），
  不另存一份字符串字段。
- **`contenteditable` 必须非受控**：DOM 只在 `onMounted` 写一次，Vue 不回写；格式化后由
  编辑逻辑自己重画并复原选区。
- **行内格式走 runs，不走 `execCommand`**：后者产出 `<b>` / `<span style>`，与序列化产物
  对不上，且各 WebView 行为不一致。
- **有序列表序号与序列化的分组对齐**：`orderedIndexes()` 镜像 `blocksToHtml` 的建树规则，
  所以**不相邻的 `<ol>` 各自从 1 起**。两边漂移会让编辑器显示的数字与导出文件里的对不上。

## 自检

`design/*.html` 是能在浏览器里直接跑的自检页（`pnpm dev` 后访问 `/design/<名字>.html`）：

| 页面 | 覆盖 |
|---|---|
| `parse-check.html` | 解析 / 序列化的往返一致性、宽松解析、序列化产物、有序列表编号 |
| `inline-check.html` | 真实 `contenteditable` + Range：选区 ↔ 字符偏移、标记切换与切分 |
| `tab-check.html` | 标签栏保存按钮的显隐规则（挂真实组件驱动状态） |
| `drag-check.html` | 块拖拽的落点线：位置计算、松手提交、非块拖拽不放行（合成 `DragEvent` 走真实 handler） |
| `typography-check.html` | 排版规格：各级字号 / 行高 / 字重、块间距（含 margin 折叠）、手柄与列表标记的纵向居中、引用与行内 code 的形态、导出文件同一套规格 |
| `create-check.html` | 新建：名字合法性（非法字符 / 保留名 / 首尾空格）、重名与「文件 vs 文件夹同名」拒绝、写盘后单层重扫、文件夹行 `+` 与顶部全局 `+` |
| `move-check.html` | 移动：`migratePath` 前缀边界、合法/非法落点、冲突拒绝、同目录空操作、源行与落点高亮、五个以路径为键的状态整体换键（含保存落到新路径） |
| `settings-check.html` | 设置：默认值、面板两选项与勾选态、切换落盘（`webnote:table-effect`）、**两种表格效果的实际渲染几何**（换行=不超容器 / 滚动=撑开且容器可横向滚动）、**细滚动条**（类名挂上、样式表有 6px 的 `::-webkit-scrollbar`、滚动条占高 ≈6px、未退回原生粗条）、**滚动条与表格的间距**（容器下内边距 = 8px、表格底边与滚动条之间有间距）、**右端内阴影的显隐跟随滚动位置**（不在最右显示、最右隐藏、换行模式不出现）及其底边避开滚动条、非法存量值退回默认 |
| `table-align-check.html` | 表格：列对齐模型（整列一起写、插行列继承）、编辑器与导出的对齐一致、外框/内线/四角内弧的几何 |

页面会把每个用例输出成 `OK` / `FAIL` 行，便于用无头浏览器 `--dump-dom` 抠出来做回归。

> `drag-check.html` 与 `typography-check.html` 要等一次真实读盘（`bootstrap` → 扫目录 → 读笔记），
> 脚本里有顶层 `await`，`--dump-dom` 在 load 时就 dump 了、抓不到结果。用配套的 CDP 驱动：
> `node design/cdp-dump.mjs http://localhost:1420/design/drag-check.html`。
> 想看排版观感就加个环境变量整页截图：`SHOT=/tmp/x.png node design/cdp-dump.mjs <url>`。

> `src/data/notes/**` 是本地私人的测试工作区，已从仓库排除。缺它时 `parse-check.html`
> 会改跑内置样本，不会因此变红。
