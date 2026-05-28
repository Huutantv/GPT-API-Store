# Dockerfile cho Doro Proxy (Node.js)
FROM node:20-slim

ENV NODE_ENV=production

WORKDIR /app

# Cài dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy source code
COPY doro_proxy_node.js credit.js orders.js mailer.js ./
COPY ecosystem.config.cjs ./
COPY *.html ./

# Port mặc định
EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD node -e "const http=require('http');http.get('http://localhost:4000/health',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

# Chạy proxy
CMD ["node", "doro_proxy_node.js"]
