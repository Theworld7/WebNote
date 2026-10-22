/**
 * 工作区领域模型。
 *
 * 三条约定：
 *
 * 1. **类型标识符只有一个真源**。菜单项、marker、`/` 转换菜单全部从 `BLOCK_TYPES`
 *    （见 `@/lib/blocks`）派生，避免原型阶段出现过的「类型定义 / CSS / 菜单三处标识符
 *    不一致」问题。
 * 2. **`Block` 是四形态可辨识联合**，`type` 同时充当判别式：`image` / `table` / `mermaid`
 *    各自独占自己的字段，其余十三种走 `TextualBlock`。判别式让编译器兜住穷尽性，因此
 *    全项目不需要一处类型断言。
 * 3. **正文是 `InlineRun[]` 而不是字符串**。解析静态 HTML 必须装得下行内标记
 *    （加粗 / 链接 / 行内代码），一旦只存纯文本，解析结果的信息量就被截断了。
 *    需要纯文本时用 `runsText()` / `blockText()` 投影，不要再另存一份字符串字段 ——
 *    两份表达同一内容必然漂移。
 */

/** 行内标记。链接不在此列 —— 它由 `InlineRun.href` 表达，避免「有 link 标记却没地址」的非法态。 */
export type InlineMark = "bold" | "highlight" | "italic" | "underline" | "strike" | "code"

/** 链接的展示形态。缺省 `text`（普通文字链接）；`card` 渲染为上图标下名称的书签卡片。 */
export type LinkShape = "text" | "card"

/**
 * 块内一段连续文本及其生效的行内标记。
 *
 * 规范化不变式（由 `normalizeRuns()` 保证，解析与编辑回读都必须过一遍）：
 * - `text` 非空；
 * - `marks` 已去重，且按 `INLINE_MARK_ORDER` 排序 —— 顺序影响序列化产物，所以不能留给调用方；
 * - 相邻 run 的「标记 + href + 颜色」必然不同，否则已合并。
 */
export interface InlineRun {
  text: string
  marks: InlineMark[]
  /** 有值即为链接（解析自 `<a href>`）。空串按无链接处理。 */
  href?: string
  /** 仅链接使用。缺省即 `text`，缺省态不落盘（对齐其它「非默认值才写出」的属性立场）。 */
  linkShape?: LinkShape
  /** 有值即为文本着色（解析自 `<span style="color:…">`）。空串按默认色处理。 */
  color?: string
}

/** 可承载正文的块类型。`divider` 也在内 —— 它只是正文恒为空。 */
export type TextualBlockType =
  | "text"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "todo"
  | "ul"
  | "ol"
  | "quote"
  | "code"
  | "callout"
  | "divider"

/** 全部块类型 = 正文类 + 结构类。派生而常量列表，避免两处维护。 */
export type BlockType = TextualBlockType | "image" | "table" | "mermaid" | "datatable" | "gallery" | "bookmark" | "kanban" | "ledger" | "stat" | "subscription" | "playlist" | "chat" | "layout" | "html"

/** 正文块。块之间是平铺列表；列表的嵌套层级用 `depth` 表达，不建树。 */
export interface TextualBlock {
  id: string
  type: TextualBlockType
  runs: InlineRun[]
  /** 列表 / 待办的缩进层级，0 起。其它类型恒为 0。 */
  depth: number
  /** 仅 `todo` 使用。 */
  checked?: boolean
  /** 仅 `code` 使用：语言标识，序列化成 `<code class="language-x">`。 */
  lang?: string
}

/** 图片块。`src` 可以是磁盘相对路径，也可以是 data URI。 */
export interface ImageBlock {
  id: string
  type: "image"
  src: string
  alt: string
  title: string
}

/** 单元格水平对齐。取值只有三档，UI 与序列化都按这三档走。 */
export type TableAlign = "left" | "center" | "right"

