module.exports = {
  apps: [
    {
      name: "doro-proxy",
      script: "doro_proxy_node.js",
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
