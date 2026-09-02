# 职途 · 阿里云部署指南

> 适用于：阿里云 ECS / 轻量应用服务器（Ubuntu 22.04/24.04）。整个应用零外部依赖：数据存本地 SQLite，运行只需 Node.js。

## 一、准备（一次即可）

### 1. 装 Node.js 24 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # 应输出 v24.x
```

> 本项目使用 `node:sqlite`（Node 内置模块）。Node 24 完全稳定；最低要求 ≥ 22.5（22.x 需带 flag，项目脚本已自动带上 `--experimental-sqlite`）。

### 2. 安装 pm2 与 nginx

```bash
sudo npm install -g pm2
sudo apt-get install -y nginx
```

## 二、上传代码并构建

```bash
# 以部署路径 /opt/career-navigator 为例
sudo mkdir -p /opt/career-navigator && sudo chown -R $USER:$USER /opt/career-navigator
cd /opt/career-navigator
# 方式 A：git clone（推荐，方便后续更新）
git clone <你的仓库地址> .
# 方式 B：scp 上传
# scp -r ./career-navigator/* user@服务器:/opt/career-navigator/

npm ci --omit=dev
npm run build          # 首次约 1-2 分钟
mkdir -p logs
```

> 构建时若提示 lint warnings 可忽略（不影响产物）；构建失败通常来自权限/磁盘，先 `df -h` 与 `chown` 检查。

### 3. 配置环境变量（必做）

```bash
nano .env.local
```

```ini
ADMIN_TOKEN=<一个足够长的随机口令>
```

生成口令：`openssl rand -base64 24`

> `ADMIN_TOKEN` 不设则 `/admin` 数据后台不加锁——**公网部署必须设置**。
> 生产环境 cookie 为 `httpOnly + secure`，请确保走 HTTPS（见第四节），否则登录态不生效。

## 三、启动（pm2 守护）

```bash
cd /opt/career-navigator
# 修改 deploy/ecosystem.config.cjs 里的 cwd 为本路径后：
pm2 start deploy/ecosystem.config.cjs
pm2 save && pm2 startup   # 开机自启
```

验证：`curl -I http://127.0.0.1:3000` 返回 200 即可。

> 单实例运行（SQLite 不支持多进程写同一文件）。不要改成 cluster 模式。

## 四、域名 + HTTPS

1. 阿里云控制台：安全组放行 **80 / 443**（轻量服务器在「防火墙」页放行）
2. 域名解析 A 记录指向服务器公网 IP
3. 上传证书到 `/etc/nginx/ssl/`（阿里云免费证书或 Let's Encrypt 均可）
4. 复制模板并按注释填写：
   ```bash
   sudo cp deploy/nginx-career.conf /etc/nginx/sites-available/career
   sudo nano /etc/nginx/sites-available/career     # 填你的域名
   sudo ln -s /etc/nginx/sites-available/career /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   ```

现在访问 `https://你的域名` 即可。

## 五、数据与备份

| 数据 | 位置 |
|---|---|
| 知识库种子 | 仓库内 `data/*.json`（只读，随代码管理） |
| 用户画像 / 规划记录 / 我的 JD | `/opt/career-navigator/career.db`（SQLite，首次启动自动创建） |
| 上传的简历 | 不落盘（解析后即弃） |

**备份/迁移**（整站搬家）：
```bash
pm2 stop career-navigator
cp /opt/career-navigator/career.db 备份目录/   # 数据库连同 data/ 目录一起拷贝
pm2 start career-navigator
```

**恢复出厂数据**：删除 `career.db` 后重启，会按 `data/*.json` 自动重建种子知识库（用户记录会随之清空，慎用）。

## 六、日常更新上线

```bash
cd /opt/career-navigator
git pull
npm ci --omit=dev
npm run build
pm2 restart career-navigator
```

## 常见问题

- **登录后台一直失败**：确认 `.env.local` 的 `ADMIN_TOKEN` 生效（`pm2 restart` 后），且访问是 HTTPS。
- **上传简历 413**：Nginx `client_max_body_size` 没设（模板已含 6m）。
- **上传 502 / 解析超时**：PDF 解析为 CPU 密集型，单核机器大文件可能稍慢；5MB 上限内一般没问题。
- **换端口**：改 `ecosystem.config.cjs` 的 `-p 3000` 与 Nginx `proxy_pass` 端口保持一致。
