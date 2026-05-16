module.exports = {
  apps: [
    {
      name: "gpt-api-store",
      script: "doro_proxy_node.js",
      instances: 1,          // Giữ 1 vì dùng SQLite
      exec_mode: "fork",
      max_memory_restart: "512M",
      watch: false,
      autorestart: true,
      restart_delay: 3000,
      env: {
        NODE_ENV: "production"
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "logs/pm2-error.log",
      out_file: "logs/pm2-out.log",
      merge_logs: true
    }
  ]
};
