/**
 * dsh-chat-wallpaper — host half (宿主半边)
 * ----------------------------------------------------------------------------
 * 只做两件事：
 *   1. 决定"播哪个视频"（配置 → 用户片库 → 内置素材，三级回落）
 *   2. 用一个带 Range 支持的 HTTP 路由把视频喂给渲染进程
 *      —— 必须走 HTTP，`file://` 在渲染进程里放不出来
 *
 * 配置：$DSH_HOME/chat-wallpaper.json（不存在就用默认值）
 *
 * 这一半刻意"绝不抛异常"：壁纸坏了只能是没有壁纸，绝不能影响 DSH 启动。
 */
import { createReadStream, existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join, basename } from 'node:path'

const HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const CONFIG_FILE = join(HOME, 'chat-wallpaper.json')

/** 默认配置。字段与客户端半边一一对应。 */
const DEFAULTS = {
  video: '',                                        // 绝对路径；空 = 自动找
  objectFit: 'cover',                               // cover | contain
  opacity: 1,                                       // 视频本身的不透明度
  playbackRate: 1,                                  // 1 = 正常速度

  /* 视频放哪：
       'front'  全屏盖在聊天窗口**最前面** —— 开机动画之后的"第二幕"，播完淡出进聊天（默认）
       'behind' 放在聊天窗口**后面**当常驻背景（配合 mode='loop'） */
  placement: 'front',

  /* 播完之后怎么办：
       'once'  播一次 → 淡出 → 进聊天（默认）
       'loop'  常驻循环（只在 placement='behind' 时有意义） */
  mode: 'once',
  fadeOutMs: 1200,                                  // mode='once' 时淡出时长

  /* 聊天底图：**独立于视频**。视频播完淡出后，聊天就落在它上面。
     改图 = 改这个路径；留空 = 自动用 ~/.dsh/chat-wallpaper/ 里最新的那张。 */
  image: '',
  imageFit: 'cover',

  /* 大字横幅：铺满窗口的一行大字（**矢量文字，不是图片**，放多大都不糊）。
     用途：视频演完进聊天时，一眼看到那行字。
     字号按窗口自动算（先设 100px 量一次宽度，再等比放大），不用手调。
     留空 = 不要横幅。 */
  banner: '',
  bannerOpacity: 0.12,                              // 建议 0.08 ~ 0.25：够醒目，又不挡聊天文字

  /* 一轮会话只放一次开场（和开机动画同一个策略：它也用 sessionStorage 记）。
     为什么需要：保存 client.js 会触发插件热重载 = 一次页面刷新，
     没有这个标记的话开场会被反复重播。
     想再看一次 → 面板的「🔁 重播开场」。常驻背景模式（behind）不受影响。 */
  oncePerSession: true,

  /* 循环区间（只在 mode='loop' 时有意义）：
     第一次从头播完，之后只在 [loopStart, loopEnd] 里循环。
     loopStart 可以是秒数（5.958），也可以是剪辑软件的时间码（"00:00:05:23"）。
     留空 = 不启用（整段循环）。 */
  loopStart: '',
  loopEnd: '',                                      // 留空 = 到视频结尾
  fps: 24,                                          // 只用于把时间码换算成秒

  /* 什么时候开始播：默认等开机动画收场之后再播。
     不等的话，开机动画盖在上面的十几秒里视频已经把片头放完了 ——
     用户进到界面直接看到循环段，片头白做。
     （客户端半边对这两项有**自己的默认值**，所以默认行为不依赖宿主下发。）*/
  waitForBoot: true,
  bootOverlaySelectors: ['#dsh-startup-root'],      // 给空数组 = 没有浮层要等

  /* 浅色主题：压白纱，侧栏半透白 */
  veilLightA: 'rgba(253,250,254,.80)',
  veilLightB: 'rgba(250,247,253,.68)',
  sidebarLight: 'rgba(255,255,255,.78)',
  fallbackLight: '#f7f1f8',

  /* 深色主题：压深纱，侧栏半透黑 —— 白纱配深色主题的浅色文字会糊成一片 */
  veilDarkA: 'rgba(8,10,16,.74)',
  veilDarkB: 'rgba(6,8,14,.62)',
  sidebarDark: 'rgba(22,24,32,.74)',
  fallbackDark: '#0b0d12'
}

