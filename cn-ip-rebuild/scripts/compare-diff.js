// Set-difference comparison: what do the other lists have that we don't, and vice versa.
const fs = require('node:fs');
const path = require('node:path');
const DIR = 'files/runtime/compare';

const ip2int = (s) => { const p = s.split('.').map(Number); return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3]; };
const int2ip = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');

function merge(rs) { rs.sort((a, b) => a[0] - b[0]); const m = []; for (const r of rs) { const l = m[m.length - 1]; if (l && r[0] <= l[1] + 1) l[1] = Math.max(l[1], r[1]); else m.push([r[0], r[1]]); } return m; }
function fromCidrs(cidrs) {
  const rs = [];
  for (const c of cidrs) {
    if (c.includes(':')) continue;
    const [ip, pl] = c.split('/'); const p = parseInt(pl, 10);
    if (!Number.isFinite(p)) continue;
    const sz = 2 ** (32 - p); const st = Math.floor(ip2int(ip) / sz) * sz;
    rs.push([st, st + sz - 1]);
  }
  return merge(rs);
}
const total = (rs) => rs.reduce((s, r) => s + (r[1] - r[0] + 1), 0);
function subtract(a, b) { const o = []; for (const [s, e] of a) { let cur = s, done = false; for (const [bs, be] of b) { if (be < cur) continue; if (bs > e) break; if (bs > cur) o.push([cur, Math.min(e, bs - 1)]); cur = Math.max(cur, be + 1); if (cur > e) { done = true; break; } } if (!done && cur <= e) o.push([cur, e]); } return o; }
function toCidr(rs) { const out = []; for (const [s0, e] of rs) { let s = s0; while (s <= e) { let sz = 1; while (s % (sz * 2) === 0 && s + sz * 2 - 1 <= e) sz *= 2; out.push(`${int2ip(s)}/${32 - Math.log2(sz)}`); s += sz; } } return out; }

const lists = {};
for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.json') && !x.startsWith('_'))) {
  const j = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  const cidrs = [];
  for (const r of j.rules || []) for (const c of r.ip_cidr || []) cidrs.push(String(c));
  lists[f.replace('.json', '')] = fromCidrs(cidrs);
}

const ours = lists.ours_V12;
const others = Object.keys(lists).filter((k) => k !== 'ours_V12');

console.log('=== 我们独有 vs 它们独有 ===\n');
for (const k of others) {
  const o = lists[k];
  const weHave = subtract(ours, o);   // 我们有它们没有
  const theyHave = subtract(o, ours); // 它们有我们没有
  console.log(`【vs ${k}】`);
  console.log(`  我们独有: ${weHave.length} 段, ${total(weHave).toLocaleString()} IP`);
  console.log(`  它们独有: ${theyHave.length} 段, ${total(theyHave).toLocaleString()} IP`);
  if (theyHave.length) {
    const c = toCidr(theyHave);
    console.log(`    它们独有的段（最多 12 个）: ${c.slice(0, 12).join('  ')}`);
  }
  if (weHave.length) {
    const c = toCidr(weHave);
    console.log(`    我们独有的段（最多 12 个）: ${c.slice(0, 12).join('  ')}`);
  }
  console.log('');
}

// 它们共同有而我们没有的
console.log('=== 所有对照列表都包含、而我们没有的段 ===');
const common = others.map((k) => lists[k]).reduce((a, b) => {
  const out = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) { const s = Math.max(a[i][0], b[j][0]), e = Math.min(a[i][1], b[j][1]); if (s <= e) out.push([s, e]); if (a[i][1] < b[j][1]) i += 1; else j += 1; }
  return out;
});
const commonMissing = subtract(common, ours);
console.log(`  ${commonMissing.length} 段, ${total(commonMissing).toLocaleString()} IP`);
if (commonMissing.length) console.log(`  ${toCidr(commonMissing).slice(0, 25).join('  ')}`);
