// Head-to-head: our cn_ip_final.srs vs the popular CN IP lists.
//
//  Recall    : 从参考并集(BGP ∪ MaxMind ∪ APNIC)抽样，各列表覆盖多少
//  Precision : 从 MaxMind 判非CN 的空间抽样，各列表误收多少
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
    const [ip, pl] = c.split('/');
    const p = parseInt(pl, 10);
    if (!Number.isFinite(p)) continue;
    const sz = 2 ** (32 - p);
    const st = Math.floor(ip2int(ip) / sz) * sz;
    rs.push([st, st + sz - 1]);
  }
  return merge(rs);
}
const total = (rs) => rs.reduce((s, r) => s + (r[1] - r[0] + 1), 0);
function has(rs, n) { let lo = 0, hi = rs.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (n < rs[m][0]) hi = m - 1; else if (n > rs[m][1]) lo = m + 1; else return true; } return false; }
function subtract(a, b) { const o = []; for (const [s, e] of a) { let cur = s, done = false; for (const [bs, be] of b) { if (be < cur) continue; if (bs > e) break; if (bs > cur) o.push([cur, Math.min(e, bs - 1)]); cur = Math.max(cur, be + 1); if (cur > e) { done = true; break; } } if (!done && cur <= e) o.push([cur, e]); } return o; }
function sampleFrom(ranges, n) {
  const tot = total(ranges); const out = [];
  for (let i = 0; i < n; i += 1) { const t = Math.random() * tot; let acc = 0, pick = null; for (const [s, e] of ranges) { const sz = e - s + 1; if (t < acc + sz) { pick = s + Math.floor(t - acc); break; } acc += sz; } if (pick != null) out.push(pick); }
  return out;
}

// 载入所有列表
const lists = {};
for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.json') && !x.startsWith('_'))) {
  const j = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  const cidrs = [];
  for (const r of j.rules || []) for (const c of r.ip_cidr || []) cidrs.push(String(c));
  lists[f.replace('.json', '')] = { ranges: fromCidrs(cidrs), cidrs };
}

// 参考源
const OP = fromCidrs(fs.readFileSync('files/runtime/china-operator.txt', 'utf8').split('\n').map((s) => s.trim()).filter(Boolean));
const MM = merge(JSON.parse(fs.readFileSync('files/runtime/maxmind-cn-ranges.json', 'utf8')));
const APNIC = merge(JSON.parse(fs.readFileSync('files/runtime/apnic-cn-ranges.json', 'utf8')).A);
const UNION = merge([...OP, ...MM, ...APNIC]);
const MM_NONCN = subtract([[0, 0xffffffff]], MM);

console.log('=== 规模对比 ===');
console.log('  ' + '列表'.padEnd(20) + 'CIDR'.padEnd(9) + 'IPv4 覆盖');
console.log('  ' + '-'.repeat(52));
for (const [k, v] of Object.entries(lists)) {
  console.log('  ' + k.padEnd(20) + String(v.cidrs.filter((c) => !c.includes(':')).length).padEnd(9) + total(v.ranges).toLocaleString());
}
console.log('  ' + '参考并集(3源)'.padEnd(20) + ''.padEnd(9) + total(UNION).toLocaleString());

// Recall 测试
const N = 3000;
const probes = sampleFrom(UNION, N);
console.log(`\n=== Recall 测试（从三源并集抽 ${N} 个，看各列表覆盖多少）===`);
const res = [];
for (const [k, v] of Object.entries(lists)) {
  let hit = 0;
  for (const n of probes) if (has(v.ranges, n)) hit += 1;
  res.push([k, hit]);
}
res.sort((a, b) => b[1] - a[1]);
for (const [k, hit] of res) {
  console.log(`  ${k.padEnd(20)} ${String(hit).padStart(5)}/${N} = ${(hit / N * 100).toFixed(2)}%`);
}

// Precision 测试（从 MaxMind 非CN 空间抽样）
const M = 3000;
const fprobes = sampleFrom(MM_NONCN, M);
console.log(`\n=== Precision 测试（从 MaxMind 非CN 空间抽 ${M} 个，看各列表误收多少）===`);
const res2 = [];
for (const [k, v] of Object.entries(lists)) {
  let hit = 0;
  for (const n of fprobes) if (has(v.ranges, n)) hit += 1;
  res2.push([k, hit]);
}
res2.sort((a, b) => a[1] - b[1]);
for (const [k, hit] of res2) {
  console.log(`  ${k.padEnd(20)} ${String(hit).padStart(5)}/${M} = ${(hit / M * 100).toFixed(2)}%   估算误收 ≈ ${Math.round(hit / M * total(MM_NONCN)).toLocaleString()} IP`);
}
