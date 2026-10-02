# 数据源详解

## 1. BGP（中国运营商路由公告）

**来源**：`https://github.com/gaoyifan/china-operator-ip`

```powershell
# 下载（走代理）
Invoke-WebRequest -Uri 'https://gh-proxy.com/https://raw.githubusercontent.com/gaoyifan/china-operator-ip/ip-lists/china.txt' `
  -OutFile 'files\runtime\china-operator.txt' -UseBasicParsing
```

**格式**：每行一个 CIDR，纯文本。约 **6,206 行 / 3.44 亿 IP**。

**语义**：这些是**中国 ASN 宣告的** IP。

**⚠️ 关键陷阱**：**「中国运营商宣告」≠「位于中国」。** 中国电信/联通/移动在海外有大量分配，BGP 列表会包含它们 —— 这是公开 CN 列表精度差的主因。

**验证过的问题段**（其他 CN 列表都含、我们删掉的）：

```
43.255.228.0/23    巴西    Guangzhou LanDong Information technology
44.30.120.0/24     英国    Wende Tan
45.40.216.0/21     台湾    Shenzhen Tencent Computer Systems
49.51.226.0/23     美国    OPHL
103.70.227.0/24    菲律宾  PANTELCO
103.81.184.0/23    韩国    CoreLink Global Communications
103.125.249.0/24   日本    flyingnet
```

## 2. MaxMind GeoLite2-Country

**获取**：MaxMind 官网免费账号 → 下载 `GeoLite2-Country.mmdb`

**读取**（需要 `maxmind` npm 包 v5+）：

```js
const maxmind = require('maxmind');
const reader = await maxmind.open('GeoLite2-Country.mmdb');

// 遍历所有网段（不要用 get()，那样只能查单个 IP）
const ranges = [];
for (const { network, data } of reader.getWithPrefixLength ? [] : []) {}
// 实际用法：用 reader.get(ip) 逐点查询，或用 maxmind 的 walker
```

**提取 CN 段**：遍历所有网段，筛出 `country.iso_code === 'CN'`，输出成 `[start, end]` 区间数组存 JSON。

**产出**：`files\runtime\maxmind-cn-ranges.json`，约 3.45 亿 IP。

**⚠️ 偏差**：对中国公司的海外实体，MaxMind 常判 CN（与 ip-api 一致），这是漏留的主要来源。

## 3. APNIC 委派数据

**来源**：`https://ftp.apnic.net/stats/apnic/delegated-apnic-latest`

**格式**：`registry|cc|type|start|value|date|status`

```
apnic|CN|ipv4|1.0.1.0|256|20110414|allocated
```

**解析**：筛 `cc === 'CN' && type === 'ipv4'`，`value` 是 IP 个数（转成前缀长度）。

**作用**：补充 BGP 和 MaxMind 都缺的段。例如：

```
124.172.126.1   广东电信   只在 APNIC，不在 BGP，不在 MaxMind
58.66.64.1      电信广东   只在 APNIC
```

**产出**：`files\runtime\apnic-cn-ranges.json`（结构 `{ A: [[start,end],...] }`）。

## 4. ip-api.com（逐块仲裁）

**用法**：

```js
const r = await fetch('http://ip-api.com/batch?fields=query,countryCode,isp', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(['1.1.1.1', '8.8.8.8', /* 最多 100 个 */]),
});
const results = await r.json();   // [{ query, countryCode, isp }, ...]
```

**限速**：免费版 **45 请求/分钟**。每请求最多 100 个 IP。

**建议节奏**：每批之间 `sleep(1400)`，遇 429 则 `sleep(9000)` 重试。

**能拿到**：`countryCode`（国家）+ `isp`（运营商/公司名）。

**⚠️ 已知问题**：
- 对某些段返回 `status: "fail"`（无数据），如 `155.102.0.0/16`（阿里云 CDN）
- 对"中国公司海外实体"倾向于判 CN

**备用源**（ip-api 无数据时）：

```
https://ipwho.is/<ip>              → country_code, connection.isp, connection.asn
https://rdap.arin.net/registry/ip/<ip>  → 权威注册信息（handle/name/startAddress/endAddress）
```

## 5. ❌ 不要用的源

| 源 | 为什么不用 |
|---|---|
| **DB-IP Lite** | 判定逻辑是"公司是中国的就标 CN"，把阿里云新加坡、Amazon 美国、中国移动香港全标成中国。用户实测评价：最差 |
| **IPinfo 免费版** | 边缘网段判定 mediocre |
| IP2Location LITE | 免费版精度约 97.5–98%，不如 MaxMind Lite（约 97/100） |

**用户自己的评测结论**：MaxMind Lite 与 IP2Location 免费版最好（约 97–98 分）；`china-operator-ip` 适合作为国内填充 + 次要字段补全。

---

## 参考并集规模

```
BGP      343,989,248 IP   (6,206 CIDR)
MaxMind  345,246,128 IP
APNIC    ~344,000,000 IP
─────────────────────────
并集     346,241,088 IP
```

**注意**：并集比任何单源都大，说明各源都有对方缺的段 —— 这正是要用并集的原因。
