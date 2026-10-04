// Split the whole list into /24 and check every block against MaxMind offline.
// Only the blocks MaxMind disputes need an ip-api query -- that keeps the
// online lookups to a manageable number.
const fs = require('node:fs');
const path = require('node:path');
const maxmind = require(path.join(__dirname, 'mm', 'node_modules', 'maxmind'));

const ip2int = (s) => {
  const p = s.split('.').map(Number);
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
};
const int2ip = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');

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

const reader = new maxmind.Reader(fs.readFileSync(path.join(__dirname, 'mm', 'GeoLite2-Country.mmdb')));
const mmCC = (n) => {
  try {
    const d = reader.get(int2ip(n));
    return (d && d.country && d.country.iso_code) || '??';
  } catch { return '??'; }
};

const V7 = loadRanges('files/runtime/cn_ip_V7.json');
console.log(`V7: ${total(V7).toLocaleString()} IP, ${V7.length} 段`);

// Enumerate every /24 in V7 and ask MaxMind about its midpoint.
const keep = [];
const suspect = [];
let n24 = 0;
for (const [s, e] of V7) {
  let cur = Math.floor(s / 256) * 256;
  while (cur <= e) {
    const bs = Math.max(cur, s), be = Math.min(cur + 255, e);
    const mid = bs + Math.floor((be - bs) / 2);
    n24 += 1;
    const cc = mmCC(mid);
    if (cc === 'CN') keep.push([bs, be]);
    else suspect.push({ bs, be, cc });
    cur += 256;
  }
}
console.log(`\n/24 总数: ${n24.toLocaleString()}`);
console.log(`  MaxMind 说 CN   -> 直接保留 : ${keep.length.toLocaleString()} 块, ${total(keep).toLocaleString()} IP`);
console.log(`  MaxMind 说非 CN -> 待复核   : ${suspect.length.toLocaleString()} 块, ${total(suspect.map((x) => [x.bs, x.be])).toLocaleString()} IP`);

// group suspect by country for a quick read
const byCC = {};
for (const x of suspect) byCC[x.cc] = (byCC[x.cc] || 0) + 1;
console.log('\n  待复核块的 MaxMind 判定分布（前 15）:');
Object.entries(byCC).sort((a, b) => b[1] - a[1]).slice(0, 15)
  .forEach(([k, v]) => console.log(`    ${String(k).padEnd(6)} ${v.toLocaleString()}`));

fs.writeFileSync('files/runtime/v7-24-scan.json', JSON.stringify({ keep, suspect }));
console.log('\n已存: files/runtime/v7-24-scan.json');
