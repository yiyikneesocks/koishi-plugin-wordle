import { Context, Schema } from 'koishi'
import { join, resolve } from 'path'
import { } from '@koishijs/plugin-console'
import { promises as fsPromises } from 'fs';
import fs from 'fs'
import { } from 'koishi-plugin-puppeteer'

export const name = 'wordle'
export const inject = { optional: ['puppeteer'] }

export interface Config {
  // 猜词库（答案来源）：每行「单词 [含义]」，取行首空格前的单词
  answerDict?: string
  // 合法词库（判定猜测是否有效）：每行一个单词
  guessDict?: string
  // 最大猜测次数
  maxGuesses?: number
  // 默认单词长度（wd 不带数字时）；0 = 随机长度
  defaultLength?: number
  // 允许的字母数范围
  minLength?: number
  maxLength?: number
  // 是否渲染图片（需要 puppeteer）；关闭则纯文本
  image?: boolean
  // —— 自定义提示语（可改成自己喜欢的话）——
  textAlready?: string   // 已有游戏进行中
  textStart?: string     // 开局提示
  textNoGame?: string    // 未开局就猜
  textStop?: string      // 结束游戏
  textLength?: string    // 长度不符
  textInvalid?: string   // 不是合法单词
  textLose?: string      // 猜完失败
  textWin?: string       // 猜对
}

export const Config: Schema<Config> = Schema.object({
  answerDict: Schema.string()
    .description('猜词库路径（每行「单词 含义」），默认使用内置词库。'),
  guessDict: Schema.string()
    .description('合法词库路径（每行一个单词），默认使用内置词库。'),
  maxGuesses: Schema.number()
    .description('最大猜测次数').default(6).min(1).max(20),
  defaultLength: Schema.number()
    .description('默认单词长度（0 = 随机）').default(0).min(0).max(20),
  minLength: Schema.number().description('允许的最小字母数').default(4).min(2).max(20),
  maxLength: Schema.number().description('允许的最大字母数').default(10).min(2).max(20),
  image: Schema.boolean()
    .description('是否渲染图片棋盘（开启需安装 koishi-plugin-puppeteer）').default(true),
  textAlready: Schema.string().description('已有游戏进行中的提示'),
  textStart: Schema.string().description('开局提示'),
  textNoGame: Schema.string().description('未开局就猜的提示'),
  textStop: Schema.string().description('结束游戏的提示'),
  textLength: Schema.string().description('字母数不符的提示'),
  textInvalid: Schema.string().description('不是合法单词的提示'),
  textLose: Schema.string().description('猜完失败的提示'),
  textWin: Schema.string().description('猜对的提示'),
})

// 默认词库相对于「本包 lib/ 目录」解析（源码在 src/ 下开发时也回退到 src/）。
function defaultDict(filename: string): string {
  // 编译后：lib/index.js，词库在 lib/ 同级
  const libPath = join(__dirname, filename)
  if (fs.existsSync(libPath)) return libPath
  // 开发态（ts 直接跑或测试）：回退到 src/
  const srcPath = join(resolve(__dirname, '..'), 'src', filename)
  if (fs.existsSync(srcPath)) return srcPath
  return libPath
}



async function getRandomWord(filename, length?: number) {
  try {
    // 读取文件内容
    const fileContent = await fsPromises.readFile(filename, 'utf8');
    let lines = fileContent.split('\n');

    // 若指定了字母数，则只保留该长度的单词
    if (length) {
      lines = lines.filter((l) => {
        const w = l.trim().split(' ')[0];
        return w.length === length;
      });
      if (!lines.length) throw new Error(`字典中没有 ${length} 个字母的单词`);
    }

    // 随机选择一行
    const randomIndex = Math.floor(Math.random() * lines.length);
    const randomLine = lines[randomIndex];

    // 去掉末尾的换行符和空格
    const cleanedLine = randomLine.trim();

    return cleanedLine;
  } catch (error) {
    console.error('读取文件出错：', error);
    throw error;
  }
}

function testword(word, input)
{
  let ct = 0;
  const len = word.length;
  let t = { value: '*'.repeat(len) };
  let test: string[] = t.value.split('');
  for (let i = 0; i < len; i++)
  {
    const a = word[i].toLowerCase();
    const b = input[i].toLowerCase();
    if (a === b) {
      test[i] = '1';
      ct += 1;
      //console.log(a, b, ct, i, test[i], test);
      continue;
    }
    for (let j = 0; j < len; j++) {
      const c = input[j].toLowerCase();

      if (a === c && test[j] === '*') {
        test[j] = '0';
        break;
      }
    }
  }
  t.value = test.join('');
  return { iftest: ct === len ? 1 : 0, test: t.value };
}