/**
 * 把配置值换算成秒。
 *   · 数字 / 数字字符串  → 直接当秒
 *   · `HH:MM:SS:FF`      → 秒 + 帧/fps   （剪辑软件的时间码就是这个格式）
 *   · 空 / 无效          → null
 *
 * 之所以支持时间码：用户是在 DaVinci 里看时间码定位循环点的（"00:00:05:23"），
 * 让人自己换算成 5.958 秒是给用户找麻烦，而且**很容易算错**。
 */
export function parseTimecode(value, fps = 24) {
  if (value === undefined || value === null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const s = String(value).trim()
  if (s === '') return null
  const tc = /^(\d+):(\d{1,2}):(\d{1,2})[:;.](\d{1,3})$/.exec(s)
  if (tc) {
    const h = +tc[1], m = +tc[2], sec = +tc[3], f = +tc[4]
    const rate = Number(fps) > 0 ? Number(fps) : 24
    return h * 3600 + m * 60 + sec + f / rate
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function readConfig() {
  try {
    if (!existsSync(CONFIG_FILE)) return { ...DEFAULTS }
    const parsed = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))
    const out = { ...DEFAULTS }
    for (const k of Object.keys(DEFAULTS)) {
      if (parsed[k] === undefined || parsed[k] === null) continue
      out[k] = typeof DEFAULTS[k] === 'number' ? Number(parsed[k]) : parsed[k]
    }
    return out
  } catch {
    return { ...DEFAULTS }        // 配置坏了就用默认，不抛
  }
}

/**
 * 写配置。**用 writeFileSync 且不带 BOM** —— 客户端用 JSON.parse(readFileSync(..., 'utf8'))
 * 读它，带 BOM 会静默解析失败并回落默认值（这个坑踩过：整晚的配置都没生效）。
 */
function writeConfig(cfg) {
  try {
    const clean = {}
    for (const k of Object.keys(DEFAULTS)) {
      clean[k] = cfg[k] === undefined ? DEFAULTS[k] : cfg[k]
    }
    writeFileSync(CONFIG_FILE, JSON.stringify(clean, null, 2) + '\n', 'utf8')
    return true
  } catch {
    return false
  }
}

/**
 * 从颜色串里取出 alpha（设置面板的"纱"滑块用）。
 *
 * ⚠️ 只认**四分量**写法。第一版用了个宽松正则 `[,/\s]([\d.]+)\)`，
 * 结果 `rgb(255,255,255)` 被解析成 alpha=255（抓到的是蓝色通道）——
 * 所以这里宁可啰嗦也要把两种合法写法写清楚，其余一律当作完全不透明。
 */
function alphaOf(v) {
  const s = String(v || '')
  // rgba(8,10,16,.50)
  const comma = /rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/.exec(s)
  if (comma) { const a = parseFloat(comma[1]); if (a >= 0 && a <= 1) return a }
  // rgb(8 10 16 / 50%)  或  rgb(8 10 16 / 0.5)
  const slash = /rgba?\(\s*[\d.]+\s+[\d.]+\s+[\d.]+\s*\/\s*([\d.]+)(%?)\s*\)/.exec(s)
  if (slash) {
    let a = parseFloat(slash[1])
    if (slash[2] === '%') a /= 100
    if (a >= 0 && a <= 1) return a
  }
  return 1        // rgb() 没有 alpha / 不认识的写法 → 完全不透明
}

/** 用户片库目录（与 dsh-boot-animation 共用，超分后的成品丢这儿即可） */
function userClipDirs() {
  const dir = join(HOME, 'boot-animation')
  return [join(dir, 'videos'), dir]
}

/**
 * 用户片库里的候选视频，**按修改时间从新到旧**。
 *
 * 为什么不用字母序：我们踩过 —— `cyberpunk-1440p-loop.mp4` 和 `cyberpunk-1440p.mp4`
 * 谁在前面取决于 `-`(0x2D) 与 `.`(0x2E) 的码位顺序，而 PowerShell 的排序规则又不一样，
 * 结果"预测"和"实际"对不上。**"我刚丢进去的那个"才是直觉上该播的**，所以按 mtime 排。
 */
function listUserClips() {
  const out = []
  for (const dir of userClipDirs()) {
    try {
      if (!existsSync(dir)) continue
      for (const f of readdirSync(dir)) {
        if (!/\.(mp4|webm|mov|m4v)$/i.test(f)) continue
        const p = join(dir, f)
        try {
          const s = statSync(p)
          if (s.size <= 64 * 1024) continue
          out.push({ file: p, size: s.size, mtime: s.mtimeMs })
        } catch { /* 忽略单个坏文件 */ }
      }
    } catch { /* 忽略 */ }
  }
  out.sort((a, b) => b.mtime - a.mtime)
  return out
}

function firstUserClip() {
  const list = listUserClips()
  return list.length ? list[0].file : null
}

/** 兜底：任何 profile 里 dsh-boot-animation 自带的 cyberpunk 素材 */
function bundledFallback() {
  try {
    const profiles = join(HOME, 'profiles')
    if (!existsSync(profiles)) return null
    for (const p of readdirSync(profiles)) {
      const f = join(profiles, p, 'node_modules', 'dsh-boot-animation', 'media', 'deepseek-cyberpunk-intro.mp4')
      if (existsSync(f)) return f
    }
  } catch { /* 忽略 */ }
  return null
}

/** 解析"现在到底播哪个文件"，并说明来源 */
function resolveVideo(cfg) {
  if (cfg.video && existsSync(cfg.video)) return { file: cfg.video, source: 'config' }
  const user = firstUserClip()
  if (user) return { file: user, source: 'your-library' }
  const bundled = bundledFallback()
  if (bundled) return { file: bundled, source: 'bundled-fallback' }
  return { file: null, source: 'none' }
}

/**
 * 背景图目录：**丢张图进去就自动换背景**，这就是"换起来方便"的全部机关。
 * （不设上限、不排序，按 mtime 最新的那张赢 —— 和视频一个逻辑。）
 */
function wallpaperImageDir() {
  return join(HOME, 'chat-wallpaper')
}

/** 图片候选：显式配置 > 背景图目录里最新的那张 */
function listImages() {
  const out = []
  const dir = wallpaperImageDir()
  try {
    if (existsSync(dir)) {
      for (const f of readdirSync(dir)) {
        if (!/\.(jpe?g|png|webp|gif|avif|bmp)$/i.test(f)) continue
        const p = join(dir, f)
        try {
          const s = statSync(p)
          if (s.size <= 4 * 1024) continue
          out.push({ file: p, size: s.size, mtime: s.mtimeMs })
        } catch { /* 忽略单个坏文件 */ }
      }
    }
  } catch { /* 忽略 */ }
  out.sort((a, b) => b.mtime - a.mtime)
  return out
}

/** 解析背景图，并说明来源 */
function resolveImage(cfg) {
  if (cfg.image && existsSync(cfg.image)) return { file: cfg.image, source: 'config' }
  const list = listImages()
  if (list.length) return { file: list[0].file, source: 'your-library' }
  return { file: null, source: 'none' }
}

const MIME = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.gif': 'image/gif', '.avif': 'image/avif', '.bmp': 'image/bmp',
}

