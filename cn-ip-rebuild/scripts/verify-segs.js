// Verify the 69 segments that every other CN list includes but we removed.
// If they are foreign, our list is more precise. If Chinese, we have a gap.
const fs = require('node:fs');
const path = require('node:path');

const ip2int = (s) => { const p = s.split('.').map(Number); return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3]; };
const int2ip = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SEGS = [
  '8.143.17.18/31', '8.148.36.0/22', '8.148.41.0/24', '8.148.43.0/24', '8.150.34.0/23', '8.150.38.0/24',
  '8.159.34.176/28', '8.176.0.0/17', '8.176.128.0/19', '27.148.140.128/25', '43.255.228.0/23', '44.30.120.0/24',
  '45.40.216.0/21', '49.51.226.0/23', '103.40.173.0/24', '103.61.60.0/26', '103.70.227.0/24', '103.81.184.0/23',
  '103.97.229.0/24', '103.118.210.0/23', '103.125.249.0/24',
];

const probes = [];
for (const s of SEGS) {
  const [ip, pl] = s.split('/');
  const sz = 2 ** (32 - parseInt(pl, 10));
  const st = Math.floor(ip2int(ip) / sz) * sz;
  probes.push({ seg: s, ip: int2ip(st + Math.floor(sz / 2)), size: sz });
}

(async () => {
  const info = new Map();
  const chunk = probes.map((p) => p.ip);
  for (let a = 0; a < 5; a += 1) {
    try {
      const r = await fetch('http://ip-api.com/batch?fields=query,countryCode,isp,org', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(chunk),
      });
      if (r.status === 429) { await sleep(9000); continue; }
      for (const it of await r.json()) info.set(it.query, it);
      break;
    } catch { await sleep(3000); }
  }

  console.log('=== 所有对照列表都有、我们删掉的段 ===\n');
  console.log('  ' + '网段'.padEnd(22) + 'IP数'.padEnd(9) + '国家'.padEnd(6) + 'ISP');
  console.log('  ' + '-'.repeat(94));
  let foreign = 0, cn = 0, unknown = 0;
  for (const p of probes) {
    const it = info.get(p.ip) || {};
    const cc = it.countryCode || '??';
    const tag = cc === 'CN' ? 'CN' : (cc === '??' ? '?' : '境外');
    if (cc === 'CN') cn += 1; else if (cc === '??') unknown += 1; else foreign += 1;
    console.log('  ' + p.seg.padEnd(22) + String(p.size).padEnd(9) + cc.padEnd(6) + (it.isp || ''));
  }
  console.log(`\n  统计: 境外 ${foreign}   CN ${cn}   无数据 ${unknown}`);
  console.log(`  → ${foreign > cn ? '我们删对了（这些确实是境外）' : '我们可能删错了'}`);
})();
