# AGENTS.md

玉简(代号 WebNote):本地优先的块式笔记编辑器。笔记 = 磁盘上的普通 `.html` 文件,就地读写,盘上 HTML
即规范形态;数据表 `.tbl`(标准 JSON)是独立文档,可被任意多篇笔记同时引用;Markdown(`.md` /
`.markdown`)只读浏览,可转成同目录同名的 HTML 笔记。
技术栈:Tauri 2 + Vue 3 + TypeScript(strict)+ Tailwind v4,包管理用 pnpm。

## 读代码前

- **领域词汇** —— 命名、注释、UI 文案之前读 [GLOSSARY.md](GLOSSARY.md)。每个术语带「避免用词」
  (Block 不叫 element,Data table 不叫 sheet,Preference 不叫 setting),照它选词。
- **硬约定** —— [README「架构约定」](README.md) 一节:单一真源(块类型、路径格式、列类型各只有
  一处定义)、正文是 `InlineRun[]` 不是字符串、`contenteditable` 非受控、行内格式走 runs 不走
  `execCommand`、引用块的 `entry` 必须 `shallowRef`、读盘留在 composable / 拼 HTML 留在纯函数。
  动到这些区域先读原文,本文件不复述细节。
- **决策记录** —— `docs/adr/`:树拖拽是移动非重排(0003)、重名直接拒绝(0002)、新建后单层重扫
  (0001)、浏览器适配器伪造移动(0004)、数据表是独立文件(0005)、画册快照+指针(0006)、布局块是
  唯一受控容器(0007)、看板拖拽改值(0008)、账目块按财务口径渲染数据表(0009)、主题色取图标背景
  色(0010)、页面样式是文档级的 `<style>` 且编辑器内按正文列预览、页面样式里的浅深两套按应用
  外观解析(0011)、页面样式只在编辑期格式化、落盘压成单行(0012)、HTML 块的沙箱 iframe 带着
  页面样式重新生成、块里那张纸也跟应用外观走(0013)、外观是一份带调度的偏好且手动切换只覆盖
  当前时段(0014)、转换是换一个新块所以焦点按返回的 id 找(0015)、账目块按选定列排序且
  缺省最新在前(0016)、代码块静态态单层高亮、按需挂**全应用唯一**一个 Monaco 编辑(0017)、
代码块的格式化只在按按钮时跑、结果留在缓冲等提交(0018)、代码块的语法配色是我们自己的 token
而非引主题文件、深色另取一套(0019)、原生 select 的弹层靠元素底色与 option 显式色上色、
静止态不填底(0020)、行内链接单击即跳、工作区文档在应用内开标签(0021)、块类型的行为分派
保持显式穷举而不用查表(0022)、引用块的设置两侧各手写读写而不合成 schema(0023)、窗口 chrome
只有一条且标签条不自带浮岛外壳(0024)、正文能写进去的颜色也是 token 且都有明暗两套、装饰面
用 tint 而 selection 只表示选中、行内色按 `data-run-color` 换深色(0025)、深色的面层级是一条
  单调向上的色阶（画布 < 页面底 < 卡片 < 浮层）、浮起面用 popover 而阴影走 `--elev-*` 间接(0026)、
  字号是九档阶梯且不落半像素、h4~h6 靠字重与颜色分、字体栈只存一份（CSS 那份由自检页钉住）、
  版心 720px 与标准档同源(0027)、块框选只收基础/列表两组、逐块换类型不合并、矩形只比纵向(0028)、
  标签行独立在标题栏之下、标题栏中段整段留给拖拽(0029)、新版本只提示不代劳:按钮落在撤销重做
  簇右端、查不到就是没有(0030)、手动检查更新住在设置「关于」里、第一次之后的请求都带
  `If-None-Match`（304 不占限额）、每次按下都以一条瞬态提示收尾(0031)、主路没给出结论就问
  jsDelivr 上的 `package.json`、镜像只往「有更新」下结论且链接退回列表页(0032)、标签住在编辑
  卡片的第一行、chrome 只剩一条标题栏(0033)、记一笔曾是模态表单(0034)、记一笔是行内草稿行:
  插在列表顶端、焦点离开这一行才按排序归位、一格没填就自动删掉(0035)。
  改对应行为前先读那篇。(0029 的标签位置已被 0033 取代,0034 的模态表单已被 0035 取代)

## 验证

没有测试框架,回归靠两条:

1. **类型门**:`pnpm build`(vue-tsc)。全项目零类型断言 —— 不写 `as`、不写 `@ts-ignore`,
   用类型收窄和类型守卫表达。
2. **自检页**:`design/*.html` 是能直接跑的回归页,每个用例输出 `OK` / `FAIL` 行。
   `pnpm dev` 后访问 `/design/<名字>.html`;其中 `drag-check`、`typography-check`、
   `data-table-check`、`ledger-edit-check`、`ledger-entry-check`、`ledger-date-check`、`kanban-date-check`、`option-cell-check`、`playlist-edit-check`、`menu-nav-check`、`link-check`、`block-select-check`、`tab-housing-check` 含顶层 `await`,要抓结果用
   `node design/cdp-dump.mjs http://localhost:1420/design/<名字>.html`。