/** 表格单元格。`header` 对应 `<th>`。 */
export interface TableCell {
  header: boolean
  runs: InlineRun[]
  /**
   * 水平对齐。**缺省即 `left`**，且左对齐不落存储（解析、设置都把它归成「未设置」）——
   * 三处口径必须一致：模型里没有 `"left"`、序列化不为它写 `style`、导出靠 DOC_STYLE
   * 里 `th, td { text-align: left }` 兜默认。
   */
  align?: TableAlign
}

/** 表格块。单元格按 `rows[行][列]` 索引；整表是一个原子块，不拆成多块。 */
export interface TableBlock {
  id: string
  type: "table"
  rows: TableCell[][]
}

/**
 * Mermaid 图块。
 *
 * 源码是**纯字符串**而不是 `InlineRun[]`。两个原因：`*` `_` `-` `#` 在 mermaid 里是
 * 语法字符，走 runs 会被行内标记解析吃掉；而且图源码永远不需要加粗 / 链接这类富文本。
 * 这也是它与 `code` 块的分别 —— 那边承载的是可被行内格式化的正文。
 */
export interface MermaidBlock {
  id: string
  type: "mermaid"
  /** mermaid 源码，原样保存（含换行与缩进）。 */
  source: string
}

/**
 * 数据表引用块。
 *
 * 只带一个**工作区路径**，不带任何记录 —— 记录留在那个 `.tbl` 文件里（见 ADR-0005）。
 * 这是它和 `TableBlock` 的根本分别：`TableBlock` 的数据是笔记的一部分，这个块的数据
 * 是**别人的**，因此同一张表出现在两篇笔记里时是同一张表，从哪边改都是同一次改动。
 *
 * 路径失效（文件被移走、改名或删除）是**正常状态**，不是错误：块照常渲染成提示态，
 * 不把笔记标成损坏，也不拦着打开（见 `CONTEXT.md` 的「Missing Data table」）。
 */
export interface DataTableBlock {
  id: string
  type: "datatable"
  /** 被引用的 `.tbl` 文件的工作区路径。 */
  path: string
}

/**
 * 画册块:把一张数据表渲染成海报卡片宫格。
 *
 * 数据同样**只在** `.tbl` 里(与 `DataTableBlock` 同源,见 ADR-0005),块上只带
 * 引用路径和一组**展示设置**。设置是块的一部分,跟着笔记走 —— 这也是它和
 * `DataTableBlock` 在盘上形态上分道扬镳的原因:
 *
 * `DataTableBlock` 导出成纯快照表格、引用不进文件(没有设置可丢,不值得);画册块的
 * 列数、比例、填充方式、字段显隐丢了要重新配,所以导出时以 `data-*` 属性把路径与设置
 * **一并**写进快照(内容照写,「双击可读」承诺不变)—— 快照与指针并存,详见 ADR-0006。
 */
export interface GalleryBlock {
  id: string
  type: "gallery"
  /** 被引用的 `.tbl` 文件的工作区路径。 */
  path: string
  /** 列数:`"auto"` 响应式(容器多宽就放几列),数字为固定列数(1..12)。 */
  columns: "auto" | number
  /** 卡片图片区的显示比例,`"宽:高"` 写法,如 `"2:3"` 海报(默认)。高度随列宽走。 */
  ratio: string
  /** 卡片图片的填充方式:`cover` 裁剪填满(默认),`contain` 完整显示。 */
  fit: "cover" | "contain"
  /** 卡片图片宽度:相对卡片内容宽度的百分比(10..100),100(默认)= 铺满。窄于卡片时水平居中。 */
  width: number
  /** 隐藏字段的列 id。默认空 = 全显;删列后残留的 id 在渲染时按当前列过滤,无需清洗。 */
  hiddenFields: string[]
  /** 聚合展示的参考列 id。空 = 关闭聚合;指向的列被删后渲染时自然退化为平铺,无需清洗。 */
  group: string
  /** 分组展示的参考列 id。空 = 关闭分组;可与聚合叠加(不同字段),同字段时以设置层「后设的赢」保证不撞。 */
  groupBy: string
  /** 分组节的手排顺序:组原始值(文本列即其文本,select 列即选项 id)的有序列表。列表外的组跟首现序排在后面,无需清洗。 */
  groupOrder: string[]
}

