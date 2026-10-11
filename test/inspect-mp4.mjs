// MP4 深度体检：容器结构 / faststart / 编码 / 分辨率 / 音轨 / 旋转
import fs from 'node:fs'
import crypto from 'node:crypto'

const TARGET = process.argv[2]
if (!TARGET) { console.error('用法: node inspect-mp4.mjs <视频文件>'); process.exit(2) }
const ORIGINAL = process.env.WALLPAPER_COMPARE || ''   // 可选：拿它做对照

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'mvex', 'udta', 'dinf'])

function scan(buf, off, end, want, depth, out, pathStr) {
  while (off + 8 <= end) {
    let size = buf.readUInt32BE(off)
    const type = buf.toString('latin1', off + 4, off + 8)
    let hdr = 8
    if (size === 1) { size = Number(buf.readBigUInt64BE(off + 8)); hdr = 16 }
    else if (size === 0) size = end - off
    if (size < hdr || off + size > end) break
    const entry = { type, start: off, size, hdr, depth, path: pathStr + '/' + type }
    if (want.has(type)) out.push(entry)
    if (CONTAINERS.has(type)) {
      let inner = off + hdr
      if (type === 'stsd') inner = off + hdr + 8
      scan(buf, inner, off + size, want, depth + 1, out, pathStr + '/' + type)
    }
    off += size
  }
  return out
}

/** 顶层盒顺序（faststart 判定的关键） */
function topLevel(buf) {
  const out = []
  let off = 0
  while (off + 8 <= buf.length) {
    let size = buf.readUInt32BE(off)
    const type = buf.toString('latin1', off + 4, off + 8)
    if (size === 1) size = Number(buf.readBigUInt64BE(off + 8))
    else if (size === 0) size = buf.length - off
    if (size < 8) break
    out.push({ type, size, offset: off })
    off += size
  }
  return out
}