改哪层跑哪页:动 `lib/html` → `parse-check`;动块拖拽 / 标签栏 → `drag-check` / `tab-check`;
动窗口 chrome(品牌名 / 全局动作 / 拖拽面 / 字数 / 页面样式入口)→ `chrome-check`;
动标签的落位(编辑卡片第一行长什么样、塞满时在卡片里滚动)→ `tab-housing-check`(挂真实
标题栏与编辑卡片,走 CDP);
动文件树的整合数据表视图（笔记隐后缀、引用表收进笔记名下、展开箭头）→ `tree-integration-check`;
动块菜单的方向键寻路(`lib/menu-nav.ts`、横向布局的列间移动)→ `menu-nav-check`(挂真实菜单,
走 CDP);动右侧标题导航(收录范围 / 出现门槛 / 点击跳转 / 激活跟随滚动,`lib/headings.ts`、
`components/HeadingNav.vue`)→ `heading-nav-check`(挂真实编辑器,走 CDP);
动数据表 → `data-table-check`;动排版样式 → `typography-check`;动新建 / 移动 →
`create-check` / `move-check`;动 Markdown 导入 / 导出(`lib/markdown/*`、`lib/fs/transfer.ts`)→
`markdown-check`;动 Markdown 浏览 / 转笔记(`lib/markdown/render.ts`、`components/MarkdownView.vue`、
树上 `.md` 节点、`convertMarkdownToNote`)→ `markdown-check`(预览 HTML 与消毒)、
`markdown-view-check`(挂真实编辑器，排版 / 消毒 / 转笔记)、
`create-check`(扫描 / 打开 / 同目录转换)、`tree-integration-check`(整合视图保留 `.md`);
动设置 → `settings-check`;动布局块 → `layout-check`;
动新版本检测(`lib/update.ts`、`composables/useUpdateCheck.ts`、`components/NewVersionButton.vue`)
→ `update-check`(版本号比较 / release 解析 / 手动检查的三种结论 / 按钮行为),按钮在标题栏里的
落位 → `chrome-check`,设置里的入口 → `settings-check`;
动代码块的编辑态 / 格式化 / 静态配色(`lib/monaco-code.ts`、`lib/source-format.ts`、
`style.css` 里的 `--color-code-*`)→ `code-edit-check`(挂真实编辑器,走 CDP 驱动);
动对比度 / 配色 token → `theme-check`、`code-edit-check` 的第十节;
动落块 / 转换之后的焦点(菜单插入、`/` 转换、`转为…` 子菜单、Esc 关菜单)→ `focus-check`;
动块框选(空白处起的矩形、`lib/block-select.ts`、`retypeBlocks` / `removeBlocks`、选区浮条)→
`block-select-check`(挂真实编辑器,走 CDP 驱动);
动格子的增删行为 → `cell-check`(挂真实编辑器,走 CDP);动行内链接的样式 / 单击跳转
(`lib/link.ts`、`lib/open-external.ts`、`linkHrefOf`)→ `link-check`(挂真实编辑器,走 CDP);
动选择格的键盘模型 / 浮层落位(`components/OptionCell.vue`、`lib/floating.ts`)→
`option-cell-check`(组件级,不借账目夹具);动账目块的财务口径 → `ledger-check`,动它的就地增删改 →
`ledger-edit-check`,动记一笔的草稿行(顶端落位 / 横着填 / 归位排序 / 空行自动删)→
`ledger-entry-check`,动日期面板 / 编辑期钉住排序 → `ledger-date-check`(都挂真实编辑器,走 CDP 驱动);
动日期格的月历浮层本身(`composables/useDateCellPanel.ts`,账目行与看板卡共用)、
它的键盘导航(`lib/date-key.ts` 的日期算术、`DateCalendar.vue` 的高亮环)→ 两页都跑;
动看板卡的逐格编辑 → `kanban-date-check`(挂真实编辑器,走 CDP 驱动);动歌单块的字段识别 / 在线封面 / 多表绑定的落盘形态(`lib/playlist.ts`)→
`playlist-check`,动它的标签切换 / 加歌 / 删歌 / 解除绑定 / 搜索 / 复制纯文本 → `playlist-edit-check`(挂真实编辑器,走 CDP 驱动);动主题色 / 品牌色 → `theme-check`(对齐图标 tokens,守对比度);动外观 / 主题模式 / 定时与
日出日落 → `theme-mode-check`(挂真实标签栏,含太阳位置与时区);动页面级样式
(读写、预览改写、chrome 入口、编辑期格式化与落盘紧凑、页面样式对 HTML 块生效)→ `page-style-check`
(挂真实编辑器,走 CDP 驱动),改写规则与紧凑化本身在 `parse-check`;动 HTML 块的沙箱文档 /
高度探针 / 块里那张纸(画布底色与 `pinScheme`)→ `html-check`;动源码抽屉(打开 / 提交 / 取消)或抽屉里 Monaco 的配色
(`lib/monaco-theme.ts`)→ `html-drawer-check`。
自检页清单见 README「自检」一节,每页具体断言读该页脚本里的 `check(...)` 用例。

## 写代码

- 注释与 UI 文案用中文;注释写「为什么」和设计立场,不逐行复述代码。
- `pnpm dev` 走浏览器文件系统实现(伪造盘上行为,调试用);验证真实的读写与移动要跑
  `pnpm tauri dev`。两份 `WorkspaceFs` 实现共用 `lib/fs/policy.ts` 的过滤与排序。
- Tauri(Rust)侧保持薄:只做目录授权、目录扫描、文本读写;业务逻辑都在前端。
- 应用图标的真源是 `design/icon/icon.tokens.json`,改后跑 `pnpm icon`;
  `src-tauri/icons/` 下的产物不手改。