/**
 * 书签块:把一张数据表的每一行渲染成一张横向信息卡(左图标、右侧名称与域名)。
 * 展示设置是块的属性 —— 名称列、链接列、图标列、列数,指向同一张 `.tbl` 的多个
 * 书签块可以各挑各的字段。编辑表单不受这些设置限制,按列类型铺开整张表的字段。
 */
export interface BookmarkBlock {
  id: string
  type: "bookmark"
  /** 被引用的 `.tbl` 文件的工作区路径。 */
  path: string
  /** 名称列的列 id。列被删后值为空,渲染时退化为「未设置」提示态,无需清洗。 */
  nameColumn: string
  /** 链接列的列 id。链接就存在文本列的值里 —— 数据表的值模型没有链接类型。 */
  urlColumn: string
  /**
   * 图标列的列 id。缺省(未设置)按链接派生图标(见 `linkIcon`);设了就把该列的值
   * 当图标:能加载成图片(data URI / URL)且加载成功展示图片,否则取文本首字符,
   * 再不行回退链接派生。缺省不落盘,与 linkShape 同一立场。
   */
  iconColumn?: string
  /**
   * 分组字段的列 id。缺省(未设置)平铺展示;设了按该列的值分节,节序跟值首次出现序,
   * 空值行收进末尾的「未分组」节,与画册块的分组同一套口径。缺省不落盘。
   */
  groupBy?: string
  /** 列数:`"auto"` 响应式(容器多宽就放几列),数字为固定列数(1..12)。 */
  columns: "auto" | number
}

/**
 * 看板块:把一张数据表按某列的值分成若干列(分组),每行渲染成一张便签贴纸卡,
 * 卡片可以跨列拖拽 —— 拖到哪一列就把该行的分组列值改成那一列的值(见 ADR-0008)。
 *
 * 与画册块 / 书签块同源:数据只在 `.tbl` 里(ADR-0005),块上只带引用路径与一组
 * **展示设置**。设置跟着笔记走,同一张表在两篇笔记里可以有两套不同的看板外观
 * (不同的分组列、不同的卡片字段),正如画册的列数与比例是块的属性。
 *
 * 导出形态与画册同一条 ADR-0006 立场:快照 + 指针 —— 内容写成一张普通快照表格
 * (双击可读全数据),`data-kanban` / `data-group` / `data-fields` 把路径与设置一并写进,
 * 编辑器据此还原成活的看板块;第三方编辑器剥掉属性后剩下的就是一张普通表格,
 * 按表格读是「正确的读法」(与数据表引用块的快照例外同一立场)。
 *
 * 拖拽改值只动**分组列**:这是看板的核心交互,其余字段的编辑去数据表编辑页或
 * 画册/书签块。卡片背景色由行 id 哈希出固定浅色(同卡每次同色,导出 HTML 不带颜色
 * —— 颜色是视图态,不进 `.tbl` 也不进笔记)。
 */
export interface KanbanBlock {
  id: string
  type: "kanban"
  /** 被引用的 `.tbl` 文件的工作区路径。 */
  path: string
  /** 分组列的列 id。空 = 尚未选分组列(视图显示提示态引导去设);列被删后渲染时自然退化为「未分组」一列,无需清洗。 */
  groupColumnId: string
  /** 卡片上显示的列 id(有序)。空 = 全显(分组列本身除外);删列后残留的 id 在渲染时按当前列过滤,无需清洗。 */
  displayColumnIds: string[]
  /** 分组列的手排顺序:组原始值(文本列即其文本,select 列即选项 id)的有序列表。「未分组」列不参与手排恒在最左;列表外的组跟首现序排在后面,无需清洗。 */
  groupOrder: string[]
  /** 是否显示没有卡片的空分组(select 分组列:选项存在但没有行落在它上面;「未分组」列同理)。默认 false —— 空列没有任何可看的,默认不占地方。 */
  showEmptyGroups: boolean
}