// 词库缓存：{ [filename]: Set<string> }，避免每次猜词都重读几十万行文件
const dictCache: { [filename: string]: Set<string> } = {}

function loadDict(filename: string): Set<string> {
  let set = dictCache[filename]
  if (set) return set
  set = new Set<string>()
  try {
    const content = fs.readFileSync(filename, 'utf8')
    for (const line of content.split('\n')) {
      const w = line.trim().toLowerCase()
      if (w) set.add(w)
    }
  } catch (error) {
    console.error('无法打开文件：', error)
  }
  dictCache[filename] = set
  return set
}

// 生成一个英文单词可能的「词元（base form）」候选，用于宽松判定屈折/变形词。
// 覆盖：复数/三单(-s/-es/-ies)、过去式(-ed/-ied)、进行时(-ing)、
//       比较级/最高级(-er/-est/-ier/-iest)、副词(-ly/-ily)。
function lemmaCandidates(word: string): string[] {
  const w = word.toLowerCase()
  const out = new Set<string>()
  const add = (x: string) => { if (x.length >= 2) out.add(x) }

  if (/ies$/.test(w)) add(w.slice(0, -3) + 'y')
  if (/(ses|xes|zes|ches|shes|oes)$/.test(w)) add(w.slice(0, -2))
  if (/sses$/.test(w)) add(w.slice(0, -2))
  if (/s$/.test(w) && !/ss$/.test(w)) add(w.slice(0, -1))
  if (/ves$/.test(w)) { add(w.slice(0, -3) + 'f'); add(w.slice(0, -3) + 'fe') }

  if (/ied$/.test(w)) add(w.slice(0, -3) + 'y')
  if (/ed$/.test(w)) {
    add(w.slice(0, -2))            // walk-ed -> walk
    add(w.slice(0, -1))            // love-d  -> love
    if (/([^aeiou])\1ed$/.test(w)) add(w.slice(0, -3))  // stop-p-ed -> stop
  }

  if (/ing$/.test(w)) {
    add(w.slice(0, -3))
    add(w.slice(0, -3) + 'e')      // mak-ing -> make
    if (/([^aeiou])\1ing$/.test(w)) add(w.slice(0, -4)) // run-n-ing -> run
  }

  if (/iest$/.test(w)) add(w.slice(0, -4) + 'y')
  if (/ier$/.test(w)) add(w.slice(0, -3) + 'y')
  if (/est$/.test(w)) add(w.slice(0, -3))
  if (/er$/.test(w)) add(w.slice(0, -2))

  if (/ily$/.test(w)) add(w.slice(0, -3) + 'y')
  if (/ly$/.test(w)) add(w.slice(0, -2))

  return [...out]
}

// 合法判定：词库直接命中，或其某个词元命中（宽松接受屈折/变形词）。
function WordJud(filename: string, word: string): 0 | 1 {
  const dict = loadDict(filename)
  const w = (word || '').trim().toLowerCase()
  if (!w) return 0
  if (dict.has(w)) return 1
  for (const c of lemmaCandidates(w)) {
    if (dict.has(c)) return 1
  }
  return 0
}


const gameData = {}; // 创建一个空对象来存储游戏数据

// 调色板（NYT Wordle 风格）
const COLOR = {
  correct: '#6aaa64', // 绿：字母正确且位置正确
  present: '#c9b458', // 黄：字母存在但位置错误
  absent: '#787c7e', // 灰：字母不存在
  empty: '#d3d6da', // 空位边框
  emptyFill: '#ffffff',
  text: '#ffffff',
  textDark: '#1a1a1b',
  bg: '#ffffff',
  keyText: '#ffffff',
}

const KEYBOARD_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM']

// 依据历史猜测汇总每个字母的状态：
//   2 = green  至少一个位置确定正确
//   1 = yellow 出现过但没有任何确定位置
//   0 = grey   已排除
//   -1 = 未使用
function letterStates(guesses: { letters: string; marks: string }[]) {
  const state: { [k: string]: number } = {}
  for (const guess of guesses) {
    for (let i = 0; i < guess.letters.length; i++) {
      const ch = (guess.letters[i] || '').toUpperCase()
      if (!ch || ch < 'A' || ch > 'Z') continue
      const mark = guess.marks[i]
      const rank = mark === '1' ? 2 : mark === '0' ? 1 : 0
      state[ch] = Math.max(state[ch] ?? -1, rank)
    }
  }
  return state
}

