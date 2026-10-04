// Fair check: verify OUR unique segments (what we have and the others don't).
const fs = require('node:fs');
const path = require('node:path');

const ip2int = (s) => { const p = s.split('.').map(Number); return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3]; };
const int2ip = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DIR = 'files/runtime/compare';

function merge(rs) { rs.sort((a, b) => a[0] - b[0]); const m = []; for (const r of rs) { const l = m[m.length - 1]; if (l && r[0] <= l[1] + 1) l[1] = Math.max(l[1], r[1]); else m.push([r[0], r[1]]); } return m; }
function fromCidrs(cidrs) {
  const rs = [];
  for (const c of cidrs) { if (c.includes(':')) continue; const [ip, pl] = c.split('/'); const p = parseInt(pl, 10); if (!Number.isFinite(p)) continue; const sz = 2 ** (32 - p); const st = Math.floor(ip2int(ip) / sz) * sz; rs.push([st, st + sz - 1]); }
  return merge(rs);
}
const total = (rs) => rs.reduce((s, r) => s + (r[1] - r[0] + 1), 0);
function subtract(a, b) { const o = []; for (const [s, e] of a) { let cur = s, done = false; for (const [bs, be] of b) { if (be < cur) continue; if (bs > e) break; if (bs > cur) o.push([cur, Math.min(e, bs - 1)]); cur = Math.max(cur, be + 1); if (cur > e) { done = true; break; } } if (!done && cur <= e) o.push([cur, e]); } return o; }

const lists = {};
for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.json') && !x.startsWith('_'))) {
  const j = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  const c = [];
  for (const r of j.rules || []) for (const x of r.ip_cidr || []) c.push(String(x));
  lists[f.replace('.json', '')] = fromCidrs(c);
}
const ours = lists.ours_V12;
const other = lists.MetaCubeX_cn;                 // 代表性对照（BGP 列表）
const uniq = subtract(ours, other);               // 我们独有
console.log(`我们独有: ${uniq.length} 段, ${total(uniq).toLocaleString()} IP\n`);

// 均匀抽 40 个段
const picks = [];
const tot = total(uniq);
for (let i = 0; i < 40; i += 1) {
  const t = Math.random() * tot; let acc = 0, seg = null;
  for (const [s, e] of uniq) { const sz = e - s + 1; if (t < acc + sz) { seg = [s, e]; break; } acc += sz; }
  if (seg) picks.push(seg);
}

(async () => {
  const probes = picks.map(([s, e]) => int2ip(s + Math.floor((e - s) / 2)));
  const info = new Map();
  for (let i = 0; i < probes.length; i += 100) {
    const chunk = probes.slice(i, i + 100);
    for (let a = 0; a < 5; a += 1) {
      try {
        const r = await fetch('http://ip-api.com/batch?fields=query,countryCode,isp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(chunk) });
        if (r.status === 429) { await sleep(9000); continue; }
        for (const it of await r.json()) info.set(it.query, it);
        break;
      } catch { await sleep(3000); }
    }
    await sleep(1400);
  }
  const CN_CARRIER = ['chinanet', 'china telecom', 'chinatelecom', 'china unicom', 'chinaunicom', 'china mobile', 'chinamobile', 'tietong', 'cernet', 'china broadcasting', 'drpeng'];
  console.log('  ' + '网段'.padEnd(22) + '大小'.padEnd(9) + '国家'.padEnd(6) + 'ISP');
  console.log('  ' + '-'.repeat(92));
  let cn = 0, fo = 0;
  picks.forEach(([s, e], i) => {
    const it = info.get(probes[i]) || {};
    const cc = it.countryCode || '??';
    const isp = String(it.isp || '').toLowerCase();
    const carrier = CN_CARRIER.some((c) => isp.includes(c));
    const verdict = (cc === 'CN' || carrier) ? 'CN' : '境外';
    if (verdict === 'CN') cn += 1; else fo += 1;
    const sz = e - s + 1;
    const segStr = sz === 1 ? int2ip(s) : `${int2ip(s)}/${32 - Math.log2(sz)}`;
    console.log('  ' + segStr.padEnd(22) + String(sz).padEnd(9) + cc.padEnd(6) + (it.isp || ''));
  });
  console.log(`\n  我们独有的抽样: CN ${cn}   境外 ${fo}   → ${cn > fo ? '✅ 我们独有的绝大多数是国内' : '⚠️ 存疑'}`);
})();