export default {
  name: 'dsh-chat-wallpaper',
  inject: ['webServer'],
  apply(ctx) {
    const json = (res, status, data) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(data))
    }

    /** GET /chat-wallpaper/config —— 客户端半边启动时读它 */
    const configHandler = (_req, res) => {
      try {
        const cfg = readConfig()
        const { file, source } = resolveVideo(cfg)
        const img = resolveImage(cfg)
        const fps = Number(cfg.fps) > 0 ? Number(cfg.fps) : 24
        /* 时间码在宿主侧就换算成秒，客户端只拿数字 —— 少一处解析就少一处出错 */
        const loopStartSec = parseTimecode(cfg.loopStart, fps)
        const loopEndSec = parseTimecode(cfg.loopEnd, fps)
        json(res, 200, {
          ok: !!file, config: cfg, source, file: file ? file.replace(/\\/g, '/') : null,
          loopStartSec, loopEndSec, fps,
          image: img.file ? img.file.replace(/\\/g, '/') : null,
          imageSource: img.source,
          imageOk: !!img.file,
        })
      } catch (e) {
        json(res, 200, { ok: false, config: { ...DEFAULTS }, source: 'error', error: String(e && e.message) })
      }
    }

    /**
     * GET /chat-wallpaper/image —— 背景图本体。
     *   ?name=xxx.jpg  指定丢图目录里的某一张（设置面板里预览用）
     *   不带参数       当前生效的那张
     * 安全：name 只取 basename，强制落在丢图目录内。
     */
    const imageHandler = (req, res) => {
      try {
        const url = new URL(req.url, 'http://localhost')
        const want = url.searchParams.get('name')
        let file = null
        if (want) {
          const cand = join(wallpaperImageDir(), basename(String(want)))
          if (existsSync(cand)) file = cand
        } else {
          file = resolveImage(readConfig()).file
        }
        if (!file) { res.writeHead(404, { 'cache-control': 'no-store' }); res.end('no image'); return }
        const stat = statSync(file)
        const ext = (file.match(/\.[a-z0-9]+$/i) || ['.jpg'])[0].toLowerCase()
        res.writeHead(200, {
          'Content-Type': MIME[ext] || 'image/jpeg',
          'Content-Length': stat.size,
          'Cache-Control': 'no-cache',
        })
        createReadStream(file).pipe(res)
      } catch (e) {
        try { res.writeHead(500, { 'cache-control': 'no-store' }); res.end('image error') } catch { /* 忽略 */ }
      }
    }

    /** GET /chat-wallpaper/images —— 设置面板用：丢图目录里有哪几张、现在选了谁 */
    const imagesHandler = (_req, res) => {
      try {
        const cfg = readConfig()
        const cur = resolveImage(cfg)
        const dir = wallpaperImageDir()
        json(res, 200, {
          ok: true,
          dropDir: dir.replace(/\\/g, '/'),
          dropDirExists: existsSync(dir),
          mode: cfg.mode,
          placement: cfg.placement,
          current: cur.file ? cur.file.replace(/\\/g, '/') : null,
          imageConfig: cfg.image || '',
          banner: cfg.banner || '',
          bannerOpacity: cfg.bannerOpacity == null ? 0.12 : cfg.bannerOpacity,
          images: listImages().map((c) => {
            const name = c.file.split(/[\\/]/).pop()
            return {
              name,
              url: '/chat-wallpaper/image?name=' + encodeURIComponent(name),
              sizeKB: Math.round(c.size / 1024),
              mtime: new Date(c.mtime).toISOString().slice(0, 19).replace('T', ' '),
            }
          }),
          veil: {
            light: alphaOf(cfg.veilLightA),
            dark: alphaOf(cfg.veilDarkA),
          },
        })
      } catch (e) {
        json(res, 200, { ok: false, error: String(e && e.message) })
      }
    }

    /** POST /chat-wallpaper/open-dir —— 让用户直接看到"该往哪丢图" */
    const openDirHandler = (_req, res) => {
      try {
        const dir = wallpaperImageDir()
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
        spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' }).unref()
        json(res, 200, { ok: true, opened: dir.replace(/\\/g, '/') })
      } catch (e) {
        json(res, 200, { ok: false, error: String(e && e.message) })
      }
    }

    /**
     * POST /chat-wallpaper/set —— 设置面板写回配置。
     * 只接受白名单键，值做长度/类型校验，避免面板把配置写成垃圾。
     */
    const ALLOWED_SET = new Set(['image', 'imageFit', 'mode', 'placement', 'fadeOutMs', 'veilLightA', 'veilLightB', 'veilDarkA', 'veilDarkB', 'opacity', 'playbackRate', 'banner', 'bannerOpacity', 'oncePerSession'])
    const setHandler = (req, res) => {
      let body = ''
      req.on('data', (c) => { body += c; if (body.length > 16384) req.destroy() })
      req.on('end', () => {
        try {
          const patch = JSON.parse(body || '{}')
          const cfg = readConfig()
          const applied = {}
          for (const k of Object.keys(patch)) {
            if (!ALLOWED_SET.has(k)) continue
            const v = patch[k]
            if (k === 'image') {
              /* 只允许：空字符串（不用图）、丢图目录里的文件名、或存在的绝对路径 */
              if (v === '') { cfg.image = ''; applied.image = ''; continue }
              const s = String(v)
              const inDir = join(wallpaperImageDir(), basename(s))
              if (existsSync(inDir)) { cfg.image = inDir; applied.image = s }
              else if (existsSync(s)) { cfg.image = s; applied.image = s }
              continue
            }
            if (typeof v === 'number' && Number.isFinite(v)) { cfg[k] = v; applied[k] = v; continue }
            if (typeof v === 'string' && v.length <= 120) { cfg[k] = v; applied[k] = v }
          }
          writeConfig(cfg)
          json(res, 200, { ok: true, applied, config: readConfig() })
        } catch (e) {
          json(res, 200, { ok: false, error: String(e && e.message) })
        }
      })
    }

    /** GET /chat-wallpaper/video —— 带 Range 的视频流（<video> 需要它） */
    const videoHandler = (req, res) => {
      try {
        const cfg = readConfig()
        const { file } = resolveVideo(cfg)
        if (!file) { res.writeHead(404, { 'cache-control': 'no-store' }); res.end('no video'); return }
        const stat = statSync(file)
        const ext = (file.match(/\.[a-z0-9]+$/i) || ['.mp4'])[0].toLowerCase()
        const type = MIME[ext] || 'video/mp4'
        res.setHeader('Accept-Ranges', 'bytes')
        res.setHeader('Cache-Control', 'no-store')

        const range = req.headers.range
        if (range) {
          const m = /bytes=(\d*)-(\d*)/.exec(range)
          let start = m && m[1] ? parseInt(m[1], 10) : 0
          let end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1
          if (!Number.isFinite(start) || start < 0) start = 0
          if (!Number.isFinite(end) || end >= stat.size) end = stat.size - 1
          if (start > end) {
            res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` })
            res.end()
            return
          }
          res.writeHead(206, {
            'Content-Type': type,
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Content-Length': end - start + 1,
          })
          createReadStream(file, { start, end }).pipe(res)
        } else {
          res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size })
          createReadStream(file).pipe(res)
        }
      } catch (e) {
        try { res.writeHead(500, { 'cache-control': 'no-store' }); res.end('wallpaper error') } catch { /* 忽略 */ }
      }
    }

    /** GET /chat-wallpaper/status —— 诊断：现在解析到哪个文件 */
    const statusHandler = (_req, res) => {
      try {
        const cfg = readConfig()
        const { file, source } = resolveVideo(cfg)
        json(res, 200, {
          source,
          file: file ? file.replace(/\\/g, '/') : null,
          bytes: file ? statSync(file).size : 0,
          configFile: CONFIG_FILE.replace(/\\/g, '/'),
          configFileExists: existsSync(CONFIG_FILE),
          /* 循环区间：原始值 + 换算后的秒数，一眼看出时间码算对没有 */
          loop: (() => {
            const cfg2 = readConfig()
            const f = Number(cfg2.fps) > 0 ? Number(cfg2.fps) : 24
            return {
              rawLoopStart: cfg2.loopStart || '',
              rawLoopEnd: cfg2.loopEnd || '',
              fps: f,
              loopStartSec: parseTimecode(cfg2.loopStart, f),
              loopEndSec: parseTimecode(cfg2.loopEnd, f),
            }
          })(),
          userClipDirs: userClipDirs().map((d) => d.replace(/\\/g, '/')),
          /* 候选清单：谁赢了、为什么赢（按 mtime 从新到旧），一眼看清 */
          candidates: listUserClips().map((c, i) => ({
            pick: i === 0,
            name: c.file.split(/[\\/]/).pop(),
            sizeMB: +(c.size / 1048576).toFixed(2),
            mtime: new Date(c.mtime).toISOString().slice(0, 19),
          })),
          /* 背景图：换背景就看这里。丢图目录 + 候选 + 现在选了谁 */
          image: (() => {
            const cfg3 = readConfig()
            const img = resolveImage(cfg3)
            return {
              source: img.source,
              file: img.file ? img.file.replace(/\\/g, '/') : null,
              bytes: img.file ? (() => { try { return statSync(img.file).size } catch { return 0 } })() : 0,
              dropDir: wallpaperImageDir().replace(/\\/g, '/'),
              candidates: listImages().map((c, i) => ({
                pick: i === 0,
                name: c.file.split(/[\\/]/).pop(),
                sizeMB: +(c.size / 1048576).toFixed(2),
                mtime: new Date(c.mtime).toISOString().slice(0, 19),
              })),
            }
          })(),
        })
      } catch (e) {
        json(res, 200, { source: 'error', error: String(e && e.message) })
      }
    }

    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/chat-wallpaper/config', handler: configHandler }))
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/chat-wallpaper/video', handler: videoHandler }))
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/chat-wallpaper/image', handler: imageHandler }))
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/chat-wallpaper/images', handler: imagesHandler }))
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/chat-wallpaper/set', handler: setHandler }))
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/chat-wallpaper/open-dir', handler: openDirHandler }))
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/chat-wallpaper/status', handler: statusHandler }))

    const { file, source } = resolveVideo(readConfig())
    const img = resolveImage(readConfig())
    console.log(`[chat-wallpaper] host ready · source=${source} · ${file ?? '(没有可用视频)'}`)
    console.log(`[chat-wallpaper] 背景图 · source=${img.source} · ${img.file ?? '(没有背景图，淡出后回到 DSH 默认底色)'}`)
  },
}

/**
 * 测试钩子：把"三级回落到底解析到哪个文件"这段逻辑暴露出来，
 * 这样能在不启动 DSH 的情况下实测，而不是靠读代码推测。
 * Cordis 只取 default 导出，多一个命名导出无害。
 */
export function __resolveForTest() {
  const cfg = readConfig()
  const { file, source } = resolveVideo(cfg)
  let bytes = 0
  try { if (file) bytes = statSync(file).size } catch { /* 忽略 */ }
  return {
    source,
    file: file ? file.replace(/\\/g, '/') : null,
    bytes,
    configVideo: cfg.video || '',
    userClipDirs: userClipDirs().map((d) => d.replace(/\\/g, '/')),
  }
}

/** 设置面板相关逻辑的测试钩子 */
export function __alphaOf(v) { return alphaOf(v) }
export function __listImages() {
  return listImages().map((c) => ({ name: c.file.split(/[\\/]/).pop(), sizeKB: Math.round(c.size / 1024) }))
}
export function __imageDir() { return wallpaperImageDir().replace(/\\/g, '/') }
