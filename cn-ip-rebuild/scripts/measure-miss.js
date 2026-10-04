// Quantify the real 误杀: among the blocks V12 dropped, how many are actually CN?
// Sample the two sub-populations separately:
//   A) dropped blocks that MaxMind says are CN   (likely misses)
//   B) dropped blocks that MaxMind says non-CN   (likely correct)
const fs = require('node:fs');
const path = require('node:path');
const maxmind = require(path.join(__dirname, 'mm', 'node_modules', 'maxmind'));

const ip2int = (s) => {
  const p = s.split('.').map(Number);
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
};
const int2ip = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function merge(rs) {
  rs.sort((a, b) => a[0] - b[0]);
  const m = [];
  for (const r of rs) {
    const l = m[m.length - 1];
    if (l && r[0] <= l[1] + 1) l[1] = Math.max(l[1], r[1]);
    else m.push([r[0], r[1]]);
  }
  return m;
}
function loadRanges(f) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  const rs = [];
  for (const r of j.rules || []) for (const c of r.ip_cidr || []) {
    if (!c.includes('.') || c.includes(':')) continue;
    const [ip, pl] = c.split('/');
    const sz = 2 ** (32 - parseInt(pl, 10));
    const st = Math.floor(ip2int(ip) / sz) * sz;
    rs.push([st, st + sz - 1]);
  }
  return merge(rs);
}
const total = (rs) => rs.reduce((s, r) => s + (r[1] - r[0] + 1), 0);
function intersect(a, b) {
  const out = []; let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    const s = Math.max(a[i][0], b[j][0]), e = Math.min(a[i][1], b[j][1]);
    if (s <= e) out.push([s, e]);
    if (a[i][1] < b[j][1]) i += 1; else j += 1;
  }
  return out;
}
function subtract(a, b) {
  const out = [];
  for (const [s, e] of a) {
    let cur = s, done = false;
    for (const [bs, be] of b) {
      if (be < cur) continue;
      if (bs > e) break;
      if (bs > cur) out.push([cur, Math.min(e, bs - 1)]);
      cur = Math.max(cur, be + 1);
      if (cur > e) { done = true; break; }
    }
    if (!done && cur <= e) out.push([cur, e]);
  }
  return out;
}
function sampleFrom(ranges, n) {
  const tot = total(ranges);
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const t = Math.random() * tot;
    let acc = 0, pick = null;
    for (const [s, e] of ranges) {
      const sz = e - s + 1;
      if (t < acc + sz) { pick = s + Math.floor(t - acc); break; }
      acc += sz;
    }
    if (pick != null) out.push(int2ip(pick));
  }
  return out;
}

const CN_CARRIER = ['chinanet', 'china telecom', 'chinatelecom', 'china unicom', 'chinaunicom',
  'china mobile', 'chinamobile', 'china tie tong', 'tietong', 'cernet',
  'china education', 'china broadcasting', 'broadcast television', 'drpeng', 'gehua',
  'wasu', 'cnc group', 'china cable', 'province', 'guangdong', 'zhejiang', 'jiangsu',
  'shandong', 'henan', 'sichuan', 'hunan', 'hubei', 'fujian', 'anhui', 'hebei', 'shanxi',
  'liaoning', 'jilin', 'heilongjiang', 'jiangxi', 'guangxi', 'yunnan', 'guizhou', 'gansu',
  'qinghai', 'ningxia', 'xinjiang', 'tibet', 'hainan', 'chongqing', 'tianjin', 'beijing',
  'shanghai', 'foshan', 'dongguan', 'wuxi', 'ningbo', 'wenzhou', 'qingdao', 'dalian'];
const FOREIGN = ['singapore', 'hong kong', 'hongkong', 'japan', 'korea', 'germany',
  'united states', 'america', 'europe', 'brazil', 'india', 'australia', 'canada',
  'netherlands', 'russia', 'thailand', 'vietnam', 'malaysia', 'indonesia', 'philippines',
  'pakistan', 'türkiye', 'turkey', 'international', 'global', 'overseas',
  '(us)', '(uk)', '(jp)', '(kr)', '(de)', '(sg)', '(hk)', '(br)', '(nl)'];