/**
 * 账目块的分组方式。`none` 平铺;`month` 按日期列派生 YYYY-MM 节;`column` 按某列的值分节。
 */
export type LedgerGroupMode = "none" | "month" | "column"

/**
 * 账目块的排序方向。缺省 `desc` —— 流水账的读法是「最近一笔在眼前」;正序是补查旧账的读法。
 */
export type LedgerSortDirection = "asc" | "desc"

/**
 * 账目块:把一张数据表按财务口径渲染成流水账 —— 收入列 / 支出列求和、逐行累计的
 * 余额列、分组节小计与底部合计,金额统一 ¥ 千分位两位小数。
 *
 * 与画册 / 书签 / 看板同源:数据只在 `.tbl` 里(ADR-0005),块上只带引用路径与一组
 * **财务展示设置** —— 同一张表在两篇笔记里可以一套按月记账、一套按类目汇总。
 * 三种记账场景(礼账 / 日常 / 公司)不需要三种块:礼账只设收入列,日常与公司设
 * 收入 + 支出,差别全在设置里。
 *
 * 收入 / 支出列不限定列类型(与书签的名称列同一立场):指向数字列是常态,指向文本列
 * 时非数字值在求和里按空处理。余额是**视图计算的派生值**,按表内行序(即记账发生序)
 * 逐行累计 Σ收入 − Σ支出,不进 `.tbl` 也不进块 —— 落进存储就是第二份真源。**排序只
 * 改展示序,不改累计序**:一笔账「发生时账户里剩多少」与后来怎么看它无关,所以倒序
 * 读账时余额列是一串递减的数,那正是每一笔之后的样子。
 *
 * 导出形态与画册同一条 ADR-0006 立场:快照 + 指针 —— 内容写成一张带节标题行、
 * 小计行与合计行的普通表格(双击可读全账),`data-*` 属性把路径与设置一并写进,
 * 编辑器据此还原成活的账目块。
 */
export interface LedgerBlock {
  id: string
  type: "ledger"
  /** 被引用的 `.tbl` 文件的工作区路径。 */
  path: string
  /** 收入列的列 id。空 = 未设置;列被删后渲染时退化为未设置,无需清洗。 */
  incomeColumnId: string
  /** 支出列的列 id。空 = 未设置(礼账场景只设收入列)。 */
  expenseColumnId: string
  /** 是否显示余额列(逐行累计)。默认 true,`false` 才落盘 —— 与「缺省不落存储」同一口径。 */
  showBalance: boolean
  /** 分组方式。缺省 `none` 平铺。 */
  groupMode: LedgerGroupMode
  /** `month` 模式 = 日期列的列 id;`column` 模式 = 分组列的列 id;`none` 时恒为空串。 */
  groupColumnId: string
  /**
   * 排序字段的列 id。空 = 不排序,按表内行序读(与分组前的记账发生序一致)。
   * 列被删后渲染时退化为不排序,无需清洗 —— 与收入 / 支出列的同一立场。
   */
  sortColumnId: string
  /** 排序方向。缺省 `desc`:新建块按「日期列 + 倒序」起手,最近一笔在最上面。 */
  sortDirection: LedgerSortDirection
}

/**
 * 统计块:引用一张数据表的某一列,把列下的数值求和成一个大数字。
 *
 * 与看板 / 账目同源:数据只在 `.tbl` 里(ADR-0005),块上只带引用路径与一个展示设置
 * —— 求哪一列的和。非数字值在求和里按空处理(与账目块的金额列同一立场),指向的列
 * 被删后渲染时退化为「未设置」提示态,无需清洗。
 *
 * 求和是**视图计算的派生值**,不进 `.tbl` 也不进块 —— 落进存储就是第二份真源。
 * 导出形态与画册同一条 ADR-0006 立场:`data-stat` 指针挂容器,快照内容是导出时刻
 * 的列名与合计(读不到表时只写空容器,设置不蒸发、内容不瞎猜)。
 */
