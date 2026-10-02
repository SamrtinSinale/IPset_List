// Rigorous validation of cn_ip_final.srs (V12).
//
// Four independent probes:
//   A1  从列表内均匀抽样        -> 列表整体的漏留率
//   A2  从列表的低置信区抽样     -> 风险区的漏留率
//   B   从「三源并集 − 列表」抽样 -> 误杀率
//   C   从 MaxMind 判非 CN 的段抽样 -> 交叉验证漏留
//
// 每个 IP 同时拿 ip-api 的 countryCode/isp 和本地 MaxMind 的判定，
// 这样能看到两个数据源的一致与分歧。
const fs = require('node:fs');
const path = require('node:path');
const maxmind = require(path.join(__dirname, 'mm', 'node_modules', 'maxmind'));

const ip2int = (s) => { const p = s.split('.').map(Number); return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3]; };
const int2ip = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function merge(rs) {
  rs.sort((a, b) => a[0] - b[0]);
  const m = [];
  for (const r of rs) { const l = m[m.length - 1]; if (l && r[0] <= l[1] + 1) l[1] = Math.max(l[1], r[1]); else m.push([r[0], r[1]]); }
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
function intersect(a, b) { const o = []; let i = 0, j = 0; while (i < a.length && j < b.length) { const s = Math.max(a[i][0], b[j][0]), e = Math.min(a[i][1], b[j][1]); if (s <= e) o.push([s, e]); if (a[i][1] < b[j][1]) i += 1; else j += 1; } return o; }
function subtract(a, b) {
  const o = [];
  for (const [s, e] of a) { let cur = s, done = false; for (const [bs, be] of b) { if (be < cur) continue; if (bs > e) break; if (bs > cur) o.push([cur, Math.min(e, bs - 1)]); cur = Math.max(cur, be + 1); if (cur > e) { done = true; break; } } if (!done && cur <= e) o.push([cur, e]); }
  return o;
}
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
const OP = merge(fs.readFileSync('files/runtime/china-operator.txt', 'utf8').split('\n').map((s) => s.trim()).filter(Boolean).map((c) => {
  const [ip, pl] = c.split('/'); const sz = 2 ** (32 - parseInt(pl, 10)); const st = Math.floor(ip2int(ip) / sz) * sz; return [st, st + sz - 1];
}));
const MM = merge(JSON.parse(fs.readFileSync('files/runtime/maxmind-cn-ranges.json', 'utf8')));
const APNIC = merge(JSON.parse(fs.readFileSync('files/runtime/apnic-cn-ranges.json', 'utf8')).A);
const UNION = merge([...OP, ...MM, ...APNIC]);

const HIGH = intersect(OP, MM);
const LOW = subtract(V11, HIGH);
const EXCLUDED = subtract(UNION, V12);
const MM_NONCN = subtract([[0, 0xffffffff]], MM);

console.log('=== 规模 ===');
console.log(`  V12 列表        : ${total(V12).toLocaleString()} IP`);
console.log(`  三源并集         : ${total(UNION).toLocaleString()} IP`);
console.log(`  被排除          : ${total(EXCLUDED).toLocaleString()} IP`);
console.log(`  低置信区         : ${total(LOW).toLocaleString()} IP`);

const N = 1000;
const tests = [
  ['A1  列表内均匀抽样', sampleFrom(V12, N)],
  ['A2  低置信区抽样', sampleFrom(LOW, N)],
  ['B   被排除区抽样', sampleFrom(EXCLUDED, N)],
  ['C   MaxMind 判非CN段抽样', sampleFrom(MM_NONCN, N)],
];

(async () => {
  const results = [];
  for (const [name, probes] of tests) {
    const info = new Map();
    for (let i = 0; i < probes.length; i += 100) {
      const chunk = probes.slice(i, i + 100);
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
      await sleep(1400);
    }
    process.stdout.write(`\r  查询 ${name} ... 完成      \n`);
    results.push([name, probes, info]);
  }

  const judge = (ip, it) => {
    const isp = String((it && it.isp) || '').toLowerCase();
    if (FOREIGN.some((f) => isp.includes(f))) return 'F';
    if (it && it.countryCode === 'CN') return 'C';
    if (CN_CARRIER.some((c) => isp.includes(c))) return 'C';
    return 'F';
  };
  const inList = (ip) => { const n = ip2int(ip); return V12.some(([s, e]) => n >= s && n <= e); };

  console.log('\n' + '='.repeat(78));
  console.log('结果（判定 = ip-api country + ISP 仲裁；MaxMind 为独立对照）');
  console.log('='.repeat(78));

  for (const [name, probes, info] of results) {
    let cn = 0, fo = 0, mmAgree = 0, mmTotal = 0;
    for (const ip of probes) {
      const it = info.get(ip) || {};
      const v = judge(ip, it);
      if (v === 'C') cn += 1; else fo += 1;
      const mm = mmCC(ip);
      if (mm !== '??') { mmTotal += 1; if ((mm === 'CN') === (v === 'C')) mmAgree += 1; }
    }
    console.log(`\n【${name}】  n=${probes.length}`);
    console.log(`  判定 CN=${cn}  境外=${fo}   (${(cn / probes.length * 100).toFixed(1)}% / ${(fo / probes.length * 100).toFixed(1)}%)`);
    console.log(`  MaxMind 与判定一致率: ${mmAgree}/${mmTotal} = ${(mmAgree / mmTotal * 100).toFixed(1)}%`);

    if (name.startsWith('A1') || name.startsWith('A2')) {
      console.log(`  → 漏留率（列表内实为境外的比例）= ${fo}/${probes.length} = ${(fo / probes.length * 100).toFixed(2)}%`);
      console.log(`  → 全量估算漏留 ≈ ${Math.round(fo / probes.length * total(V12)).toLocaleString()} IP`);
    }
    if (name.startsWith('B')) {
      console.log(`  → 误杀率（被排除实为国内的比例）= ${cn}/${probes.length} = ${(cn / probes.length * 100).toFixed(2)}%`);
      console.log(`  → 全量估算误杀 ≈ ${Math.round(cn / probes.length * total(EXCLUDED)).toLocaleString()} IP`);
    }
    if (name.startsWith('C')) {
      const leaked = probes.filter(inList).length;
      console.log(`  → 其中落在 V12 列表里的: ${leaked}/${probes.length} = ${(leaked / probes.length * 100).toFixed(2)}%`);
    }
  }
  console.log('\n注：A2/C 是「风险区」抽样，比例不代表整体；A1/B 才是整体指标。');
})();