const reader = new maxmind.Reader(fs.readFileSync(path.join(__dirname, 'mm', 'GeoLite2-Country.mmdb')));
const mmCN = (n) => { try { const d = reader.get(int2ip(n)); return !!(d && d.country && d.country.iso_code === 'CN'); } catch { return false; } };

const V12 = loadRanges('files/runtime/cn_ip_V12.json');
const V11 = loadRanges('files/runtime/cn_ip_V11.json');
const OP = (() => {
  const txt = fs.readFileSync('files/runtime/china-operator.txt', 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
  const rs = [];
  for (const c of txt) { const [ip, pl] = c.split('/'); const sz = 2 ** (32 - parseInt(pl, 10)); const st = Math.floor(ip2int(ip) / sz) * sz; rs.push([st, st + sz - 1]); }
  return merge(rs);
})();
const MM = merge(JSON.parse(fs.readFileSync('files/runtime/maxmind-cn-ranges.json', 'utf8')));
const HIGH = intersect(OP, MM);
const dropped = subtract(subtract(V11, HIGH), V12);

const groupA = []; // MaxMind says CN
const groupB = []; // MaxMind says non-CN
for (const [s, e] of dropped) {
  let cur = Math.floor(s / 256) * 256;
  while (cur <= e) {
    const bs = Math.max(cur, s), be = Math.min(cur + 255, e);
    (mmCN(bs + Math.floor((be - bs) / 2)) ? groupA : groupB).push([bs, be]);
    cur += 256;
  }
}
console.log(`被删总量 : ${total(dropped).toLocaleString()} IP`);
console.log(`  A 组 (MaxMind 说 CN)   : ${groupA.length} 块, ${total(groupA).toLocaleString()} IP`);
console.log(`  B 组 (MaxMind 说非 CN) : ${groupB.length} 块, ${total(groupB).toLocaleString()} IP`);

const NA = 400, NB = 400;
const pA = sampleFrom(groupA, NA);
const pB = sampleFrom(groupB, NB);

(async () => {
  const info = new Map();
  const all = [...pA, ...pB];
  for (let i = 0; i < all.length; i += 100) {
    const chunk = all.slice(i, i + 100);
    for (let a = 0; a < 6; a += 1) {
      try {
        const r = await fetch('http://ip-api.com/batch?fields=query,countryCode,isp', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(chunk),
        });
        if (r.status === 429) { await sleep(9000); continue; }
        for (const it of await r.json()) info.set(it.query, it);
        break;
      } catch { await sleep(3500); }
    }
    process.stdout.write(`\r  ${Math.min(i + 100, all.length)}/${all.length}`);
    await sleep(1400);
  }
  console.log('\n');

  const judge = (ip) => {
    const it = info.get(ip) || {};
    const isp = String(it.isp || '').toLowerCase();
    if (FOREIGN.some((f) => isp.includes(f))) return false;
    if (it.countryCode === 'CN') return true;
    if (CN_CARRIER.some((c) => isp.includes(c))) return true;
    return false;
  };

  const cnA = pA.filter(judge).length;
  const cnB = pB.filter(judge).length;
  const estA = (cnA / NA) * total(groupA);
  const estB = (cnB / NB) * total(groupB);
  const est = estA + estB;

  console.log('=== 真实误杀量估算 ===');
  console.log(`  A 组: ${cnA}/${NA} 是 CN  → 估算 ${Math.round(estA).toLocaleString()} IP`);
  console.log(`  B 组: ${cnB}/${NB} 是 CN  → 估算 ${Math.round(estB).toLocaleString()} IP`);
  console.log(`  ────────────────────────────────────`);
  console.log(`  总误杀 ≈ ${Math.round(est).toLocaleString()} IP`);
  console.log(`  占 V12 列表比例 ≈ ${(est / total(V12) * 100).toFixed(4)}%`);

  console.log('\n  A 组里被误杀的样本:');
  pA.filter(judge).slice(0, 12).forEach((ip) => {
    const it = info.get(ip) || {};
    console.log(`    ${ip.padEnd(18)} ${it.countryCode}  ${it.isp}`);
  });
})();
