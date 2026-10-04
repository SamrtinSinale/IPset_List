# cn-ip-rebuild — 国内分流规则集重建工具

重建 sing-box 用的 `cn_ip_final.srs`，并**量化验证**误杀率与漏留率。

**先读 [`SKILL.md`](./SKILL.md)**，它是主手册。细节在 `references/`。

---

## 这套东西解决什么问题

```
BGP 列表  = 「中国 ASN 宣告的 IP」 ≠ 「位于中国的 IP」
            → 中国运营商的海外分配会被算成中国（巴西/菲律宾/日本段）

MaxMind   = 地理库，对「中国公司的海外实体」判定不稳
            → 阿里云新加坡：MaxMind 说 CN，ISP 名说 Singapore

简单合并会把两边的错误都放大。
```

**做法**：分层信任 + 逐 /24 验证

```
高置信区 = BGP ∩ MaxMind      → 直接信任（约 3.44 亿 IP）
低置信区 = 其余                → 拆成 /24 逐块用 ip-api + ISP 名判定
默认值   = 没证据就留          → 保证国内 IP 不被误删
```

---

## 实测精度（V12）

```
误杀率    0.00%   (0/1000 抽样)            ← 已达上限
漏留率    0.25–0.6%  ≈ 86万–207万 IP       ← 瓶颈在数据源矛盾
低置信区  0.00%   (0/1000 抽样)            ← /24 验证有效
```

---

## 目录结构要求

脚本假设**工作目录**下存在：

```
<workdir>/
├── sing-box.exe                              # 用于 compile / decompile / match
└── files/runtime/
    ├── china-operator.txt                    # BGP 列表（每行一个 CIDR）
    ├── maxmind-cn-ranges.json                # MaxMind CN 区间 [[start,end],...]
    ├── apnic-cn-ranges.json                  # APNIC CN，结构 { A: [[start,end],...] }
    ├── mm/
    │   ├── GeoLite2-Country.mmdb             # MaxMind 地理库
    │   └── node_modules/maxmind/             # npm i maxmind（v5+）
    ├── rulesets/                             # 反编译后的规则集 JSON（audit-rulesets.js 用）
    └── compare/                              # 对照列表的 .srs / .json（compare-*.js 用）
```

**准备数据源**见 [`references/sources.md`](./references/sources.md)。

---

## 脚本

### 核心管线

| 脚本 | 作用 |
|---|---|
| `maxmind-cn.js` | 从 mmdb 提取 CN 区间 → `maxmind-cn-ranges.json` |
| **`build-v12.js`** | **主构建**：三源并集 → 划分置信区 → 低置信区逐 /24 验证 → 输出 `cn_ip_V12.json` |
| `scan24-mm.js` | 全量 /24 离线 MaxMind 扫描（找 MaxMind 有异议的块） |

### 验证

| 脚本 | 作用 |
|---|---|
| `validate-full.js` | 四路抽样（A1 整体 / A2 风险区 / B 误杀 / C 交叉） |
| `validate-fix.js` | 修正版验证 + **输出漏留明细**（逐条 ISP，人工复核用） |
| `measure-miss.js` | 按 MaxMind 判定分组测误杀 |
| `compare-lists.js` | 与公开列表头对头（Recall / Precision） |
| `compare-diff.js` | 集合差集 + 输出差异段 |
| `verify-segs.js` | 验证指定网段的真伪 |
| `verify-ours.js` | 验证"我们独有"的段 |

### 辅助

| 脚本 | 作用 |
|---|---|
| `audit-rulesets.js` | 审计所有规则集的**裸 TLD**（`top`/`wang`/`yun` 这类会吞掉整个 TLD） |
| `upload-gh.js` | 上传到 GitHub 仓库（含 sha256 回读校验） |

### 运行方式

```powershell
# 1. 提取 MaxMind CN 区间
node files/runtime/maxmind-cn.js

# 2. 构建（耗时最长，建议后台跑）
node files/runtime/build-v12.js

# 3. 编译
.\sing-box.exe rule-set compile -o files/runtime/cn_ip_V12.srs files/runtime/cn_ip_V12.json

# 4. 验证
node files/runtime/validate-fix.js

# 5. 上传
$env:GH_TOKEN='<token>'; node files/runtime/upload-gh.js
```

---

## 常见坑

**14 个实际踩过的坑记在 [`references/pitfalls.md`](./references/pitfalls.md)**，包括：

- 差集的两个操作数必须来自同一个"宇宙"，否则静默失效
- 仲裁器的 `international` 关键词会误伤"China **International** Trust & Investment"
- 全量 /24 扫描要 5 小时，必须分层
- 规则顺序：`AI` 规则在 `cn_domain` 之前，同域名同时存在时永远走 AI
- `fake-ip` 会废掉 eBPF 的 `bypass_rule_set`
- 上传后必须用 GitHub API 核对，CDN 有缓存

---

## 仓库产出

上传到 `SamrtinSinale/IPset_List`（branch `main`）：

```
cn_ip_final.srs    国内 IP 列表
cn_domain.srs      国内域名列表（已去掉 top/wang/yun 裸后缀）
ai.srs             AI 服务列表
```

**配置里的 URL 已固定指向该仓库，重建后不用改配置。**
