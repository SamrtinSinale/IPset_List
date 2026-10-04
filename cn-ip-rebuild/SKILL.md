---
name: cn-ip-rebuild
description: "重建 sing-box 用的 cn_ip / cn_domain / ai 规则集（.srs），包括多源并集、逐 /24 验证、误杀与漏留的量化验证、编译与上传。当需要更新国内 IP 列表、修复分流误判（国内被送去代理 / 境外被误判直连）、或验证规则集精度时使用。"
whenToUse: "用户要更新/重建 cn_ip_final.srs 等规则集，或报告分流误判（国内网站走了代理、境外网站打不开），或要求评估规则集精度。"
---

# 国内分流规则集重建手册

把「中国 IP 列表」从多个数据源重建出来，并**量化验证**误杀率与漏留率。

**先读第一节的原理**：这套流程的核心不是"合并列表"，而是**分层信任 + 逐 /24 验证**。

---

## 一、原理（必须先懂）

### 为什么不能简单合并

```
BGP 列表（china-operator-ip 等）  = 「中国 ASN 宣告的 IP」
                                   ≠ 「位于中国的 IP」
   → 中国运营商在海外有大量分配，BGP 列表会把巴西/菲律宾/日本的段算成中国

MaxMind / APNIC                   = 注册地 / 地理库
   → 对「中国公司的海外实体」判定不一致（阿里云新加坡：MaxMind 说 CN，ISP 名说 Singapore）
```

**所以任何单一源都不够，而且简单并集会把误判放大。**

### 正确做法：分层

```
高置信区 = BGP ∩ MaxMind          → 路由公告 + 地理库都确认 → 直接信任
低置信区 = 列表 − 高置信区         → 拆到 /24 逐块用 ip-api + ISP 名判定
```

**默认值是关键：没证据就留（保留），不是没证据就删。**
这样才能保证国内 IP 不会因为"判不出来"被误删。

---

## 二、数据源

| 源 | 获取方式 | 用途 | 备注 |
|---|---|---|---|
| **BGP（中国运营商）** | `github.com/gaoyifan/china-operator-ip` → `china.txt` | 高置信区的一半 | 约 6,200 CIDR / 3.44 亿 IP |
| **MaxMind GeoLite2-Country** | 官方下载 `GeoLite2-Country.mmdb` | 高置信区的另一半 + 判定 | 需要 `maxmind` npm 包（v5+，用 `getWithPrefixLength` 遍历） |
| **APNIC 委派数据** | `ftp.apnic.net/pub/stats/apnic/delegated-apnic-latest` | 补充 BGP 缺失的段 | 见 `references/sources.md` |
| **ip-api.com** | `POST http://ip-api.com/batch` | 逐块仲裁（countryCode + isp） | 免费版 **45 请求/分钟**，每请求最多 100 个 IP |

**❌ 不要用 DB-IP**：它的判定逻辑是"公司是中国的就标 CN"，会把阿里云新加坡、Amazon 美国、中国移动香港全标成中国，是误判的主要来源。

---

## 三、标准流程

### 步骤 1：构建三源并集

```
UNION = BGP ∪ MaxMind-CN ∪ APNIC-CN
```

### 步骤 2：划分置信区

```
HIGH = BGP ∩ MaxMind          ← 直接保留，不动
LOW  = 列表 − HIGH            ← 需要逐 /24 验证
```

### 步骤 3：逐 /24 验证低置信区

把 `LOW` 拆成 /24 块，每块取中点查 ip-api，用下面的仲裁规则判定：

```js
// 顺序很重要
if (ISP 含境外标识)         → 删      // singapore/hong kong/japan/korea/brazil/
                                      // united states/europe/international/global/
                                      // overseas/(us)/(uk)/(jp)/(kr)/(de)/(sg)/(hk)...
else if (ISP 含国内运营商标识) → 留      // chinanet/china telecom/china unicom/
                                      // china mobile/tietong/cernet/
                                      // 省份名（guangdong/zhejiang/beijing...）
else if (ip-api countryCode === 'CN') → 留
else                        → 删
```