export interface StatBlock {
  id: string
  type: "stat"
  /** 被引用的 `.tbl` 文件的工作区路径。 */
  path: string
  /** 求和列的列 id。空 = 尚未选列(视图显示提示态引导去设置)。 */
  columnId: string
  /** 合计保留的小数位数。缺省 = 2(`STAT_PRECISION_DEFAULT`),缺省态不落盘。 */
  precision?: number
  /**
   * 筛选列的列 id。空 = 不筛选(对全表求和);非空时只合计该列**显示文本**等于
   * `filterValue` 的行。指向的列被删后筛选失效,退回全表 —— 与求和列同一退化立场。
   */
  filterColumnId?: string
  /** 筛选列的比对值(按显示文本精确比较)。只在 `filterColumnId` 非空时参与比较。 */
  filterValue?: string
}

/**
 * 订阅块:把一张数据表里的一行渲染成一张订阅卡。
 *
 * 与账目 / 统计同源:数据只在 `.tbl` 里(ADR-0005),块上只带引用路径与**字段映射**
 * —— 哪一列是名称、图标、金额、周期、自动续费、试用期、起止日期、已取消、累计支付。
 * 映射留空 = 按列名与列类型自动识别,所以同一张参考表插进笔记即可用;表结构不同
 * 或列名换了再手动指定。字段映射是展示设置,跟着块走,不进 `.tbl`。
 *
 * 到期状态、剩余天数、月均 / 年均支出都是**视图计算的派生值**,不进 `.tbl` 也不进块
 * —— 落进存储就是第二份真源,还会在日期推移后变成过期数据。
 *
 * 导出形态与画册 / 账目同一条 ADR-0006 立场:快照 + 指针 —— 卡片快照带绝对日期与
 * 金额(双击可读),`data-*` 属性把路径与字段映射一并写进,编辑器据此还原成活块。
 */
export interface SubscriptionBlock {
  id: string
  type: "subscription"
  /** 被引用的 `.tbl` 文件的工作区路径。 */
  path: string
  /** 名称列 id。空 = 自动识别(优先文本列)。 */
  nameColumnId: string
  /** 图标列 id(图片列,值为 data URI / URL)。空 = 自动识别。 */
  iconColumnId: string
  /** 金额列 id。空 = 自动识别。 */
  amountColumnId: string
  /** 周期列 id(select 列,选项名如「月付 / 季付 / 年付」)。空 = 自动识别。 */
  cycleColumnId: string
  /** 自动续费列 id(checkbox)。空 = 自动识别。 */
  autoRenewColumnId: string
  /** 试用期到期列 id(date)。空 = 自动识别(只认列名,不拿别的日期列顶替)。 */
  trialEndColumnId: string
  /** 开始日期列 id(date)。空 = 自动识别。 */
  startColumnId: string
  /** 到期日期列 id(date)。空 = 自动识别。 */
  endColumnId: string
  /** 已取消列 id(checkbox)。空 = 自动识别。 */
  cancelledColumnId: string
  /** 累计支付列 id。空 = 自动识别。 */
  paidColumnId: string
}

/**
 * 歌单块绑定的一张表:路径 + **它自己那套**字段映射。
 *
 * 映射按表各存一份,不挂在块上共用一个:两张表的列结构本来就可能不同,共用一套的话
 * 切过去必错位。
 */
export interface PlaylistSource {
  /** 被引用的 `.tbl` 文件的工作区路径。 */
  path: string
  /** 歌名列 id。空 = 自动识别(优先文本列)。 */
  titleColumnId: string
  /** 副标题列 id(歌手 / 艺人 / 专辑)。空 = 自动识别(取歌名列之后的第一个文本列)。 */
  subtitleColumnId: string
  /** 封面列 id。空 = 自动识别(图片列优先,其次值是图片地址的文本列)。 */
  coverColumnId: string
  /** 时长列 id。空 = 自动识别(只认列名,不拿文本列兜底)。 */
  durationColumnId: string
}