function inspect(file, label) {
  if (!fs.existsSync(file)) { console.log(`\n### ${label}\n  ✗ 文件不存在: ${file}`); return null }
  const buf = fs.readFileSync(file)
  console.log('\n' + '='.repeat(74))
  console.log(`### ${label}`)
  console.log(`    ${file.replace(/\\/g, '/')}`)
  console.log('='.repeat(74))

  const r = { file, bytes: buf.length }
  r.sha256 = crypto.createHash('sha256').update(buf).digest('hex')

  // ── 顶层盒顺序 ──
  const top = topLevel(buf)
  console.log('\n  【顶层盒顺序】')
  top.forEach((b, i) => console.log(`    ${i + 1}. ${b.type.padEnd(6)} ${(b.size / 1048576).toFixed(2)} MB  @${b.offset}`))
  const moovIdx = top.findIndex((b) => b.type === 'moov')
  const mdatIdx = top.findIndex((b) => b.type === 'mdat')
  r.faststart = moovIdx >= 0 && mdatIdx >= 0 && moovIdx < mdatIdx
  console.log(`\n  【faststart】moov 在 mdat ${r.faststart ? '之前 ✓ 可以边下边播' : '之后 ✗ 必须整个下完才播'}（moov=#${moovIdx + 1}, mdat=#${mdatIdx + 1}）`)

  // ── 盒子细节 ──
  const boxes = scan(buf, 0, buf.length, new Set(['ftyp', 'tkhd', 'mdhd', 'hdlr', 'avc1', 'hvc1', 'hev1', 'vp09', 'av01', 'mp4a', 'ac-3', 'stsz', 'avcC', 'stss', 'elst']), 0, [], '')

  // 主品牌
  const ftyp = boxes.find((b) => b.type === 'ftyp')
  if (ftyp) {
    const major = buf.toString('latin1', ftyp.start + 8, ftyp.start + 12)
    const brands = []
    for (let o = ftyp.start + 16; o + 4 <= ftyp.start + ftyp.size; o += 4) brands.push(buf.toString('latin1', o, o + 4))
    r.majorBrand = major
    r.brands = brands
    console.log(`\n  【容器品牌】major=${major}  compatible=[${brands.join(' ')}]`)
  }

  // 轨道类型
  const hdlrs = boxes.filter((b) => b.type === 'hdlr')
  const tracks = hdlrs.map((h) => buf.toString('latin1', h.start + 8 + 8, h.start + 8 + 12))
  console.log(`  【轨道】${tracks.map((t) => ({ vide: '视频', soun: '音频', meta: '元数据', hint: '提示' }[t] || t)).join(' + ') || '(未识别)'}`)
  r.tracks = tracks

  // 视频编码 + 分辨率
  const vcodec = ['avc1', 'hvc1', 'hev1', 'vp09', 'av01'].map((t) => [t, boxes.find((b) => b.type === t)]).find(([, b]) => b)
  if (vcodec) {
    const [fourcc, b] = vcodec
    const w = buf.readUInt16BE(b.start + 8 + 16)
    const h = buf.readUInt16BE(b.start + 8 + 18)
    r.codec = fourcc; r.w = w; r.h = h
    console.log(`  【视频编码】${fourcc}  ${w}x${h}`)
    if (fourcc === 'avc1' || fourcc === 'hvc1' || fourcc === 'hev1') {
      const avcC = boxes.find((x) => x.type === 'avcC')
      if (avcC) {
        const profile = buf[avcC.start + 8 + 1]
        const level = buf[avcC.start + 8 + 3]
        const PROFILES = { 66: 'Baseline', 77: 'Main', 88: 'Extended', 100: 'High', 110: 'High 10', 122: 'High 4:2:2', 244: 'High 4:4:4' }
        r.profile = PROFILES[profile] || profile
        console.log(`  【编码档次】${r.profile} (profile_idc=${profile})  level=${(level / 10).toFixed(1)}`)
      }
    }
  }

  // 音频编码
  const acodec = ['mp4a', 'ac-3'].map((t) => [t, boxes.find((b) => b.type === t)]).find(([, b]) => b)
  r.audio = acodec ? acodec[0] : null
  console.log(`  【音频轨道】${r.audio ? r.audio : '无（静音视频）'}`)

  // tkhd 分辨率 + 旋转
  const tkhd = boxes.find((b) => b.type === 'tkhd')
  if (tkhd) {
    const e = tkhd.start + tkhd.size
    const tw = buf.readUInt32BE(e - 8) / 65536
    const th = buf.readUInt32BE(e - 4) / 65536
    r.tkhdW = tw; r.tkhdH = th
    // 旋转：看矩阵 a b c d (offset 40..)
    const mStart = tkhd.start + 8 + 4 + (buf[tkhd.start + 8] === 1 ? 32 : 20) + 8 + 2 + 2 + 2 + 2
    const a = buf.readInt32BE(mStart) / 65536, bb = buf.readInt32BE(mStart + 4) / 65536
    const rot = Math.round(Math.atan2(bb, a) * 180 / Math.PI)
    r.rotation = rot
    console.log(`  【显示尺寸】${tw}x${th}   旋转 ${rot}°  ${rot !== 0 ? '⚠️ 有旋转矩阵' : ''}`)
  }

  // 时长 / fps
  const mdhd = boxes.find((b) => b.type === 'mdhd')
  if (mdhd) {
    const ver = buf[mdhd.start + 8]
    const p = mdhd.start + 8 + 4
    const timescale = ver === 1 ? buf.readUInt32BE(p + 16) : buf.readUInt32BE(p + 8)
    const duration = ver === 1 ? Number(buf.readBigUInt64BE(p + 20)) : buf.readUInt32BE(p + 12)
    r.duration = duration / timescale
    console.log(`  【时长】${r.duration.toFixed(3)}s  (timescale ${timescale}, duration ${duration})`)
  }
  const stsz = boxes.find((b) => b.type === 'stsz')
  if (stsz) {
    r.frames = buf.readUInt32BE(stsz.start + 8 + 8)
    if (r.duration) r.fps = r.frames / r.duration
    console.log(`  【帧数/帧率】${r.frames} 帧  ≈ ${(r.fps || 0).toFixed(2)} fps`)
  }
  if (boxes.find((b) => b.type === 'stss')) {
    const stss = boxes.find((b) => b.type === 'stss')
    r.keyframes = buf.readUInt32BE(stss.start + 8 + 4)
    console.log(`  【关键帧】${r.keyframes} 个（有 stss 表）`)
  } else {
    console.log('  【关键帧】无 stss 表 → 所有帧都是关键帧（体积会大，但随机访问最快）')
  }

  if (r.duration) {
    r.bitrate = (buf.length * 8) / r.duration
    console.log(`  【体积/码率】${(buf.length / 1048576).toFixed(2)} MB  ${(r.bitrate / 1e6).toFixed(2)} Mbps`)
  }
  console.log(`  【SHA256】${r.sha256.slice(0, 32)}…`)
  return r
}

