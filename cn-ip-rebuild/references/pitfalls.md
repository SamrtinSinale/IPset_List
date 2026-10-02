# 踩过的坑（都是实际发生过的）

**这一节比方法论更重要 —— 这些错误都真实发生过，重复一次要浪费几小时。**

---

## 坑 1：用错数据集做差集（最隐蔽）

**现象**：脚本跑完了，但 `subtract` 什么也没删。

**原因**：探针文件 `final-verify.json` 里的 IP 是从 `USER − UNION` 抽的，但脚本以为是从 `(BGP ∪ APNIC) − MaxMind` 抽的。**两个集合不相交，差集自然是空。**

**教训**：**差集的两个操作数必须来自同一个"宇宙"。** 跑之前先打印两个集合的规模和交集大小自检。

---

## 坑 2：用精确相等匹配 /24（静默失效）

```js
// ❌ 错：/24 块的 start/end 和大段的 start/end 永不相等
const opDrop = drop.filter(d => ranges.some(r => r.start === d.start && r.end === d.end));

// ✅ 对：判断区间是否被覆盖
const opDrop = drop.filter(d => ranges.some(r => d.start >= r.start && d.end <= r.end));
```

**教训**：处理 IP 区间永远用**区间包含判断**，不要用相等。

---

## 坑 3：仲裁器的 `international` 关键词误伤

**现象**：`210.73.106.246`（中信）被判成境外，但 ip-api 和 MaxMind **都说是 CN**。

**原因**：ISP 名是 `China International Trust & Investment Corporation`，命中了关键词表里的 `international`。

**同类误伤**：
```
China International Trust & Investment    → "international"
Alibaba.com Singapore E-Commerce          → "singapore"（这条算对，见坑4）
```

**教训**：**关键词表要人工复核。** 尤其是 `international` / `global` 这种常见于中国公司名的词。

**建议**：把 `international` 从关键词表移除，或改成只在**其他证据也指向境外时**才生效。

---

## 坑 4：对"中国公司海外实体"无解

**现象**：阿里云新加坡的段（`8.148.x` `8.150.x` `8.176.0.0/17`）：

```
ip-api     → CN
MaxMind    → CN
ISP 名     → "Alibaba.com Singapore E-Commerce Private Limited"
```

**两个地理库都说中国，只有 ISP 名说新加坡。**

**这是数据源的固有矛盾，无法自动判定。** 我们的选择是**删掉**（因为 ISP 名是更直接的证据），代价是可能误删了实际在中国使用的段。

**教训**：**不要试图用算法解决数据源矛盾。** 要么接受误差，要么换付费源。

---

## 坑 5：全量 /24 扫描不可行

**算过**：列表有 **1,351,904 个 /24**。

```
ip-api 免费版 45 请求/分钟 × 100 IP/请求 = 4,500 IP/分钟
1,351,904 / 4,500 ≈ 300 分钟 ≈ 5 小时
```

**太长。** 所以必须**分层**：只对低置信区（约 214 万 IP / 8,852 个 /24）做逐 /24 验证，其余直接信任。

---

## 坑 6：/16 粒度扫描漏掉小块

**现象**：`5.10.138.0/24`（德国电信欧洲）藏在 `5.10.0.0/16` 里。如果 /16 扫描只在块内取 2 个采样点，**采不到这个 /24**。

**教训**：**粒度决定漏检率。** /16 扫描对"小块嵌在大块里"的情况无效。

---

## 坑 7：DNS 解析受解析器位置影响

**现象**：通过代理的 DoH 查 `www.douyin.com`，返回 `155.102.180.248`（阿里云**香港** CDN）。

**原因**：CDN 按**解析器所在地**返回不同节点。走代理查 DoH，拿到的就是为代理位置优化的节点。

**教训**：
- **域名规则集匹配不受影响**（规则集匹配不看 DNS）
- **但具体 IP 的归属判断会失真** —— 手机在国内解析会拿到大陆节点