/**
 * 歌单块:把一张(或几张)数据表渲染成曲目列表,块上原地切换。
 *
 * 与订阅 / 账目同源:数据只在 `.tbl` 里(ADR-0005),块只是「怎么把它们排得好看」。
 * 区别是歌单可以绑多张表 —— 一份块里放「红心 / 通勤 / 待听」几个歌单,点顶部标签
 * 切换,而不是为每个歌单各占一个块。每张表带自己那套字段映射(`sources`)。
 *
 * `path` 是**当前激活那张**表的路径,不是另一份真源:它必须等于 `sources` 里某一项
 * 的 `path`。之所以还留着它,是因为「带 path 的引用块」这条契约要它(preload、打开
 * 数据表、导出指针都按它走),而那些行为对「当前这张」正是对的。
 *
 * 「添加 / 删除歌曲」就是往当前那张表里增删行,块不存私有曲目列表。
 * 导出形态与画册 / 订阅同一条 ADR-0006 立场:快照 + 指针。
 */
export interface PlaylistBlock {
  id: string
  type: "playlist"
  /** 当前激活那张表的工作区路径 —— 恒等于 `sources` 中某项的 `path`。 */
  path: string
  /** 绑定的全部表,按标签顺序。至少一项(空路径表示尚未指定)。 */
  sources: PlaylistSource[]
}

/**
 * 布局块:笔记里唯一的**容器块** —— 把若干格子按网格或弹性方式排开,每个格子各持有
 * 一份独立的块列表(Notion 式)。顶层文档仍是扁平列表;布局块是唯一一层受控的嵌套,
 * 且**格子内不再出现布局块**(一层容器原则,UI 的插入/转换菜单在格子内会把它滤掉)。
 *
 * 盘上形态是 `<div class="note-layout" data-layout="…">` 包若干 `<section>`,格子内容
 * 就是普通块 HTML —— 序列化与解析各自复用既有的块读写,不另起一套(见 ADR-0007)。
 */
export interface LayoutBlock {
  id: string
  type: "layout"
  /** 布局方式:网格(按行列均分)或弹性(横向排开、自动换行)。 */
  mode: LayoutMode
  /** 仅 grid 使用:每行列数(2..4)。缺省即 2,非 2 才落盘 —— 与 TableAlign 的「缺省不落存储」同一口径。 */
  columns?: number
  /** 格子的块列表,按序排列。空 `cells` = 尚未选择布局方式,视图显示选择器。 */
  cells: Block[][]
}

/** 布局块的排布方式。 */
export type LayoutMode = "grid" | "flex"

/**
 * 聊天记录块的说话方。只有两方：`you` 是笔记主人（气泡靠右），`agent` 是对面
 * （气泡靠左）。不做成开放字符串 —— 渲染与序列化都按这两档分叉，第三种值只会
 * 变成「谁也说不清归谁」的气泡。
 */
export type ChatRole = "you" | "agent"

/** 聊天记录的一条消息。文本是**纯字符串**而不是 `InlineRun[]` —— 聊天记录是从
 * 对话里整段摘进来的，不存在加粗 / 链接这类行内格式（与 mermaid source 同一立场）。 */
export interface ChatMessage {
  role: ChatRole
  text: string
}

/**
 * 自定义 HTML 块：内容就是用户手写的一段 HTML 原文。
 *
 * `source` 是**纯字符串**而不是 `InlineRun[]`（与 mermaid source 同一立场）——
 * 富文本行内标记对一段手写 HTML 没有意义，块的全部表达力都在原文里。原文
 * 「写什么落什么」：序列化原样落盘、解析原样收回，编辑器只负责把它装进
 * 沙箱 iframe 渲染，不消毒、不重排。
 */
