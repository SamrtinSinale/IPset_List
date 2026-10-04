// Extract every CN range from the MaxMind GeoLite2-Country database.
// Uses getWithPrefixLength() to jump network-by-network instead of scanning
// all 2^32 addresses.
const fs = require('node:fs');
const maxmind = require('./mm/node_modules/maxmind');

const int2ip = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');

const reader = new maxmind.Reader(fs.readFileSync('files/runtime/mm/GeoLite2-Country.mmdb'));
console.log('数据库:', reader.metadata.databaseType, '| 构建于', reader.metadata.buildEpoch);

const cn = [];
const byCC = {};
let visited = 0;
let ip = 0;
const MAX = 0xffffffff;

while (ip <= MAX) {
  let data, plen;
  try {
    [data, plen] = reader.getWithPrefixLength(int2ip(ip));
  } catch {
    ip += 256;
    continue;
  }
  visited += 1;
  const size = 2 ** (32 - plen);
  const cc = data && data.country && data.country.iso_code;
  if (cc) {
    byCC[cc] = (byCC[cc] || 0) + 1;
    if (cc === 'CN') cn.push([ip, ip + size - 1]);
  }
  ip += size;
}

console.log(`遍历网段数: ${visited.toLocaleString()}`);
console.log(`CN 网段数  : ${cn.length}`);

// merge
cn.sort((a, b) => a[0] - b[0]);
const merged = [];
for (const r of cn) {
  const l = merged[merged.length - 1];
  if (l && r[0] <= l[1] + 1) l[1] = Math.max(l[1], r[1]);
  else merged.push([r[0], r[1]]);
}
const total = merged.reduce((s, r) => s + (r[1] - r[0] + 1), 0);
console.log(`合并后     : ${merged.length} 段, ${total.toLocaleString()} IP`);

console.log('\n=== 网段数最多的国家（前 10）===');
Object.entries(byCC).sort((a, b) => b[1] - a[1]).slice(0, 10)
  .forEach(([k, v]) => console.log(`  ${k}  ${v.toLocaleString()}`));

console.log('\n=== 抽查 ===');
const inCN = (s) => {
  const p = s.split('.').map(Number);
  const n = ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
  let lo = 0, hi = merged.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (n < merged[m][0]) hi = m - 1;
    else if (n > merged[m][1]) lo = m + 1;
    else return true;
  }
  return false;
};
for (const [ipx, note] of [
  ['223.5.5.5', '阿里DNS'], ['114.114.114.114', '国内DNS'], ['180.101.50.242', '百度'],
  ['8.174.64.1', '阿里云中国'], ['43.1.1.1', '阿里云中国'], ['124.172.127.1', '广东电信'],
  ['43.92.22.245', '阿里云日本'], ['43.94.0.1', '阿里云巴西'], ['5.154.156.38', '德国电信欧洲'],
  ['43.102.128.1', '淘宝香港'], ['8.8.8.8', 'Google'], ['1.1.1.1', 'Cloudflare'],
]) {
  console.log(`  ${ipx.padEnd(18)} ${note.padEnd(14)} ${inCN(ipx) ? 'CN' : '--'}`);
}

fs.writeFileSync('files/runtime/maxmind-cn-ranges.json', JSON.stringify(merged));
console.log('\n已存: files/runtime/maxmind-cn-ranges.json');
