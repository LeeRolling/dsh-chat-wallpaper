# dsh-chat-wallpaper

> 给 [DeepSeek Harness](https://github.com/deepseek-ai) 的**开场视频 + 聊天底图**插件。
>
> 开机动画放完之后，全屏接一段你自己的视频当"第二幕"；放完淡出、交回聊天窗口。
> 聊天窗口背后的底图由你自己定 —— 换图只要丢张图片进一个文件夹。

```
   开机动画（你的 dsh-startup-screen）
        ↓  交叉叠化（不是硬切，也不是闪一下）
   全屏开场视频（盖住聊天窗口）
        ↓  淡出
   聊天窗口 + 你的底图
```

**面板、卡片、代码块全程保持不透明** —— 底图再花也不影响读字。

---

## 目录

- [两个层，彻底分开](#两个层彻底分开)
- [它怎么做到"背景而不覆盖"](#它怎么做到背景而不覆盖)
- [交叉叠化：这个插件里最难的一段](#交叉叠化这个插件里最难的一段)
- [安装](#安装)
- [换视频 / 换底图](#换视频--换底图)
- [设置面板](#设置面板)
- [配置项](#配置项)
- [诊断与工具](#诊断与工具)
- [测试](#测试)
- [踩过的坑（都留了回归测试）](#踩过的坑都留了回归测试)
- [致谢与来源](#致谢与来源) ⭐
- [许可](#许可)

---

## 两个层，彻底分开

```
   z-index 2147482990  ┌─ #dsh-chat-wallpaper ─ 开场视频（placement="front"）
                       │   开机动画收场后的【第二幕】：全屏盖住聊天窗口
                       │   播完 → 淡出 → 移除 → 进入聊天
                       └───────────────────────────────────────────────
         正常内容       │  聊天界面 / 侧栏 / 输入框
                       └───────────────────────────────────────────────
            z-index -1  ┌─ #dsh-cw-bg ─ 聊天底图 + 纱（可选）
                       │   你自己定的一张图，聊天就落在它上面
                       └───────────────────────────────────────────────
```

**这两层互不依赖**：

| 你配了什么 | 结果 |
|---|---|
| 只配视频 | 开机 → 全屏开场演一遍 → 淡出 → 回到 DSH 默认底色 |
| 只配底图 | 没有开场，聊天直接落在你那张图上 |
| 两个都配 | 开场在前演，演完淡出 → 露出"聊天 + 你的底图" |

---

## 它怎么做到"背景而不覆盖"

只有两处"魔法"：

```css
/* 1) 把外壳底色变量改透明。面板/卡片/代码块用的是**别的**变量，一律不动，
      所以文字永远落在实心底上，可读性一点不损失。 */
html body {
  --dsw-alias-bg-base: transparent;
  --dsw-specific-sidebar-fill: rgba(255, 255, 255, .78);   /* 侧栏半透 */
}

/* 2) 底图放 z-index:-1 —— 在所有正常流内容之下，且不拦点击 */
#dsh-cw-bg { position: fixed; inset: 0; z-index: -1; pointer-events: none; }
```

上面再压一层**纱**（`linear-gradient`）：浅色主题压白纱、深色主题压深纱。

> 主题判定**不猜 DSH 内部的标记名**：JS 先扫 `html`/`body` 上所有属性找 `dark`，
> 再兜底量一次外壳底色亮度，然后把结果写成**自己的 class**（`dsh-cw-dark` / `dsh-cw-light`），
> CSS 只读这个 class。这样 DSH 内部标记怎么改名都不影响。

---

## 交叉叠化：这个插件里最难的一段

**问题**：开机动画的结尾是淡出，开场视频的开头如果也淡入，**两段淡的交界处两层都不够实**，
中间就会闪出聊天窗口。

**做法**：**让别人的淡出变成我的叠化** —— 在他开始淡的那一瞬间，我已经满不透明地待在他下面。

这需要精确知道他什么时候开始淡。我们读了 `dsh-startup-screen` 的源码，它的收尾是**两步**：

```js
/* dsh-startup-screen/lib/splash.js —— 揭幕 */
root.classList.add('dsu-handoff')   // ★ 第 1 步：根元素【开始】淡出
await wait(780)                      //   整整 780ms
finish()                             // 第 2 步：这才加 dsu-gone（再淡 620ms）
```

```css
/* dsh-startup-screen/lib/splash.css:791 */
#dsh-startup-root.dsu-handoff {
  transform: scale(1.035);
  filter: blur(5px);
  opacity: 0;                                        /* ★ 这里就开始透了 */
  transition: opacity 780ms cubic-bezier(.4, 0, .2, 1), ...;
}
```

**所以：**

```
t=0      dsu-handoff  → 开始淡出（780ms，带推进 + 失焦的运镜）↘
                                                                ← 我已经满不透明地等在下面
t=780    dsu-gone     → （此时早就透明了）
t=1400   根元素被移除
```

> ⚠️ **只盯 `dsu-gone` 会晚 780ms** —— 那 780ms 里开机动画一路在变透明、
> 已经在把聊天窗口透出来了，用户看到的就是"闪一下"。**这是我们踩过的坑。**

信号 class 是可配置的（`bootLeaveClasses`），换别的开机动画插件时改这一行即可。

**代价（诚实说明）**：叠化意味着视频在淡出过程中就已经开播，
所以片头最前面约 0.4～0.7 秒会有部分被正在淡出的开机动画盖着。
这是"绝不闪屏"的取舍 —— 我们认为值得。

第二处衔接（视频 → 你的底图）同理：视频层淡出的**同时**底图在下面逐渐露出，
本身就是叠化，不用额外处理。

---

## 安装

```bash
# 1) 装插件（把 <本仓库路径> 换成你 clone 下来的位置）
dsh plugin --profile <你的 profile> add link:<本仓库路径>

# 2) 重启 DSH（见「踩过的坑」最后两条：改 lib/*.js 之后必须重启，不能只刷新）
```

> 本插件**没有构建步骤**：`lib/index.js`（宿主半边）和 `lib/client.js`（浏览器半边）
> 都是手写的、直接可加载的文件。

---

## 换视频 / 换底图

**换视频** —— 丢进这个文件夹就会自动用（按修改时间，最新的赢）：

```
~/.dsh/boot-animation/videos/
```

**换底图** —— 丢进这个文件夹就会自动用：

```
~/.dsh/chat-wallpaper/
```

支持 `jpg / jpeg / png / webp / gif / avif / bmp`。
**不丢图** → 开场播完淡出后，回到 DSH 默认底色。

也可以不用文件夹，两个都在配置里指定绝对路径（见下）。

---

## 设置面板

**左下角有个「🖼 背景」按钮** —— 点开就是全部设置：

```
┌─ 聊天背景 ──────────────────────────────────┐
│ 当前：我的背景.jpg                           │
│ 丢图目录：…/.dsh/chat-wallpaper              │
│                                             │
│ [缩略图][缩略图][缩略图]                      │  ← 点一下即换
│                                             │
│ [不用图片]   [打开图片文件夹]                 │  ← 后者直接弹资源管理器
│                                             │
│ 纱的浓度（深色主题）  50%                     │
│ ▬▬▬▬▬●▬▬▬▬▬                                 │  ← 拖完立刻生效，不用刷新
│                                             │
│ 开场视频：● 全屏开场：播一次 → 淡出 → 进聊天    │
│           ○ 常驻背景：在聊天窗口后面一直循环    │
└─────────────────────────────────────────────┘
```

**面板独立于壁纸层**（自己的根元素 + 自己的 style 标签 + 自己的主题 class）——
所以开场播完、视频层被移除之后，设置入口**仍然在**。

---

## 配置项

`~/.dsh/chat-wallpaper.json`（**改配置只需刷新页面**；改代码要重启）：

```jsonc
{
  "video": "",                    // 绝对路径；空 = 自动（扫 ~/.dsh/boot-animation/videos/）
  "objectFit": "cover",           // 常驻背景模式下用；全屏开场固定 cover
  "opacity": 1,                   // 视频层不透明度
  "playbackRate": 1,              // 1 = 正常速度

  // 视频放哪
  "placement": "front",           // front = 全屏盖在最前面（第二幕）| behind = 放后面当背景

  // 播完之后
  "mode": "once",                 // once = 播一次 → 淡出 → 进聊天 | loop = 常驻循环（配 behind）
  "fadeOutMs": 1200,              // once 的淡出时长

  // 聊天底图（独立于视频）：留空 = 自动用 ~/.dsh/chat-wallpaper/ 里最新那张
  "image": "",
  "imageFit": "cover",

  // 只在 mode="loop" 时用得上：第一次从头播完，之后只在 [loopStart, loopEnd] 里循环
  // loopStart 可以直接写剪辑软件的时间码，宿主按 fps 换算成秒
  "loopStart": "00:00:05:23",
  "loopEnd": "",                  // 留空 = 到视频结尾
  "fps": 24,

  // 什么时候开始播：等开机动画收场再播（否则片头会被开机动画盖过去）
  "waitForBoot": true,
  "bootOverlaySelectors": ["#dsh-startup-root"],
  // 开机动画"开始离场"的信号 class —— 决定叠化时机，换插件时改这里
  "bootLeaveClasses": ["dsu-handoff", "dsu-gone"],

  // 纱（底图上的可读性保险）：浅色主题压白纱、深色主题压深纱
  "veilLightA": "rgba(253,250,254,.80)",
  "veilLightB": "rgba(250,247,253,.68)",
  "sidebarLight": "rgba(255,255,255,.78)",
  "fallbackLight": "#f7f1f8",
  "veilDarkA": "rgba(8,10,16,.50)",
  "veilDarkB": "rgba(6,8,14,.38)",
  "sidebarDark": "rgba(22,24,32,.74)",
  "fallbackDark": "#0b0d12"
}
```

> 只改配置 / 换图 / 用面板 → **刷新页面即可**（但注意：在 Electron 的 DevTools 里
> 要先按 `F12` 打开开发者工具，`Ctrl+R` 才会真正绕过缓存）。

---

## 诊断与工具

| 端点 | 用途 |
|---|---|
| `GET /chat-wallpaper/status` | 现在解析到哪个视频/哪张图、来源、丢图目录、循环时间码换算成多少秒 |
| `GET /chat-wallpaper/config` | 客户端实际收到的配置 |
| `GET /chat-wallpaper/images` | 设置面板用：图清单 + 当前选中 |
| `GET /chat-wallpaper/video` | 视频流（带 Range 支持 —— `<video>` 需要它） |
| `GET /chat-wallpaper/image` | 底图（`?name=xxx` 可指定丢图目录里的某一张） |

浏览器控制台里所有日志都带 `[chat-wallpaper]` 前缀，第一行是 **`client build cw-N 已加载`**
—— 出问题时先看这个号，一眼分清"代码有问题"还是"浏览器跑的是旧包"。

**两个开箱可用的检查工具**（不需要装 ffmpeg）：

```bash
# 看视频规格：真实分辨率 / 帧率 / 时长 / 是否 faststart / 编码 / 关键帧位置
node test/inspect-mp4.mjs "你的视频.mp4"

# 只看帧率（读 stts 表，判定是恒定帧率还是可变帧率）
node test/probe-fps.mjs "你的视频.mp4"
```

> 这两个是纯 Node 的 MP4 盒解析器：分辨率取 `tkhd` / `stsd`，帧率取 `stts`，
> faststart 看 `moov` 是否在 `mdat` 之前，关键帧读 `stss`。
> **循环点如果恰好落在关键帧上，跳转才是无缝的** —— 用它们查过再决定要不要用循环模式。

---

## 测试

**八个测试套件，全部不需要启动 DSH**（用 `node:vm` + 手写的 DOM 桩）：

```bash
npm test
```

| 套件 | 守什么 |
|---|---|
| `smoke-client` | CSS 生成、主题判定（含"透明底不能当纯黑"那条） |
| `smoke-mount` | **挂载幂等**（防"点一下窗口背景闪一下并从 0 重播"）+ 循环区间 |
| `smoke-start` | **起始时机闸门**：开机动画期间**层都不许挂**；`dsu-handoff` 一到就上场 |
| `smoke-once` | `once` 播完 → 淡出 → 进聊天；两层解耦；**复活回归**；front 模式不吞点击 |
| `smoke-timecode` | `HH:MM:SS:FF` → 秒的换算（含交叉验证） |
| `smoke-panel` / `smoke-panel-client` | 设置面板：列图、选中态、**面板不被壁纸收场带走** |
| `smoke-host` | Cordis 契约（只认 `default` 导出） |

### 红绿对照：怎么证明回归测试真的抓得住 bug

**这一步是本仓库测试方法的重点。**

写回归测试时最容易犯的错是：**测试通过，但其实根本没走到 bug 那条路上**。
所以我们准备了一个对照工具：

```bash
# 造一个"故意没修"的副本（去掉 teardown 里的 current = null）
node test/make-nofix.mjs

# 拿它跑同一个测试 —— 应该【变红】
node test/smoke-once.mjs test/client.nofix.js
```

`test/make-nofix.mjs` 会生成 `test/client.nofix.js`（已被 `.gitignore` 忽略）。
**如果它跑出来还是绿的，说明这条测试没在测它该测的东西** ——
我们就是这样发现了两个"看起来通过、其实什么都没证明"的测试。

---

## 踩过的坑（都留了回归测试）

| 坑 | 症状 | 根因 |
|---|---|---|
| **壁纸"复活"** | 淡出看到了，但动画还在后面**一直 loop**，而且不再跟在开机动画后面 | `teardown()` 没清 `current`；更根本的是主题观察者里那句 `if (!mounted) applyNow(current)` —— 层一被移除它就**把壁纸重新挂起来**。**现在观察者只许换主题 class，绝不许挂载。** |
| **开机时机的几何误判** | 一进界面就在放，片头白做 | 用"零尺寸就算已收场"判断开机浮层 —— 而浮层刚插进 DOM 时往往就是零尺寸。改成只认它自己的 class。 |
| **全屏层吞掉所有点击** | 点哪都在控制动画，界面没法操作 | 给全屏层加了 `click → 跳过`。**全屏层永远 `pointer-events: none`。** |
| **点一下就开播** | 鼠标一点视频就播，用户没法操作 | 加了"第一次用户手势补一次 `play()`"。**全屏开场必须自动播、自动收，不能把点击当开关。** |
| **对未加载的 video 设 currentTime** | 全屏层停在第一帧、不播、盖住界面，直到看门狗才收 | 对还没 `loadedmetadata` 的元素设 `currentTime` 会让它卡在 seek 状态、`play()` 永不生效。**只在 `readyState >= 1` 时设；并先预加载。** |
| **叠化晚了 780ms** | 开机动画与视频之间闪一下聊天窗口 | 只盯 `dsu-gone`，而它**开始**淡出是更早的 `dsu-handoff`（780ms）。 |
| **改代码之后只刷新** | `web boot: 1 entry did not activate`，应用起不来 | 在宿主**运行期间**改插件客户端文件 → 宿主登记表的 `rev` 过期 → 404 → 入口没激活 → DSH 拒绝启动。**改 `lib/*.js` → 重启；改配置/换图 → 刷新。** 启动失败时用对话框里的「禁用第三方插件、备份 profile patch 并重启」兜底。 |
| **测试没在测该测的东西** | 回归测试全绿，但 bug 照样发作 | 测试直接调内部函数、绕过了真实入口（`applyNow` 才是设 `current` 的地方）。**红绿对照**才查出来。 |

---

## 致谢与来源

这个插件的两个关键做法**不是我们想出来的**，而且它**依赖另一个插件的内部约定**。
在此逐条说清楚：

### 1. [`KylinQ01/dsh-startup-animation`](https://github.com/KylinQ01/dsh-startup-animation) — MIT

**用到了：**「把外壳底色改透明，从而让背景露出来」这个核心手法。
本插件的 `--dsw-alias-bg-base: transparent` + `--dsw-specific-sidebar-fill` 那套写法，
以及"面板/卡片用的是别的变量、所以文字不受影响"这个判断，都来自该项目已验证过的实现。

**改动：** 我们没有复制它的代码，但**照搬了这个手法**，并在此基础上加了
"两套纱（浅色/深色）"和"自己写主题 class 而不猜 DSH 的内部标记"这两层。

### 2. [`dsh-startup-screen`](https://github.com/6shenhonghong9/dsh-startup-screen) — 开机动画插件

**用到了：** 它的**内部约定**。本插件通过观察 `#dsh-startup-root` 是否带有
`dsu-handoff` / `dsu-gone` 来判断"开机动画什么时候开始收场"，从而实现交叉叠化；
`780ms` / `620ms` 这两个时间常数也是读它的 `splash.js` / `splash.css` 得到的。

**这是耦合，不是复制。** 所以信号 class 做成了可配置项（`bootLeaveClasses`）——
一旦上游改了这组 class 名，改配置即可，不必改代码。感谢作者把动画做得这么细，
尤其是 `dsu-handoff` 那一步（推进 + 失焦）—— 叠化之所以好看，功劳在它。

### 3. [`NativeDog1/dsh-boot-animation`](https://github.com/NativeDog1/dsh-boot-animation)

**用到了：** 本项目开发过程中用作开场素材的那段赛博朋克视频**来自该项目的素材库**，
并由使用者自行超分到 2560×1440。

**⚠️ 本仓库不包含任何视频、音频、图片素材。** 想用哪段视频请自备。

### 4. [DeepSeek Harness](https://github.com/deepseek-ai)

宿主平台本身。宿主半边的写法（`ctx.webServer.register` 路由、`cordis.patch.yml` 的
bundle patch 层、`dsh.client` 浏览器半边约定）都来自 DSH 的插件规范。

### 声明

- 本仓库**没有复制任何第三方代码**，全部实现为独立编写；
- **零媒体**：不含任何视频 / 音频 / 图片 / 字体 / 二进制；
- 上面每一条"用到了"都写进了 `lib/client.js` 与 `lib/index.js` 的注释里 ——
  改这些代码时请保留出处说明。

**如果你要用这个项目里的做法，也请把上面这几位一起 @ 上。**
用了别人的，就说出来。

---

## 许可

[MIT](LICENSE) © 2026 LeeRolling