**验证 IP 归属时，要用目标设备所在地的解析结果。**

---

## 坑 8：规则顺序让域名规则失效

**现象**：把 `wb.usaa.ccwu.cc` 同时加进 `ai.srs` 和 `cn_domain.srs`，结果还是走 AI 选择器。

**原因**：
```
规则13  rule_set=AI            → AI选择器
规则16  rule_set=[cn_ip,cn_domain] → 国内网站 → 直连
```

**规则 13 在前，永远先命中。** 要让域名走直连，必须**先从 ai.srs 里移除**。

**教训**：**改规则集之前先看规则顺序。** 同一个值出现在多个规则集里，靠前的赢。

---

## 坑 9：裸 TLD 吞掉整个后缀

**现象**：`520.linjiajia.top`（美国服务器）走直连打不开。

**原因**：DustinWin 的 `cn.srs` 里有 `domain_suffix: "top"` —— **所有 `.top` 域名都被当成国内**。

**必须删的裸后缀**：`top` `wang` `yun`（通用 gTLD，全球可注册）

**可以保留的**：
```
cn          中国国家 TLD
xn--*       中文 IDN TLD
baidu taobao weibo tmall alipay icbc ...   这些公司申请的品牌 TLD
```

---

## 坑 10：fake-ip 会废掉 eBPF bypass

**原理**：
```
开 fake-ip 后 → 所有域名解析成 198.18.x.x
→ 目标 IP 永远不在 cn_ip 里
→ bypass_rule_set: ["cn_ip"] 完全失效
→ 全部流量挤进 sing-box
```

**教训**：**用 eBPF bypass 架构就不要开 fake-ip。** 两者互斥。

（fake-ip 解决的是"没有嗅探能力时怎么按域名分流"。有了 `sniffer: ["http","tls","quic","stun","dns"]` 就不需要它。）

---

## 坑 11：CDN 缓存导致上传后验证失败

**现象**：刚 push 完从 `raw.githubusercontent.com` 拉回来，内容还是旧的。

**解决**：**用 GitHub API 的 `contents` 端点核对**，不要用 CDN：

```js
const v = await fetch(`https://api.github.com/repos/OWNER/REPO/contents/${path}?ref=main`, { headers });
const vj = await v.json();
const ok = sha256(Buffer.from(vj.content, 'base64')) === sha256(localBuf);
```

**配置里的 URL 有 CDN 缓存时，重启后可能仍拿旧内容 —— 让用户等几分钟再重启一次。**

---

## 坑 12：过度优化一个方向

**反复发生的错误**：

```
第一轮：追求覆盖率 → 把国内 IP 全收进来 → 境外漏留严重
第二轮：追求精度   → 用交集         → 国内大量误杀
第三轮：又偏回来...
```

**教训**：**两个方向要同时量化。** 每次改完必须同时报告：
- 境外漏留率
- 国内误杀率

**只看一个指标必然走偏。**

---

## 坑 13：PowerShell 的引号地狱

**现象**：`node -e "..."` 里的引号被 PowerShell 吃掉，或者转义符出问题。

**解决**：**永远写 `.js` 脚本文件再执行**，不要用 `node -e` 传复杂代码。

**另外**：PowerShell 函数名不要用 `R`（会和 `Invoke-History` 别名冲突）。

---

## 坑 14：`$LASTEXITCODE` 对 sing-box 不可靠

**现象**：`sing-box rule-set match` 判断命中时，退出码不对。

**解决**：**检测 stdout 里的字面量 `match rules`**：

```powershell
$o = & .\sing-box.exe rule-set match -f binary $srs $ip 2>&1 | Out-String
$hit = $o -match 'match rules'
```

**另外**：`rule-set match` 对 `.srs` 必须加 `-f binary`，否则报 `invalid character 'S' looking for beginning of value`。
