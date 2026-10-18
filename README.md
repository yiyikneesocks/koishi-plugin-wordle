# koishi-plugin-wordle

[![npm](https://img.shields.io/npm/v/koishi-plugin-wordle?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-wordle)

Wordle 猜单词游戏，支持图片棋盘 + QWERTY 键盘。

## 安装

```bash
# 核心插件（必需）
npm install koishi-plugin-wordle

# 可选：图片棋盘（推荐）。不装则自动回退为纯文本棋盘
npm install koishi-plugin-puppeteer
```

## 使用

| 命令 | 说明 |
|---|---|
| `wd` / `猜单词` | 随机长度开局 |
| `wd 5` | 指定 5 个字母（2~20，内置词库支持 4~10） |
| `wd <word>` | 猜一次 |
| `wdq` / `wdquit` / `停止猜单词` | 结束本局 |

### 棋盘颜色

| 颜色 | 含义 |
|---|---|
| 🟩 绿 | 字母正确且位置正确 |
| 🟨 黄 | 字母存在但位置不对 |
| ⬜ 灰 | 字母不在答案中 |

底部 QWERTY 键盘会汇总每个字母的最佳状态（green > yellow > grey）。

## 配置

```yaml
plugins:
  wordle:
    maxGuesses: 6        # 最大猜测次数
    defaultLength: 0     # 默认单词长度，0 = 随机
    image: true          # 是否渲染图片（需要 puppeteer）
    answerDict: ''       # 自定义猜词库（每行「单词 含义」）
    guessDict: ''        # 自定义合法词库（每行一个单词）
    # 提示语都可自定义：
    textAlready: ''
    textStart: ''
    textNoGame: ''
    textStop: ''
    textLength: ''
    textInvalid: ''
    textLose: ''
    textWin: ''
```

不填 `answerDict` / `guessDict` 时使用内置词库。

## 许可

MIT
