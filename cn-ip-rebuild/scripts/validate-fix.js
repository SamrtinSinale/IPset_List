// Follow-up: fix the A2 design and expose the actual leaked IPs.
//   A1'  列表内均匀抽样 2000  -> 列出被判境外的样本及其 ISP
//   A2'  V12 ∩ 低置信区抽样   -> 风险区在 V12 里的真实漏留率
const fs = require('node:fs');
const path = require('node:path');
const maxmind = require(path.join(__dirname, 'mm', 'node_modules', 'maxmind'));

const ip2int = (s) => { const p = s.split('.').map(Number); return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3]; };
const int2ip = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function merge(rs) { rs.sort((a, b) => a[0] - b[0]); const m = []; for (const r of rs) { const l = m[m.length - 1]; if (l && r[0] <= l[1] + 1) l[1] = Math.max(l[1], r[1]); else m.push([r[0], r[1]]); } return m; }
function loadRanges(f) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8')); const rs = [];
  for (const r of j.rules || []) for (const c of r.ip_cidr || []) {
    if (!c.includes('.') || c.includes(':')) continue;
    const [ip, pl] = c.split('/'); const sz = 2 ** (32 - parseInt(pl, 10)); const st = Math.floor(ip2int(ip) / sz) * sz;
    rs.push([st, st + sz - 1]);
  }
  return merge(rs);
}
const total = (rs) => rs.reduce((s, r) => s + (r[1] - r[0] + 1), 0);
function intersect(a, b) { const o = []; let i = 0, j = 0; while (i < a.length && j < b.length) { const s = Math.max(a[i][0], b[j][0]), e = Math.min(a[i][1], b[j][1]); if (s <= e) o.push([s, e]); if (a[i][1] < b[j][1]) i += 1; else j += 1; } return o; }
function subtract(a, b) { const o = []; for (const [s, e] of a) { let cur = s, done = false; for (const [bs, be] of b) { if (be < cur) continue; if (bs > e) break; if (bs > cur) o.push([cur, Math.min(e, bs - 1)]); cur = Math.max(cur, be + 1); if (cur > e) { done = true; break; } } if (!done && cur <= e) o.push([cur, e]); } return o; }
function sampleFrom(ranges, n) {
  const tot = total(ranges); const out = [];
  for (let i = 0; i < n; i += 1) {
    const t = Math.random() * tot; let acc = 0, pick = null;
    for (const [s, e] of ranges) { const sz = e - s + 1; if (t < acc + sz) { pick = s + Math.floor(t - acc); break; } acc += sz; }
    if (pick != null) out.push(int2ip(pick));
  }
  return out;
}

const CN_CARRIER = ['chinanet', 'china telecom', 'chinatelecom', 'china unicom', 'chinaunicom', 'china mobile', 'chinamobile', 'china tie tong', 'tietong', 'cernet', 'china education', 'china broadcasting', 'broadcast television', 'drpeng', 'gehua', 'wasu', 'cnc group', 'china cable', 'province', 'guangdong', 'zhejiang', 'jiangsu', 'shandong', 'henan', 'sichuan', 'hunan', 'hubei', 'fujian', 'anhui', 'hebei', 'shanxi', 'liaoning', 'jilin', 'heilongjiang', 'jiangxi', 'guangxi', 'yunnan', 'guizhou', 'gansu', 'qinghai', 'ningxia', 'xinjiang', 'tibet', 'hainan', 'chongqing', 'tianjin', 'beijing', 'shanghai', 'foshan', 'dongguan', 'wuxi', 'ningbo', 'wenzhou', 'qingdao', 'dalian'];
const FOREIGN = ['singapore', 'hong kong', 'hongkong', 'japan', 'korea', 'germany', 'united states', 'america', 'europe', 'brazil', 'india', 'australia', 'canada', 'netherlands', 'russia', 'thailand', 'vietnam', 'malaysia', 'indonesia', 'philippines', 'pakistan', 'türkiye', 'turkey', 'international', 'global', 'overseas', '(us)', '(uk)', '(jp)', '(kr)', '(de)', '(sg)', '(hk)', '(br)', '(nl)'];

