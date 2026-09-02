/**
 * PM2 守护配置（阿里云 ECS / 轻量服务器生产部署）
 *
 * 用法：
 *   1. 上传代码到服务器目录（下文以 /opt/career-navigator 为例）
 *   2. 在该目录设置 .env.local（含 ADMIN_TOKEN）
 *   3. pm2 start ecosystem.config.cjs
 *
 * 注意：SQLite 单文件存储，只能跑单实例，不要开 cluster 模式。
 */
module.exports = {
  apps: [
    {
      name: "career-navigator",
      cwd: "/opt/career-navigator", // 改成你的实际部署路径
      script: "npm",
      args: "start -- -p 3000", // npm start 自带 node --experimental-sqlite
      instances: 1,
      autorestart: true,
      max_memory_restart: "400M",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      out_file: "/opt/career-navigator/logs/out.log",
      error_file: "/opt/career-navigator/logs/err.log",
      merge_logs: true,
      time: true,
    },
  ],
};
