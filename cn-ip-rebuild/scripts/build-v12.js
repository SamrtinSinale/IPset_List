// V12: exhaustive /24 ISP verification of every LOW-CONFIDENCE block.
//
//   high confidence = BGP ∩ MaxMind   (routing announcement + geo DB agree)
//   everything else in the list gets its /24 blocks checked individually
//   against ip-api + ISP name.
const fs = require('node:fs');

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
function cidrOf(start, end) {
  const out = [];
  let s = start;
  while (s <= end) {
    let size = 1;
    while (s % (size * 2) === 0 && s + size * 2 - 1 <= end) size *= 2;
    out.push(`${int2ip(s)}/${32 - Math.log2(size)}`);
    s += size;
  }
  return out;
}

const FOREIGN = ['singapore', 'hong kong', 'hongkong', 'japan', 'korea', 'germany',
  'united states', 'america', 'europe', 'brazil', 'india', 'australia', 'canada',
  'netherlands', 'russia', 'thailand', 'vietnam', 'malaysia', 'indonesia', 'philippines',
  'pakistan', 'türkiye', 'turkey', 'international', 'global', 'overseas',
  '(us)', '(uk)', '(jp)', '(kr)', '(de)', '(sg)', '(hk)', '(br)', '(nl)'];
const CN_CARRIER = ['chinanet', 'china telecom', 'chinatelecom', 'china unicom', 'chinaunicom',
  'china mobile', 'chinamobile', 'china tie tong', 'tietong', 'cernet',
  'china education', 'china broadcasting', 'broadcast television', 'drpeng', 'gehua',
  'wasu', 'cnc group', 'china cable', 'province', 'guangdong', 'zhejiang', 'jiangsu',
  'shandong', 'henan', 'sichuan', 'hunan', 'hubei', 'fujian', 'anhui', 'hebei', 'shanxi',
  'liaoning', 'jilin', 'heilongjiang', 'jiangxi', 'guangxi', 'yunnan', 'guizhou', 'gansu',
  'qinghai', 'ningxia', 'xinjiang', 'tibet', 'hainan', 'chongqing', 'tianjin', 'beijing',
  'shanghai', 'foshan', 'dongguan', 'wuxi', 'ningbo', 'wenzhou', 'qingdao', 'dalian'];

const V11 = loadRanges('files/runtime/cn_ip_V11.json');
const BGP = loadRanges('files/runtime/cn_ip_V7.json'); // placeholder replaced below
const OP = (() => {
  const txt = fs.readFileSync('files/runtime/china-operator.txt', 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
  const rs = [];
  for (const c of txt) {
    const [ip, pl] = c.split('/');
    const sz = 2 ** (32 - parseInt(pl, 10));
    const st = Math.floor(ip2int(ip) / sz) * sz;
    rs.push([st, st + sz - 1]);
  }
  return merge(rs);
})();
const MM = merge(JSON.parse(fs.readFileSync('files/runtime/maxmind-cn-ranges.json', 'utf8')));

const HIGH = intersect(OP, MM);              // high confidence
const LOW = subtract(V11, HIGH);             // needs /24 verification
console.log(`V11          : ${total(V11).toLocaleString()} IP`);
console.log(`高置信 (BGP∩MM): ${total(HIGH).toLocaleString()} IP`);
console.log(`低置信 (待查)  : ${total(LOW).toLocaleString()} IP`);

const blocks = [];
for (const [s, e] of LOW) {
  let cur = Math.floor(s / 256) * 256;
  while (cur <= e) {
    const bs = Math.max(cur, s), be = Math.min(cur + 255, e);
    blocks.push({ bs, be });
    cur += 256;
  }
}
console.log(`低置信 /24 块数: ${blocks.length.toLocaleString()}`);

const probes = blocks.map((b) => int2ip(b.bs + Math.floor((b.be - b.bs) / 2)));

(async () => {
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
    process.stdout.write(`\r  ${Math.min(i + 100, probes.length)}/${probes.length}`);
    await sleep(1400);
  }
  console.log('\n');

  const keepBlocks = [];
  const dropBlocks = [];
  blocks.forEach((b, idx) => {
    const it = info.get(probes[idx]) || {};
    const isp = String(it.isp || '').toLowerCase();
    let ok;
    if (FOREIGN.some((f) => isp.includes(f))) ok = false;
    else if (CN_CARRIER.some((c) => isp.includes(c))) ok = true;
    else if (it.countryCode === 'CN') ok = true;
    else ok = false;
    (ok ? keepBlocks : dropBlocks).push({ ...b, cc: it.countryCode, isp: it.isp });
  });

  console.log(`  保留: ${keepBlocks.length} 块, ${total(keepBlocks.map((x) => [x.bs, x.be])).toLocaleString()} IP`);
  console.log(`  剔除: ${dropBlocks.length} 块, ${total(dropBlocks.map((x) => [x.bs, x.be])).toLocaleString()} IP`);
  console.log('\n  剔除样本:');
  dropBlocks.slice(0, 15).forEach((x) => console.log(`    ${int2ip(x.bs)} - ${int2ip(x.be)}  ${x.cc}  ${x.isp}`));

  const V12 = merge([...HIGH, ...keepBlocks.map((x) => [x.bs, x.be])]);
  const cidrs = [];
  for (const [s, e] of V12) cidrs.push(...cidrOf(s, e));
  console.log(`\n=== V12 ===`);
  console.log(`  ${total(V12).toLocaleString()} IP, ${V12.length} 段, ${cidrs.length} CIDR`);
  fs.writeFileSync('files/runtime/cn_ip_V12.json', JSON.stringify({ version: 2, rules: [{ ip_cidr: cidrs }] }));
  console.log('已写出: files/runtime/cn_ip_V12.json');
})();
