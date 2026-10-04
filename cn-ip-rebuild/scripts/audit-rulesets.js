// Audit every rule-set in the config for over-broad entries:
//  - bare (dot-less) domain_suffix that swallows a whole TLD
//  - very short domain_keyword that matches too much
const fs = require('node:fs');
const path = require('node:path');

const DIR = 'files/runtime/rulesets';
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json'));

for (const f of files) {
  let j;
  try { j = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { continue; }
  const bare = new Set();
  const shortKw = new Set();
  let nDom = 0;
  for (const r of j.rules || []) {
    for (const v of (r.domain_suffix || [])) { nDom += 1; const s = String(v); if (!s.includes('.')) bare.add(s); }
    for (const v of (r.domain || [])) nDom += 1;
    for (const v of (r.domain_keyword || [])) { const s = String(v); if (s.length <= 4) shortKw.add(s); }
  }
  if (!nDom && !bare.size && !shortKw.size) continue;
  console.log(`\n=== ${f} ===`);
  console.log(`  域名条目: ${nDom.toLocaleString()}`);
  if (bare.size) {
    console.log(`  ⚠️ 裸后缀（吞整个 TLD）: ${[...bare].sort().join('  ')}`);
  } else {
    console.log('  ✅ 无裸后缀');
  }
  if (shortKw.size) console.log(`  ⚠️ 短 keyword (<=4字符): ${[...shortKw].sort().join('  ')}`);
}
