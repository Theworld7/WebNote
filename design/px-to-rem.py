"""把容器尺寸的 px 任意值换成等值 rem，让基础字号放大时容器跟着走。

只处理宽度 / 高度 / 间距 / 行高这几族。**不碰**：
- `rounded-[Npx]`：圆角有自己的一套刻度（`--rad-*`，四档由设置决定），不跟字号
- ≤ 3px 的细线：滚动条、选中边、光标，物理像素才对
- `[calc(...)]` 这类非纯数字值

用法：python design/px-to-rem.py [--write]
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "src"

# 需要随字号缩放的族。刻意不含 rounded-*，也不含 border-*。
FAMILIES = (
    "w|h|min-w|max-w|min-h|max-h|size|"
    "p|px|py|pt|pb|pl|pr|"
    "gap|gap-x|gap-y|"
    "leading|"
    "inset|inset-x|inset-y|top|left|right|bottom"
)

PATTERN = re.compile(rf"\b((?:{FAMILIES})-)\[(\d+(?:\.\d+)?)px\]")

# 细线阈值：这以下是描边 / 指示条 / 光标，放大字号不该把它们变粗。
THIN_MAX = 3


def to_rem(px: float) -> str:
    value = round(px / 16, 4)
    text = f"{value:.4f}".rstrip("0").rstrip(".")
    return f"{text}rem"


def convert(path: Path) -> list[tuple[int, str, str]]:
    lines = path.read_text(encoding="utf-8").splitlines()
    changes = []
    for index, line in enumerate(lines, start=1):
        # 注释里提到的类名是解释，不是样式，改了会让注释与实际代码对不上。
        # 块注释续行（` * …`）也在此列 —— `MarkdownView` 顶部那段讲的就是「版心宽度
        # 不走类名」的理由，把里面的 `max-w-[720px]` 换成 rem 会把论据本身改掉。
        stripped = line.lstrip()
        if stripped.startswith("*") or stripped.startswith("/*"):
            continue
        code = line.split("//")[0] if "//" in line else line
        if "px]" not in code:
            continue

        def repl(match: re.Match[str]) -> str:
            prefix, raw = match.group(1), match.group(2)
            px = float(raw)
            if px <= THIN_MAX:
                return match.group(0)
            before = match.group(0)
            after = f"{prefix}[{to_rem(px)}]"
            changes.append((index, before, after))
            return after

        lines[index - 1] = PATTERN.sub(repl, line)
    return lines, changes


def main() -> None:
    write = "--write" in sys.argv
    total = 0
    files = 0
    for path in sorted(ROOT.rglob("*")):
        if path.suffix not in {".vue", ".ts"} or not path.is_file():
            continue
        lines, changes = convert(path)
        if not changes:
            continue
        files += 1
        total += len(changes)
        print(f"\n{path.relative_to(ROOT.parent)}")
        for line_no, before, after in changes:
            print(f"  {line_no:>5}  {before}  ->  {after}")
        if write:
            path.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="")
    print(f"\n{'已写入' if write else '试算'}：{total} 处 / {files} 个文件")


if __name__ == "__main__":
    main()