const a = inspect(TARGET, '① 你超分后的文件')
const b = inspect(ORIGINAL, '② 原素材（对照）')

if (a && b) {
  console.log('\n' + '='.repeat(74))
  console.log('### 对比结论')
  console.log('='.repeat(74))
  const rows = [
    ['分辨率', `${b.w}x${b.h}`, `${a.w}x${a.h}`],
    ['时长', `${b.duration.toFixed(2)}s`, `${a.duration.toFixed(2)}s`],
    ['帧率', `${b.fps.toFixed(2)}`, `${a.fps.toFixed(2)}`],
    ['编码', b.codec, a.codec],
    ['档次', b.profile || '-', a.profile || '-'],
    ['音频', b.audio ? '有' : '无', a.audio ? '有' : '无'],
    ['旋转', `${b.rotation}°`, `${a.rotation}°`],
    ['faststart', b.faststart ? '✓' : '✗', a.faststart ? '✓' : '✗'],
    ['体积', `${(b.bytes / 1048576).toFixed(2)} MB`, `${(a.bytes / 1048576).toFixed(2)} MB`],
    ['码率', `${(b.bitrate / 1e6).toFixed(2)} Mbps`, `${(a.bitrate / 1e6).toFixed(2)} Mbps`],
  ]
  console.log('  项目        原素材           你超分后')
  for (const [k, x, y] of rows) console.log(`  ${k.padEnd(10)}  ${String(x).padEnd(16)} ${y}`)

  console.log('\n### 判定')
  const problems = []
  if (!a.faststart) problems.push('faststart ✗ —— moov 在文件尾，视频要整个下完才播（会触发 25s 看门狗）')
  if (!/^(avc1|vp09|av01)$/.test(a.codec || '')) problems.push(`编码 ${a.codec} —— Electron/Chromium 对 HEVC(hvc1/hev1) 支持不可靠，建议重编成 H.264`)
  if (a.audio) problems.push('带音轨 —— 这个是静音背景，建议去掉音轨省体积')
  if (a.rotation !== 0) problems.push(`旋转 ${a.rotation}° —— 可能显示成竖屏或错位`)
  if (a.duration && b.duration && Math.abs(a.duration - b.duration) > 0.5) problems.push(`时长差 ${Math.abs(a.duration - b.duration).toFixed(2)}s —— 超分后帧数/时长变了`)
  if (a.profile && /4:4:4|4:2:2/.test(a.profile)) problems.push(`档次 ${a.profile} —— 非 4:2:0，部分解码器不支持`)
  if (a.bitrate && b.bitrate && a.bitrate < b.bitrate * 0.8) problems.push(`码率比原素材还低（${(a.bitrate/1e6).toFixed(2)} < ${(b.bitrate/1e6).toFixed(2)} Mbps）—— 分辨率提上去了但码率没跟上`)

  if (!problems.length) console.log('  ✓ 全部合格，可以直接用')
  else problems.forEach((p) => console.log('  ⚠️ ' + p))
}