// 生成一张 Wordle 棋盘图片（SVG）：
//   guesses: 历史猜测，每项 { letters: string, marks: string }（marks 中 1=绿 0=黄 *=灰）
//   status:  顶部提示文字
//   answer:  已结束时显示答案（否则 null）
//   remaining: 剩余次数
async function renderBoard(
  ctx: Context,
  opts: {
    guesses: { letters: string; marks: string }[]
    length: number
    rows: number
    status?: string
    answer?: string
    remaining?: number
  },
): Promise<any> {
  const { SVG } = require('koishi-plugin-puppeteer')
  const { guesses, length: W, rows: ROWS, status, answer, remaining } = opts

  // ── 尺寸计算 ──
  const cell = 1
  const gap = 0.16
  const padTop = status ? 1.5 : 0.5
  const padX = 0.6

  const boardW = W * cell + (W - 1) * gap
  const boardH = ROWS * cell + (ROWS - 1) * gap

  // 键盘尺寸：比棋盘略宽，三行居中错位排布
  const keyGap = 0.14
  const keyH = 0.82
  const kbRows = KEYBOARD_ROWS.map((r) => r.split(''))
  const maxKeys = Math.max(...kbRows.map((r) => r.length))
  const kbW = Math.max(boardW, maxKeys * 0.78 + (maxKeys - 1) * keyGap)
  const keyW = (kbW - (maxKeys - 1) * keyGap) / maxKeys
  const kbH = kbRows.length * keyH + (kbRows.length - 1) * keyGap
  const kbTop = padTop + boardH + 0.8

  const footH = 0.9
  const viewW = Math.max(boardW, kbW) + padX * 2
  const viewH = kbTop + kbH + footH

  const svg = new SVG({
    viewSize: Math.max(viewW, viewH),
    size: Math.max(520, Math.round(Math.max(viewW, viewH) * 54)),
    viewBox: { top: 0, bottom: viewH, left: 0, right: viewW },
  })
  svg.fill(COLOR.bg)

  // ── 顶部状态文字 ──
  if (status) {
    svg.g({
      fill: COLOR.textDark,
      style: 'font-family: system-ui, "PingFang SC", "Microsoft YaHei", Sans; font-weight: 600',
      textAnchor: 'middle',
    } as any).text(status, viewW / 2, 1.0, { fontSize: '0.68' } as any)
  }

  // ── 棋盘 ──
  const offsetY = padTop
  const offsetX = (viewW - boardW) / 2

  for (let r = 0; r < ROWS; r++) {
    const guess = guesses[r]
    for (let c = 0; c < W; c++) {
      const x = offsetX + c * (cell + gap)
      const y = offsetY + r * (cell + gap)

      let fillColor = COLOR.emptyFill
      let strokeColor = COLOR.empty
      let letter = ''
      let textColor = COLOR.textDark

      if (guess) {
        letter = (guess.letters[c] || '').toUpperCase()
        const mark = guess.marks[c]
        if (mark === '1') { fillColor = COLOR.correct; strokeColor = COLOR.correct; textColor = COLOR.text }
        else if (mark === '0') { fillColor = COLOR.present; strokeColor = COLOR.present; textColor = COLOR.text }
        else { fillColor = COLOR.absent; strokeColor = COLOR.absent; textColor = COLOR.text }
      }

      const tile = svg.g({ fill: fillColor, stroke: strokeColor, strokeWidth: 0.05 } as any)
      // 注意：SVG#rect(x1, y1, x2, y2) 第 3/4 参数是「右下角坐标」（内部会算成宽高）
      tile.rect(x, y, x + cell, y + cell, { rx: 0.08, ry: 0.08 } as any)
      if (letter) {
        tile.text(letter, x + cell / 2, y + cell / 2 + 0.22, {
          fill: textColor, fontSize: '0.58', textAnchor: 'middle',
          style: 'font-family: "Helvetica Neue", Arial, "PingFang SC", Sans; font-weight: 700',
        } as any)
      }
    }
  }

  // ── 键盘 ──
  const states = letterStates(guesses)

  kbRows.forEach((keys, rowIdx) => {
    // 第二/三行居中错位
    const rowW = keys.length * keyW + (keys.length - 1) * keyGap
    const rowX = (viewW - rowW) / 2
    const y = kbTop + rowIdx * (keyH + keyGap)

    keys.forEach((ch, i) => {
      const x = rowX + i * (keyW + keyGap)
      const st = states[ch] ?? -1
      let fill: string
      if (st === 2) fill = COLOR.correct
      else if (st === 1) fill = COLOR.present
      else if (st === 0) fill = COLOR.absent
      else fill = COLOR.empty

      const textColor = st === -1 ? COLOR.textDark : COLOR.keyText
      const key = svg.g({ fill } as any)
      // SVG#rect 内部把第 3/4 参数当成「x 方向终点 / y 方向终点」而算成
      // width = y2-y1、height = x2-x1（参数是转置的），故此处交换：
      // 想得到宽 keyW、高 keyH，就传 (x, y, x+keyH, y+keyW)
      key.rect(x, y, x + keyH, y + keyW, { rx: 0.1, ry: 0.1 } as any)
      key.text(ch, x + keyW / 2, y + keyH / 2 + 0.19, {
        fill: textColor, fontSize: '0.44', textAnchor: 'middle',
        style: 'font-family: "Helvetica Neue", Arial, Sans; font-weight: 700',
      } as any)
    })
  })

  // ── 底部：剩余次数 / 答案 ──
  const footY = kbTop + kbH + 0.62
  const footG = svg.g({
    fill: COLOR.textDark,
    style: 'font-family: system-ui, "PingFang SC", "Microsoft YaHei", Sans',
    textAnchor: 'middle',
  } as any)
  if (answer) {
    footG.text(`答案：${answer.toUpperCase()}`, viewW / 2, footY, { fontSize: '0.52', fontWeight: 600 } as any)
  } else if (remaining !== undefined) {
    footG.text(`剩余 ${remaining} 次`, viewW / 2, footY, { fontSize: '0.46', fill: '#787c7e' } as any)
  }

  return svg.render(ctx)
}