const reader = new maxmind.Reader(fs.readFileSync(path.join(__dirname, 'mm', 'GeoLite2-Country.mmdb')));
const mmCC = (ip) => { try { const d = reader.get(ip); return (d && d.country && d.country.iso_code) || '??'; } catch { return '??'; } };

const V12 = loadRanges('files/runtime/cn_ip_V12.json');
const V11 = loadRanges('files/runtime/cn_ip_V11.json');
const OP = merge(fs.readFileSync('files/runtime/china-operator.txt', 'utf8').split('\n').map((s) => s.trim()).filter(Boolean).map((c) => { const [ip, pl] = c.split('/'); const sz = 2 ** (32 - parseInt(pl, 10)); const st = Math.floor(ip2int(ip) / sz) * sz; return [st, st + sz - 1]; }));
const MM = merge(JSON.parse(fs.readFileSync('files/runtime/maxmind-cn-ranges.json', 'utf8')));
const HIGH = intersect(OP, MM);
const V12_LOW = intersect(V12, subtract(V11, HIGH));   // 低置信区中仍在 V12 的部分

console.log(`V12 ∩ 低置信区 = ${total(V12_LOW).toLocaleString()} IP\n`);

const N1 = 2000, N2 = 1000;
const tests = [
  ['A1  列表内均匀抽样', sampleFrom(V12, N1)],
  ['A2  低置信区(仅V12内)', sampleFrom(V12_LOW, N2)],
];

(async () => {
  for (const [name, probes] of tests) {
    const info = new Map();
    for (let i = 0; i < probes.length; i += 100) {
      const chunk = probes.slice(i, i + 100);
      for (let a = 0; a < 6; a += 1) {
        try {
          const r = await fetch('http://ip-api.com/batch?fields=query,countryCode,isp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(chunk) });
          if (r.status === 429) { await sleep(9000); continue; }
          for (const it of await r.json()) info.set(it.query, it);
          break;
        } catch { await sleep(3500); }
      }
      await sleep(1400);
    }
    const judge = (ip) => {
      const it = info.get(ip) || {};
      const isp = String(it.isp || '').toLowerCase();
      if (FOREIGN.some((f) => isp.includes(f))) return { v: 'F', cc: it.countryCode, isp: it.isp };
      if (it.countryCode === 'CN') return { v: 'C', cc: it.countryCode, isp: it.isp };
      if (CN_CARRIER.some((c) => isp.includes(c))) return { v: 'C', cc: it.countryCode, isp: it.isp };
      return { v: 'F', cc: it.countryCode, isp: it.isp };
    };
    const bad = [];
    for (const ip of probes) { const j = judge(ip); if (j.v === 'F') bad.push({ ip, ...j, mm: mmCC(ip) }); }

    console.log('='.repeat(76));
    console.log(`【${name}】 n=${probes.length}`);
    console.log(`  判为境外: ${bad.length}  → 漏留率 ${(bad.length / probes.length * 100).toFixed(2)}%`);
    console.log(`  全量估算漏留 ≈ ${Math.round(bad.length / probes.length * total(V12)).toLocaleString()} IP`);
    if (bad.length) {
      console.log(`\n  被判境外的样本（最多 30 个）:`);
      bad.slice(0, 30).forEach((b) => console.log(`    ${b.ip.padEnd(16)} ip-api=${String(b.cc).padEnd(4)} MaxMind=${String(b.mm).padEnd(4)} ${b.isp}`));
      const byCC = {};
      bad.forEach((b) => { byCC[b.cc] = (byCC[b.cc] || 0) + 1; });
      console.log(`\n  按 ip-api 国家分布: ${Object.entries(byCC).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  ')}`);
      const byMM = {};
      bad.forEach((b) => { byMM[b.mm] = (byMM[b.mm] || 0) + 1; });
      console.log(`  按 MaxMind 国家分布: ${Object.entries(byMM).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  ')}`);
    }
    console.log('');
  }
})();
