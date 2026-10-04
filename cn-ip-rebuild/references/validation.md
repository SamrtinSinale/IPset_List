# 验证方法

**重建完列表必须验证，否则你不知道它是变好了还是变差了。**

---

## 一、四路抽样验证

从四个不同的总体抽样，交叉验证：

| 测试 | 抽样来源 | 测什么 | 期望值 |
|---|---|---|---|
| **A1** | 结果列表内**均匀**抽样 | 列表整体漏留率 | 越低越好 |
| **A2** | 结果 ∩ 低置信区 | 风险区的漏留率 | ≈ 0% |
| **B** | 「三源并集 − 结果」 | **误杀率** | **0.00%** |
| **C** | MaxMind 判非 CN 的空间 | 交叉验证漏留 | 越低越好 |

**样本量**：每项至少 **1000**（A1 建议 2000，因为漏留是稀有事件）。

---

## 二、判定逻辑（仲裁器）

```js
const judge = (ip, it) => {
  const isp = String(it.isp || '').toLowerCase();
  if (FOREIGN.some(f => isp.includes(f))) return 'F';        // 明确境外实体
  if (it.countryCode === 'CN') return 'C';                    // ip-api 说 CN
  if (CN_CARRIER.some(c => isp.includes(c))) return 'C';      // 国内运营商
  return 'F';
};
```

**关键词表**：

```js
const FOREIGN = ['singapore','hong kong','hongkong','japan','korea','germany',
  'united states','america','europe','brazil','india','australia','canada',
  'netherlands','russia','thailand','vietnam','malaysia','indonesia','philippines',
  'pakistan','türkiye','turkey','international','global','overseas',
  '(us)','(uk)','(jp)','(kr)','(de)','(sg)','(hk)','(br)','(nl)'];

const CN_CARRIER = ['chinanet','china telecom','chinatelecom','china unicom','chinaunicom',
  'china mobile','chinamobile','china tie tong','tietong','cernet','china education',
  'china broadcasting','broadcast television','drpeng','gehua','wasu','cnc group',
  'china cable','province','guangdong','zhejiang','jiangsu','shandong','henan',
  'sichuan','hunan','hubei','fujian','anhui','hebei','shanxi','liaoning','jilin',
  'heilongjiang','jiangxi','guangxi','yunnan','guizhou','gansu','qinghai','ningxia',
  'xinjiang','tibet','hainan','chongqing','tianjin','beijing','shanghai','foshan',
  'dongguan','wuxi','ningbo','wenzhou','qingdao','dalian'];
```

---

## 三、循环论证问题（必须说明）

**仲裁器和建列表时用的是同一套逻辑 —— 这有循环论证的成分。**

**缓解办法**：同时输出 **MaxMind 的独立判定**，报告两者的**一致率**：

```
【A1  列表内均匀抽样】  n=2000
  判定 CN=1988  境外=12   (99.4% / 0.6%)
  MaxMind 与判定一致率: 1992/2000 = 99.6%    ← 这个数字说明两个源基本一致
```

**如果一致率很低，说明仲裁器有问题，结论不可信。**

---

## 四、抽样结果必须**逐条看明细**

**不要只看百分比。** 0.6% 的漏留率可能是真漏留，也可能是仲裁器误判。

**必须输出每个被判"境外"的样本及其 ISP**，然后人工分类：

```js
bad.forEach(b => console.log(
  `${b.ip.padEnd(16)} ip-api=${b.cc.padEnd(4)} MaxMind=${b.mm.padEnd(4)} ${b.isp}`
));
```

**实例**（V12 的 A1 测试，2000 抽样，12 个判为境外）：

```
114.113.82.202   ip-api=DE  MaxMind=CN   RHTD
177.203.227.75   ip-api=BR  MaxMind=CN   V tal                    ← 巴西电信，真漏留
179.236.24.236   ip-api=BR  MaxMind=CN   V tal                    ← 巴西电信，真漏留
210.14.189.215   ip-api=AU  MaxMind=CN   Asia Pacific Network...  ← 真漏留
8.166.58.44      ip-api=CN  MaxMind=CN   Alibaba.com Singapore    ← 存疑（两库都说CN）
1.118.196.12     ip-api=HK  MaxMind=CN   jdcom                    ← 京东香港
183.91.47.167    ip-api=HK  MaxMind=CN   CHINANET Hongkong        ← 电信香港
210.73.106.246   ip-api=CN  MaxMind=CN   China International...   ← ❌ 仲裁器误判！
```

**分类后真实漏留 ≈ 5/2000 = 0.25%**，而不是表面上的 0.6%。

---

## 五、与公开列表对比

**最有说服力的验证**：和主流列表做**集合差集**，然后验证差异部分的真伪。

```js
const weHave  = subtract(ours, theirs);   // 我们独有
const theyHave = subtract(theirs, ours);  // 它们独有
```

**然后抽样验证两边**：

| 对比 | 结果（V12 vs MetaCubeX） |
|---|---|
| 我们独有 | 838 段 / 982,262 IP → 抽样 **38/40 是国内** ✓ |
| 它们独有 | 70 段 / 98,712 IP → 抽样 **13/21 明确境外** ✓ |

**这比单纯的百分比更有说服力** —— 它同时证明了"我们多的部分是对的"和"它们多的部分是错的"。

---

## 六、统计置信区间

**0/N 不等于绝对的 0。**

```
700 次抽样全为境外 → 95% 置信上界约 0.43%
```

**报告时要给上界，不要只说 0.00%**：

```
误杀率  实测 0/1000
        95% 置信上界 ≤ 0.43%（换算成绝对值 ≤ 5,880 IP）
        已知确定误杀 1,024 IP（4 个 /24）
```

---

## 七、验证脚本

| 脚本 | 用途 |
|---|---|
| `validate-full.js` | 四路抽样（A1/A2/B/C） |
| `validate-fix.js` | 修正版 + 输出漏留明细 |
| `measure-miss.js` | 分组测量误杀（按 MaxMind 判定分组） |
| `compare-lists.js` | 与公开列表对比（Recall / Precision） |
| `compare-diff.js` | 集合差集 + 输出差异段 |
| `verify-segs.js` | 验证特定网段的真伪 |