export function apply(ctx: Context, config: Config) {
  ctx = ctx.guild();

  const maxGuesses = config.maxGuesses ?? 6
  const answerDict = config.answerDict || defaultDict('tiku.txt')
  const guessDict = config.guessDict || defaultDict('djciku.txt')

  // 默认提示语（可被 config 覆盖）
  const t = {
    already: config.textAlready ?? '本群已有一局进行中，先猜完或 wdq 结束它吧',
    start: config.textStart ?? '开始猜词！',
    noGame: config.textNoGame ?? '还没有进行中的游戏，先输入 wd 开始一局吧',
    stop: config.textStop ?? '游戏已结束，下次再来玩～',
    length: config.textLength ?? '字母数不对哦，再数一下？',
    invalid: config.textInvalid ?? '这不是一个有效单词，换个词试试？',
    lose: config.textLose ?? '没猜出来，再接再厉',
    win: config.textWin ?? '猜对了！',
  }

  ctx.command('wordle [input]', 'wordle猜单词游戏')
    .shortcut('wd', { fuzzy: true })
    .shortcut('猜单词', { fuzzy: true })
    .shortcut('停止猜单词', { options: { gstop: true } })
    .shortcut('wdq', { options: { gstop: true } })
    .shortcut('wdquit', { options: { gstop: true } })
    .shortcut('wdn', { options: { gnew: true }, fuzzy: true })
    .option('gstart', '开始游戏')
    .option('gnew', '开一局并把参数作为第一次猜测（如 wdn hello）')
    .option('gstop', '停止游戏')
    .action(async ({ session, options }, input) => {
      const { cid } = session;
      const rawInput = (input || '').trim()

      const minLen = config.minLength ?? 4
      const maxLen = config.maxLength ?? 10

      // ── `wdn <word>` 参数校验（任一不通过 → 不开局）──
      //   1) 非纯字母            → 不开局，返回 textInvalid
      //   2) 字母数不在 4~10     → 不开局，返回 textLength
      //   3) 字母数合法但非单词  → **照常开局**，返回 textInvalid（不消耗次数）
      let firstGuess: string | undefined
      if (options.gnew && rawInput) {
        if (!/^[A-Za-z]+$/.test(rawInput)) {
          return t.invalid
        }
        const word = rawInput.toLowerCase()
        if (word.length < minLen || word.length > maxLen) {
          return t.length
        }
        firstGuess = word
      } else if (options.gnew && !rawInput) {
        // `wdn` 不带参数 → 等同于 `wd`
        options.gstart = true
      }

      // 无参数 → 开始；纯数字参数 → 以指定字母数开始
      if (!options.gstop && !firstGuess && (!rawInput || /^\d+$/.test(rawInput))) {
        options.gstart = true
      }

      // 指定字母数：`wd 5` / `猜单词 5`（input 为纯数字）
      let wordLength: number | undefined
      if (options.gstart && rawInput && /^\d+$/.test(rawInput)) {
        wordLength = parseInt(rawInput, 10)
        if (wordLength < minLen || wordLength > maxLen) {
          return t.length;
        }
      } else if (options.gstart && config.defaultLength > 0) {
        wordLength = config.defaultLength
      }

      const sendBoard = async (status?: string, answer?: string) => {
        const g = gameData[cid]
        const remaining = maxGuesses - g.ct
        // 优先图片渲染；puppeteer 不可用时回退纯文本
        if (config.image && session.app.puppeteer) {
          try {
            const img = await renderBoard(ctx, {
              guesses: g.guesses, length: g.lenth, rows: maxGuesses, status, answer, remaining,
            })
            await session.send(img)
            return
          } catch (e) {
            console.error('wordle 图片渲染失败，回退文本：', e)
          }
        }
        // 文本回退
        let text = g.guesses.map((x) => `${x.letters}\n${x.marks}`).join('\n')
        if (status) text = status + '\n' + text
        if (answer) text += `\n答案：${answer}`
        await session.send(text)
      }

      // `wdn <word>` 也视为开局
      if (firstGuess) options.gstart = true

      if (options.gstart) {
        if (gameData[cid]) {
          await session.send(t.already);
          await sendBoard();
          return;
        } else {
          // 初始化游戏数据
          let wordmean: string
          try {
            // wdn <word> 时用该词长度决定答案长度
            const len = firstGuess ? firstGuess.length : wordLength
            wordmean = await getRandomWord(answerDict, len)
          } catch (e: any) {
            return `出错了：${e?.message || e}`
          }
          gameData[cid] = {
            guesses: [],               // 历史猜测 [{letters, marks}]
            wordmean,
            word: '',
            lenth: 0,
            test: { value: '' },
            ct: 0,
          };
          gameData[cid].word = gameData[cid].wordmean.split(' ')[0];
          gameData[cid].lenth = gameData[cid].word.length;
          gameData[cid].test = { value: '*'.repeat(gameData[cid].lenth) };
          await session.send(`请用“wd ${gameData[cid].test.value}”的形式输入你猜测的单词：`);
          await sendBoard(t.start);

          // wdn <word>：立刻把该词作为第一次猜测
          if (firstGuess) {
            // 长度已在前面校验过，这里只可能因字典长度不同而失配（防御）
            if (firstGuess.length !== gameData[cid].lenth) {
              await session.send(t.length);
              return;
            }
            // 规则 3：字母合法但不在词库 → 已开局，只提示，不消耗次数
            if (WordJud(guessDict, firstGuess) === 0) {
              await session.send(t.invalid);
              return;
            }
            const aa = testword(gameData[cid].word, firstGuess);
            gameData[cid].test.value = aa.test;
            gameData[cid].guesses.push({ letters: firstGuess, marks: aa.test });
            if (aa.iftest === 0) {
              gameData[cid].ct += 1;
              if (gameData[cid].ct >= maxGuesses) {
                await sendBoard(t.lose, gameData[cid].word);
                delete gameData[cid];
                return;
              }
              await sendBoard();
            } else {
              await sendBoard(t.win, gameData[cid].word);
              delete gameData[cid];
              return;
            }
          }
          return;
        }
      }
      if (!gameData[cid]) {
        return t.noGame;
      } else if (options.gstop) {
        delete gameData[cid];
        return t.stop;
      } else if (!options.gstart && input.length !== gameData[cid].lenth) {
        return t.length;
      } else if (!options.gstart && WordJud(guessDict, input) === 0) {
        return t.invalid;
      } else if (!options.gstart) {
        gameData[cid].input = input;
        const aa = testword(gameData[cid].word, input);
        const jud = aa.iftest;
        gameData[cid].test.value = aa.test;
        gameData[cid].guesses.push({ letters: input, marks: aa.test });
        if (jud === 0) {
          gameData[cid].ct += 1;
          if (gameData[cid].ct >= maxGuesses) {
            await sendBoard(t.lose, gameData[cid].word);
            delete gameData[cid];
            return;
          }
          await sendBoard();
        } else {
          await sendBoard(t.win, gameData[cid].word);
          delete gameData[cid];
          return;
        }
      }
    });
}