export interface HtmlBlock {
  id: string
  type: "html"
  /** 用户手写的 HTML 原文，原样保存原样落盘。空串 = 尚未编写，视图直接摊开编辑区。 */
  source: string
}

/** 聊天记录块：一串按序排列的对话消息，渲染成气泡列表。整块原子，不拆成多个正文块。 */
export interface ChatBlock {
  id: string
  type: "chat"
  messages: ChatMessage[]
}

export type Block = TextualBlock | ImageBlock | TableBlock | MermaidBlock | DataTableBlock | GalleryBlock | BookmarkBlock | KanbanBlock | LedgerBlock | StatBlock | SubscriptionBlock | PlaylistBlock | ChatBlock | LayoutBlock | HtmlBlock

/**
 * 引用块展示设置的 patch 形状:六种引用块设置字段的并集,id / type / path 不在内
 * —— 设置改动只动「怎么展示」,不动「指哪张表」(换引用是块的重新指定,另一条路)。
 * `updateBlockSettings` 消费它;块类型守卫保证画册的 patch 写不进书签块。
 *
 * 歌单块不在这张并集里:它没有「纯展示」的设置,`sources` 与 `path` 是一体的
 * (path 恒等于某项),换歌单 = 换指哪张表,走 `setPlaylistSources` 那条路 ——
 * 从 patch 里漏掉 `path` 才能保住那条不变式。
 */
export type BlockSettingsPatch = Partial<
  Omit<GalleryBlock, "id" | "type" | "path"> &
  Omit<BookmarkBlock, "id" | "type" | "path"> &
  Omit<KanbanBlock, "id" | "type" | "path"> &
  Omit<LedgerBlock, "id" | "type" | "path"> &
  Omit<StatBlock, "id" | "type" | "path"> &
  Omit<SubscriptionBlock, "id" | "type" | "path">
>

/** 块类型元数据：菜单分组 + 菜单标记 + 中文名。菜单渲染直接消费。 */
export interface BlockTypeMeta {
  type: BlockType
  /** 所属菜单分组的名字。同名组在登记表里必须相邻，菜单按此切段渲染小标题。 */
  group: string
  /** 菜单左侧的等宽字符标记，替代图标 SVG。 */
  marker: string
  label: string
  /**
   * 检索词：拼音首字母（简拼），`/` 菜单里敲 `dmk` 筛出代码块。
   * 含英文标签的块（HTML / Mermaid）把英文原样收进来 —— 敲整个词比敲首字母顺手。
   */
  initials: string
}

/**
 * 文件树的节点。
 *
 * 三种文件形态里两种是文件：`note` 与 `table`。分开而不是合成一个 `"file"`，因为
 * 消费方真的要区别对待 —— 双击打开的是两种不同的编辑器（见 ADR-0005）。
 *
 * 它们**各自成行**，不合并：`客户.tbl` 与 `客户.html` 在盘上是两个东西，在树里也就是
 * 两行。合并成一个节点会让树不再是磁盘的投影，而那正是 ADR-0001 / ADR-0003 的前提。
 */
export interface FileNode {
  id: string
  name: string
  kind: "folder" | "note" | "table"
  children?: FileNode[]
  /**
   * 整合数据表视图里挂在这篇笔记名下的引用数据表（展示层专用）。
   *
   * 只由 `useWorkspace` 的 `displayTree` 填，扫描驱动从不写它。`undefined` = 整合视图
   * 没开，笔记仍显示 `.html` 后缀；空数组 = 视图开着但这篇没引用表，后缀同样要隐掉。
   * 两种状态必须分开，否则「没引用表的笔记」会看起来像没开整合。
   */
  refs?: FileNode[]
}

/** 已打开的标签页。path 是唯一键，形如 `日记 / 2026-10-08.html`。 */
export interface OpenTab {
  path: string
  dirty: boolean
  /** 这个标签里改过还没落盘的数据表路径。内容在注册表内存里,保存时随标签一起落盘,丢弃时退回盘上真相。 */
  dirtyTables: string[]
}

