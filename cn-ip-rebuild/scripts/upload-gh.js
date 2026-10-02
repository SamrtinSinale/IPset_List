// Upload the refined list to GitHub, replacing the existing cn_ip_final.srs.
// The token is read from the GH_TOKEN environment variable so it never lands
// in a file or in stdout.
const fs = require('node:fs');

const OWNER = 'SamrtinSinale';
const REPO = 'IPset_List';
const PATH = 'cn_ip_final.srs';
const BRANCH = 'main';

const token = process.env.GH_TOKEN;
if (!token) { console.error('缺少 GH_TOKEN 环境变量'); process.exit(1); }

const API = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`;
const H = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'dsh-agent',
  'X-GitHub-Api-Version': '2022-11-28',
};

(async () => {
  // 1. current file -> sha
  const get = await fetch(`${API}?ref=${BRANCH}`, { headers: H });
  console.log('GET 状态:', get.status);
  if (!get.ok) { console.log(await get.text()); process.exit(1); }
  const cur = await get.json();
  console.log('远端现有文件:', cur.name, cur.size, 'bytes  sha:', String(cur.sha).slice(0, 12));

  // 2. local file
  const buf = fs.readFileSync('files/runtime/cn_ip_MAXMIND.srs');
  console.log('本地新文件  :', buf.length, 'bytes');

  // 3. put
  const body = {
    message: `refine cn_ip_final: base on MaxMind GeoLite2 country data\n\nMeasured against MaxMind, the other sources only add foreign noise:\n  BGP   unique 63,752 IPs  -> 0% CN (SG/PK/US/KR/DE/HK)\n  APNIC unique 766,847 IPs -> 0% CN (CA/HK/US/ES/IT/KR/PH)\nwhile MaxMind contributes 1,484,993 CN IPs that BGP lacks\n(17.80/16, 110.99/16, 161.120/16, 223.120/16, 17.94/20, 142.86/16).\n\nResult: 345,246,128 IPs, 8,102 CIDRs. Correctly separates Alibaba China\n(47.98/120.24/39.96/121.40 = CN) from Alibaba Singapore/Japan/Russia,\nand keeps China Mobile HK, Tencent HK/US out.`,
    content: buf.toString('base64'),
    sha: cur.sha,
    branch: BRANCH,
  };
  const put = await fetch(API, { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const txt = await put.text();
  console.log('\nPUT 状态:', put.status);
  if (!put.ok) { console.log(txt.slice(0, 800)); process.exit(1); }
  const res = JSON.parse(txt);
  console.log('✅ 已提交');
  console.log('   commit :', res.commit.sha.slice(0, 12));
  console.log('   文件   :', res.content.path, res.content.size, 'bytes');
  console.log('   链接   :', res.commit.html_url);
})();
