// 精确判定帧率：读 stts（time-to-sample）表，确认是不是恒定 24fps
import fs from 'node:fs'

const FILE = process.argv[2]
if (!FILE) { console.error('用法: node probe-fps.mjs <视频文件>'); process.exit(2) }
const buf = fs.readFileSync(FILE)

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl'])

function find(buf, off, end, type, out) {
  while (off + 8 <= end) {
    let size = buf.readUInt32BE(off)
    const t = buf.toString('latin1', off + 4, off + 8)
    let hdr = 8
    if (size === 1) { size = Number(buf.readBigUInt64BE(off + 8)); hdr = 16 }
    else if (size === 0) size = end - off
    if (size < hdr || off + size > end) break
    if (t === type) out.push({ start: off, size, hdr })
    if (CONTAINERS.has(t) || t === 'stsd') {
      find(buf, off + hdr + (t === 'stsd' ? 8 : 0), off + size, type, out)
    }
    off += size
  }
  return out
}

const mdhd = find(buf, 0, buf.length, 'mdhd', [])[0]
const ver = buf[mdhd.start + 8]
const p = mdhd.start + 8 + 4
const timescale = ver === 1 ? buf.readUInt32BE(p + 16) : buf.readUInt32BE(p + 8)
const duration = ver === 1 ? Number(buf.readBigUInt64BE(p + 20)) : buf.readUInt32BE(p + 12)

const stts = find(buf, 0, buf.length, 'stts', [])[0]
const entryCount = buf.readUInt32BE(stts.start + 8 + 4)
const entries = []
for (let i = 0; i < entryCount; i++) {
  const o = stts.start + 8 + 8 + i * 8
  entries.push({ count: buf.readUInt32BE(o), delta: buf.readUInt32BE(o + 4) })
}

console.log('文件        :', FILE.split('/').pop())
console.log('timescale   :', timescale)
console.log('duration    :', duration)
console.log('时长        :', (duration / timescale).toFixed(4), 's')
console.log('')
console.log('stts 表     : entry_count =', entryCount)
entries.forEach((e) => {
  console.log(`              ${e.count} 帧 × delta ${e.delta} ticks = ${(e.count * e.delta / timescale).toFixed(4)} s`)
})
const totalFrames = entries.reduce((a, e) => a + e.count, 0)
console.log('总帧数      :', totalFrames)
console.log('')

if (entryCount === 1) {
  const fps = timescale / entries[0].delta
  console.log('★ 结论：单一条目 → 恒定帧率 (CFR)')
  console.log(`★ 帧率 = ${timescale} / ${entries[0].delta} = ${fps}`)
  console.log(`★ ${fps === 24 ? '是 24fps（精确，无小数误差）' : `不是 24，而是 ${fps}`}`)
} else {
  console.log('★ 多个条目 → 可能是可变帧率 (VFR)，平均 fps =', (totalFrames / (duration / timescale)).toFixed(4))
}