/** 面包屑的一段。最后一段是文件名。 */
export interface Crumb {
  name: string
  isFile: boolean
}

/** 块左侧手柄的菜单打开状态。空串表示两个菜单都关着。 */
export type BlockMenuKind = "" | "type" | "action"

/** 拖拽排序时块的落点标记：指示线画在块的上沿还是下沿。`none` 表示不参与。 */
export type BlockDropEdge = "none" | "before" | "after"

/** + 菜单选定的插入位置：相对当前块的上方或下方。 */
export type BlockInsertPosition = "above" | "below"

/** 关闭脏标签时用户的选择。 */
export type CloseStrategy = "save" | "discard"

/**
 * 新建动作的目标：在哪个目录下、建什么。
 *
 * `parentPath` 为空串表示工作区根目录 —— 与树节点的路径表示一致（见 `lib/paths`）。
 * 对话框与树行、顶部全局 `+` 三处共用它，所以它是「谁发起的」这件事的唯一载体。
 */
export interface CreateTarget {
  parentPath: string
  kind: "note" | "folder" | "table"
}

/**
 * 树里一次重命名 / 删除请求的目标：哪个节点、是什么。
 *
 * 与 `CreateTarget` 同一个模式 —— 请求从树行冒给 `AppSidebar`，对话框只认这个载体。
 */
export interface TreeTarget {
  path: string
  kind: "note" | "folder" | "table"
}

/**
 * 界面配色。只有两档 —— 没有「高对比」「护眼」这些变体，深色就是 `style.css` 里
 * `.dark` 那一套 token，浅色就是 `:root` 那一套。
 */
export type Theme = "light" | "dark"

/**
 * 主题模式（见 ADR-0014）。
 *
 * `light` / `dark` 是手动定死；另三种是自动：`system` 跟随系统外观，`fixed` 按两个
 * 固定时刻，`sun` 按当地日出日落。自动模式下标签栏那颗按钮改成「临时覆盖当前时段」，
 * 不破坏这里的选择 —— 覆盖只活到下一个时段槽。
 */
export type ThemeMode = "light" | "dark" | "system" | "fixed" | "sun"

/**
 * 主题偏好。整组存成一个值而不是五个独立偏好：它们只在「怎么定当前配色」这一件事上
 * 有意义，拆开存会出现「mode=sun 却没有经纬度」这种半截状态。
 *
 * `lightAt` / `darkAt` 存 `"HH:mm"`（`<input type="time">` 的原生格式，配置文件也读得懂）；
 * `latitude` / `longitude` 同时为 `null` 表示「按系统时区推测」—— 两个一起设或一起空，
 * 不存在只设一个的合法态。
 */
export interface ThemeSettings {
  mode: ThemeMode
  /** 固定时间模式下切浅色的时刻，`"HH:mm"`。 */
  lightAt: string
  /** 固定时间模式下切深色的时刻，`"HH:mm"`。 */
  darkAt: string
  /** 纬度（-90..90），`null` = 交给系统时区。 */
  latitude: number | null
  /** 经度（-180..180），`null` = 交给系统时区。 */
  longitude: number | null
}

/**
 * 表格效果 —— 宽表格装不下时怎么办。详见 `CONTEXT.md` 的「Preference / Table effect」。
 *
 * - `wrap`：格子内文字换行，列被挤窄，表格永远与正文同宽（默认，也是导出文件永远采用的那份）。
 * - `scroll`：格子内文字不换行，表格按内容撑开、超出部分横向滚动。
 *
 * 它**不是**块数据、也不是表格属性 —— 是全局偏好，一次作用于所有表格，
 * 不进 `TableBlock`、不进序列化。放在这里而不是 `useSettings.ts`：
 * `lib/typography.ts` 要按它挑类名，而那份视觉常量模块不该反过来依赖一个 composable。
 */
export type TableEffect = "wrap" | "scroll"