**⚠️ 这个仲裁器有两个已知缺陷，见 `references/pitfalls.md`：**
- `international` 这类关键词会误伤（"China **International** Trust & Investment" 被判境外）
- 它对"中国公司海外实体"无解（阿里云新加坡：ip-api 说 CN、ISP 名说 Singapore）

### 步骤 4：合并并编译

```
结果 = HIGH ∪ 保留的 /24
→ 用 sing-box rule-set compile 编译成 .srs
```

### 步骤 5：验证（必做，见 `references/validation.md`）

**至少要跑这三项：**

| 测试 | 抽样来源 | 期望 |
|---|---|---|
| **误杀率** | 「三源并集 − 结果」 | **0.00%**（国内 IP 不应被删） |
| **漏留率** | 结果内均匀抽样 | 越低越好（当前约 0.25–0.6%） |
| **风险区漏留** | 结果 ∩ 低置信区 | 应接近 0% |

---

## 四、已知的精度上限

**当前（V12）实测：**

```
误杀率   0.00%   (0/1000 抽样)          ← 已达到上限
漏留率   0.25–0.6%  ≈ 86万–207万 IP     ← 瓶颈在数据源矛盾
低置信区 0.00%   (0/1000 抽样)          ← /24 验证有效
```

**漏留压不下去的原因**：剩下的都是「MaxMind 自己判 CN」的块（如京东海外 `1.118.x`、联通美国 `59.83.242.x`）。要删它们只能放弃 MaxMind 改用 ISP 名判定，但那会连带误杀 `58.66.64.x`（电信广东）那类。

**这是数据源的固有矛盾，不是算法问题。** 想突破只能换付费源（IPinfo 商业版、IP2Location 付费版）。

---

## 五、脚本清单

都在 `D:\KernelBox-SingBOX\files\runtime\`：

| 脚本 | 作用 |
|---|---|
| `build-v12.js` | **主构建脚本**（三源并集 + 低置信区逐 /24 验证） |
| `validate-full.js` | 四路验证（A1/A2/B/C 抽样） |
| `validate-fix.js` | 修正版验证 + 输出漏留明细 |
| `compare-lists.js` | 与公开列表头对头对比（Recall / Precision） |
| `compare-diff.js` | 集合差集对比 |
| `scan24-mm.js` | 全量 /24 离线 MaxMind 扫描 |
| `upload-gh.js` | 上传到 GitHub 仓库 |

---

## 六、上传

**仓库**：`SamrtinSinale/IPset_List`（branch `main`）
**文件**：`cn_ip_final.srs` / `cn_domain.srs` / `ai.srs`

**配置里的 URL 不用改**（已固定指向该仓库）：

```
https://gh-proxy.com/https://raw.githubusercontent.com/SamrtinSinale/IPset_List/main/cn_ip_final.srs
```

**上传后必须回读校验**（`raw.githubusercontent.com` 有 CDN 缓存，用 GitHub API 的 `contents` 端点核对 sha256，不要用 CDN）。

---

## 七、改完配置后的注意事项

### 规则顺序陷阱

```
规则13 AI  → AI选择器
规则16 [cn_ip, cn_domain] → 国内网站 → 直连
```

**规则 13 在规则 16 之前。** 所以同一个域名如果同时出现在 `ai.srs` 和 `cn_domain.srs` 里，**永远走 AI 分支，到不了直连分支**。要让某个域名走直连，必须先从 `ai.srs` 里移除。

### 裸 TLD 陷阱

`cn_domain` 里的**裸后缀**会吞掉整个 TLD：

```
domain_suffix: "top"  →  所有 .top 域名都走直连（包括境外的 520.linjiajia.top）
```

**必须删掉的**：`top` `wang` `yun`（通用 gTLD，全球可注册）
**可以保留的**：`cn`（中国 TLD）、`xn--*`（中文 IDN）、`baidu`/`taobao`/`weibo`（品牌 TLD）

### fake-ip 会废掉 eBPF bypass

```
开 fake-ip 后：所有域名解析成 198.18.x.x
→ 目标 IP 永远不在 cn_ip 里
→ bypass_rule_set 完全失效
```

**所以不要开 fake-ip**，除非你放弃 eBPF 的 IP 级绕过。
