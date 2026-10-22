# 永久链接方案（GitHub + EdgeOne Pages）

**目标：一个永久有效、随时能打开、不依赖你电脑开机的网址。**

---

## 先说死结论

**EdgeOne Pages 上，唯一能永久有效的链接，是你绑定自己域名的那个链接。**

原因（[官方域名文档](https://pages.edgeone.ai/zh/document/domain-overview)原文）：

> 中国大陆网络环境：须使用系统生成的预览链接进行访问，**该链接有效期为 3 小时，超时后将返回 401 错误**。

平台白送的默认域名，在大陆网络下只给 3 小时。这不是配置问题，改不了。
所以：**必须有一个自己的域名。**

成本：一个 `.com` 域名约 ¥30~70/年。除此之外全部免费。

---

## 完整方案（三步）

### 第一步：代码上 GitHub

本地这个目录已经初始化好 git、写好 `.gitignore`、做过首次提交。你只需要建远程仓库并推上去：

```bash
cd deltaforce-codes

# 在 GitHub 网页上新建一个空仓库（不要勾选 README），然后：
git remote add origin https://github.com/你的用户名/deltaforce-codes.git
git branch -M main
git push -u origin main
```

**`.gitignore` 已经挡掉了这些东西**（我实测验证过）：
- `data/.admin-password` —— 管理密码，绝不外泄
- `data/codes.db` —— 本地数据库
- `public/` —— 构建产物，云端会自己生成

**仓库里只有**：源码、`static/` 前端、`data/codes.json`（你的改枪码数据）、构建配置。

⚠️ 仓库里**没有** `server.py` 的运行环境要求 —— 它只在你本地跑后台。
上传到 GitHub 后，EdgeOne 只构建静态前台。

### 第二步：EdgeOne 导入仓库

1. 登录 [EdgeOne Makers 控制台](https://pages.edgeone.ai/)
2. **创建项目 → 导入 Git 仓库**，授权 GitHub，选中刚推的仓库
3. 构建配置会被 `edgeone.json` 自动识别，确认这几项：

| 配置项 | 值 |
|---|---|
| 构建命令 | `python3 build.py \|\| python build.py` |
| 输出目录 | `public` |
| 根目录 | `./`（默认） |

4. **加速区域**按你的情况选：
   - 域名**已备案** → 选「中国大陆可用区」（速度最快）
   - 域名**未备案** → 选「全球可用区（不含中国大陆）」（不需要备案）

5. 点部署。等 1~2 分钟，构建完成。

> 构建脚本是纯标准库 Python，EdgeOne 的构建环境自带 Python，不需要 `pip install` 任何东西。

### 第三步：绑定你的域名（这步才是"永久"的关键）

项目详情 → **域名管理** → 添加自定义域名：

1. 输入你的域名，如 `guns.yourdomain.com`
2. 按提示到域名注册商（阿里云/腾讯云/Cloudflare）添加 **CNAME 记录**，指向 EdgeOne 给的地址
3. 配置 SSL 证书（EdgeOne 可申请免费证书，或上传你自己的）
4. 等待 DNS 生效（几分钟到几小时）

完成后，`https://guns.yourdomain.com` 就是**永久链接**，发给粉丝即可。

---

## 以后怎么更新数据

改完码后，在本地跑一条命令：

```bash
python publish.py
```

它做三件事：
1. 从本地数据库导出 `data/codes.json`
2. `git commit`
3. `git push`

EdgeOne 收到 push 会自动重建，**1~2 分钟后粉丝刷新就是新数据**。你的域名不变。

只想导出不想推送：`python publish.py --no-push`

---

## 三条路线对比（都验证过）

| 方案 | 链接永久？ | 备案 | 大陆速度 | 成本 | 适合 |
|---|---|---|---|---|---|
| **GitHub + EdgeOne + 自有域名** | ✅ | 未备案可选海外区 | 快（备案后最快） | 域名费 | **你现在的选择** |
| GitHub + Vercel/Netlify | ✅ | 不需要 | 时快时慢 | 免费 | 备用/镜像 |
| 腾讯云 COS 香港 + 自有域名 | ✅ | 不需要 | 快 | 存储费+域名 | 备选 |

**建议**：EdgeOne 做主站，Vercel 做一个镜像站。如果哪天主站出问题，把备用链接发出去。
两边的构建产物完全一样（都是 `public/`）。

---

## 必须知道的几个边界

**1. 平台送你的域名不是永久的**
这不是 EdgeOne 的 bug，是合规要求。任何国内云厂商的默认域名都有类似限制。
**只有你自己的域名才是长期资产** —— 换平台也不用改链接。

**2. 域名到期不续费 = 链接失效**
记得开自动续费。这是唯一可能让"永久链接"失效的人为因素。

**3. 静态版没有后台、没有复制统计**
粉丝只能搜索和复制。你导入数据仍然在自己电脑上做。
复制次数在静态版不累加（历史数据会显示）。

**4. EdgeOne 免费额度很宽裕**
[官方配额](https://pages.edgeone.ai/zh/document/limits-and-quotas)：构建 500 次/月、
项目 40 个、单文件 25MB、总存储 5GB。你的站点 33KB，完全够用。
免费版官方承诺长期有效。

**5. 数据仍在你自己手里**
真正的数据源是 `data/codes.db`（本地），`data/codes.json` 只是导出物。
定期备份整个 `data/` 目录。

---

## 上线检查清单

- [ ] GitHub 仓库已推送，确认**没有** `.admin-password` 和 `codes.db`
- [ ] EdgeOne 首次构建成功，产物里有 `index.html` / `codes.json`
- [ ] 自定义域名已绑定，`https://` 能打开（**不是** 3 小时的预览链接）
- [ ] 用**手机流量**（不是 WiFi）打开测试 —— 这是粉丝的真实环境
- [ ] 搜索、筛选、点「复制改枪码」都正常
- [ ] 域名开了自动续费
- [ ] `data/.admin-password` 没出现在任何截图/群聊里
