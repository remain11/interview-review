# 八股复习站

在本地跑的面试八股刷题网站。一次只出一道题，先自评「不知道 / 模糊 / 熟悉」，选完才显示答案。标成熟悉的题之后不再出现，题目会越刷越少。

自带 451 道题，来自[小林coding](https://xiaolincoding.com/)的面试题系列，覆盖 C++、操作系统、计算机网络、MySQL、数据结构与算法。

## 快速开始

需要 Python 3.10+，不用装第三方包。

```bash
git clone https://github.com/remain11/interview-review.git
cd interview-review
python -X utf8 server.py      # Windows 也可以直接双击 start.bat
```

启动后会自动打开 http://127.0.0.1:8765/ 。

## 功能

- **刷题**：自评之后才显示答案，看完答案还能改选。「下一题」按钮位置随机，防止不看答案就顺手点掉。
- **越刷越少**：默认只出还没熟悉的题（不知道、模糊、没做过）。一轮刷完后开新一轮，只会出剩下没熟悉的。
- **出题模式**：只看没做过的、只看不知道、只看模糊、只看收藏，或者全部都出。顺序可选：随机、常错的题更容易出现、按题库顺序。
- **筛选**：按分类、来源、标签筛选。在题库页取消勾选的题只是停用，不会删除，随时能恢复。
- **重置**：开新一轮、只重置当前筛选范围、全部重置、把「模糊」打回「不知道」。收藏和笔记都会保留。
- **其他**：收藏、每题笔记、撤销、跳过、题库搜索、统计页（分类进度、近 30 天刷题量、反复不会的题）、深色模式、进度导出和导入。
- **快捷键**：`1` `2` `3` 自评，`空格` 下一题，`→` 跳过，`S` 收藏，`X` 停用，`Z` 撤销，`N` 写笔记。

## 手机访问

推荐用 [Tailscale](https://tailscale.com/)，不需要公网 IP，也不用租云服务器。

1. 电脑和手机都装 Tailscale，登录同一个账号。
2. 电脑上运行 `python -X utf8 server.py --lan`（Windows 可以双击 `start_lan.bat`）。
3. 启动窗口会打印口令和访问链接 `http://<电脑的 Tailscale 名称>:8765/?key=<口令>`，手机打开一次后会记住口令。
4. 想当 App 用，就在手机浏览器菜单里选「添加到主屏幕」。

几点说明：

- `--lan` 模式只接受本机、Tailscale 网段和局域网私有地址的连接，非本机访问一律需要口令。口令在 `data/token.txt`，删掉后重启会生成新的。
- 没有 HTTPS，也没有用户系统，**不要直接暴露到公网**。
- 多台设备同时用时，进度按题目合并，不会互相覆盖。切换页面或回到前台时会拉取其他设备的改动。主题和「当前题」每台设备各存各的。

## 数据

| 路径 | 说明 |
|------|------|
| `data/bank/*.json` | 题库。启动时合并该目录下所有文件，改完刷新页面即可生效 |
| `data/state.json` | 答题进度。每次写入前备份到 `state.bak.json`，每天另存一份到 `data/backups/` |
| `data/token.txt` | `--lan` 模式的访问口令 |

进度和口令都在 `.gitignore` 里，不会被提交。

### 更新小林coding 题库

```bash
python -X utf8 tools/scrape_xiaolin.py            # 重新抓取
python -X utf8 tools/scrape_xiaolin.py --cached   # 只用 scrape/ 下的缓存重新解析
```

题目 `id` 按「页面 + 序号」生成，只要 `id` 不变进度就不会丢。原文如果增删了题目，序号会错位，更新前建议先在设置页导出一份进度。

### 添加自己的题库

在 `data/bank/` 下新建一个 JSON 文件，内容是题目数组，每道题格式如下：

```json
{
  "id": "my-001",
  "category": "C++",
  "title": "题目",
  "answer": "Markdown 格式的答案",
  "format": "md",
  "source": "我的笔记",
  "tags": ["智能指针", "原理"],
  "url": "",
  "hint": "可选，作答前可以展开的提示"
}
```

`format` 也可以是 `html`。`id` 要全局唯一。

## 开发

```
server.py              本地服务（只用标准库）：静态文件、题库合并、进度增量保存、--lan 口令校验
static/js/core.js      状态、增量同步、出题逻辑
static/js/review.js    刷题页
static/js/bank.js      题库页
static/js/settings.js  设置页、统计页
static/vendor/         marked、DOMPurify、highlight.js（本地化，离线可用）
tools/                 爬虫、标签推断、UI 测试
```

UI 测试会用无头 Chrome 跑一遍主要交互。测试会重置进度，必须配合临时数据目录：

```bash
BAGU_DATA=/tmp/bagu-test python server.py --port 8767 --no-browser
PORT=8767 node tools/ui_test.mjs
```

## 版权说明

`data/bank/xiaolin_*.json` 里的题目、答案和配图版权归[小林coding](https://xiaolincoding.com/)所有。本仓库只用于个人学习复习，每道题都附了原文链接，推荐去原站阅读完整内容。如果原作者认为不合适，请提 issue，我会马上删除这部分数据。

本项目代码以 MIT 协议开源，不包括上面这部分题库数据。
