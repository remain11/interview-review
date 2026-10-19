"""抓取小林coding 面试题页面，按 h3 拆成题目，输出 data/xiaolin_<page>.json

用法: python tools/scrape_xiaolin.py [--cached]
  --cached  使用 scrape/ 目录下已下载的 html，不重新联网
"""
import html
import json
import re
import sys
import urllib.request
from pathlib import Path

from tagging import auto_tags

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "scrape"
DATA = ROOT / "data" / "bank"

PAGES = {
    "cpp": "C++",
    "network": "计算机网络",
    "mysql": "数据库",
    "os": "操作系统",
    "data": "数据结构与算法",
}
BASE = "https://xiaolincoding.com/interview/{}.html"


def fetch(page: str, cached: bool) -> str:
    path = CACHE / f"{page}.html"
    if cached and path.exists():
        return path.read_text(encoding="utf-8")
    req = urllib.request.Request(BASE.format(page), headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        text = resp.read().decode("utf-8")
    CACHE.mkdir(exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return text


def strip_tags(s: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", s)).strip()


def clean_code(m: re.Match) -> str:
    """把 prism 高亮过的代码块还原成纯文本，交给前端 highlight.js 统一着色"""
    lang = m.group(1) or ""
    code = re.sub(r"<[^>]+>", "", m.group(2))
    cls = f' class="language-{lang}"' if lang else ""
    return f"<pre><code{cls}>{code}</code></pre>"


def clean_answer(s: str) -> str:
    s = re.sub(
        r'<div class="language-([\w+-]*)[^"]*"><pre[^>]*><code>(.*?)</code></pre></div>',
        clean_code, s, flags=re.S,
    )
    s = re.sub(r'<a href="#[^"]*" class="header-anchor">#</a>\s*', "", s)
    # 去掉文末公众号推广
    s = re.split(r"<hr>\s*<p>最新的图解文章", s)[0]
    s = re.sub(r"(<hr>\s*)+$", "", s.strip())
    # 外链图片不带 referer，并懒加载
    s = s.replace("<img ", '<img loading="lazy" referrerpolicy="no-referrer" ')
    s = s.replace('<a href="http', '<a target="_blank" rel="noopener" href="http')
    return s.strip()


def parse(page: str, category: str, text: str) -> list[dict]:
    start = text.find('class="theme-default-content')
    end = text.find("<footer", start)
    body = text[start:end]
    body = body[body.find(">") + 1:]
    # 按 h2/h3 切块
    parts = re.split(r'(<h[23] id="[^"]*">.*?</h[23]>)', body, flags=re.S)
    questions, section = [], ""
    for i in range(1, len(parts), 2):
        head, content = parts[i], parts[i + 1]
        anchor = re.search(r'id="([^"]*)"', head).group(1)
        title = strip_tags(re.sub(r'<a [^>]*class="header-anchor"[^>]*>#</a>', "", head))
        if head.startswith("<h2"):
            section = title
            continue
        questions.append({
            "id": f"xl-{page}-{len(questions) + 1:03d}",
            "category": category,
            "title": title,
            "answer": clean_answer(content),
            "format": "html",
            "source": "小林coding",
            "tags": [section] + auto_tags(title),
            "url": f"{BASE.format(page)}#{anchor}",
        })
    return questions


def main():
    cached = "--cached" in sys.argv
    DATA.mkdir(exist_ok=True)
    for page, category in PAGES.items():
        qs = parse(page, category, fetch(page, cached))
        out = DATA / f"xiaolin_{page}.json"
        out.write_text(json.dumps(qs, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"{page}: {len(qs)} 题 -> {out.name}")


if __name__ == "__main__":
    main()
