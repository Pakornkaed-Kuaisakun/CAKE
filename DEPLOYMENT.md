# CAKE Core - Deployment Guide

## 🚀 Deployment Options

### Option 1: Local Development (Recommended for Testing)

```bash
# Install dependencies
npm install
cd web && npm install && cd ..

# Run development servers
npm run dev:all

# Access:
# - Frontend: http://localhost:3000
# - Backend: http://localhost:8000
```

---

### Option 2: Docker Compose (Recommended for Production)

```bash
# Build and run both services
docker-compose up --build

# Access:
# - Frontend: http://localhost:3000
# - Backend: http://localhost:8000

# Cleanup
docker-compose down
```

---

### Option 3: Docker (Separate Services)

#### Build Images
```bash
# Backend server
docker build -t cake-server:latest -f Dockerfile.server .

# Web frontend
docker build -t cake-web:latest -f web/Dockerfile .
```

#### Run Containers
```bash
# Start backend
docker run -d \
  -p 8000:8000 \
  -e ANTHROPIC_API_KEY=your-key \
  -e OPENAI_API_KEY=your-key \
  --name cake-server \
  cake-server:latest

# Start frontend
docker run -d \
  -p 3000:3000 \
  -e VITE_API_URL=http://localhost:8000 \
  --name cake-web \
  cake-web:latest

# Access: http://localhost:3000
```

---

### Option 4: Vercel/Netlify (Frontend Only)

#### Prerequisites
- Backend running elsewhere (e.g., Railway, Heroku)
- Update `VITE_API_URL` to point to backend

#### Deploy Frontend
```bash
# Build
npm run build -w web

# Vercel CLI
npm i -g vercel
cd web
vercel --prod
```

#### Environment Variables
Set in Vercel dashboard:
```
VITE_API_URL=https://your-backend.com
```

---

### Option 5: Heroku (Full Stack)

#### Create Heroku App
```bash
heroku create your-cake-app
heroku buildpacks:add heroku/nodejs
```

#### Procfile
```
web: npm run server
```

#### Deploy
```bash
git push heroku main
```

---

### Option 6: AWS (EC2 + Load Balancer)

#### Launch EC2 Instance
- OS: Ubuntu 22.04
- Type: t3.medium (minimum)
- Security: Allow ports 3000, 8000, 22

#### SSH into Instance
```bash
ssh -i your-key.pem ubuntu@your-instance-ip
```

#### Setup
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install nodejs

# Clone repository
git clone https://github.com/your-repo.git
cd cake

# Install dependencies
npm install
cd web && npm install && cd ..

# Create .env with API keys
nano .env

# Install PM2 for process management
sudo npm install -g pm2

# Start services
pm2 start npm --name "cake-server" -- run server
pm2 start npm --name "cake-web" -- run dev:web

# Save PM2 startup script
pm2 startup
pm2 save

# Setup Nginx as reverse proxy
sudo apt install nginx
```

#### Nginx Config
```nginx
upstream cake_server {
  server localhost:8000;
}

upstream cake_web {
  server localhost:3000;
}

server {
  listen 80;
  server_name your-domain.com;

  location / {
    proxy_pass http://cake_web;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
  }

  location /v1 {
    proxy_pass http://cake_server;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
  }
}
```

#### Enable HTTPS
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

---

### Option 7: Railway

```bash
# Link to Railway
railway link

# Set environment variables
railway variables ANTHROPIC_API_KEY=your-key

# Deploy
railway up
```

---

## 🔐 Environment Setup

### Required Variables
```env
# Backend
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...

# Optional
OLLAMA_BASE_URL=http://localhost:11434
PORT=8000

# Frontend
VITE_API_URL=http://localhost:8000
```

---

## 📊 Production Checklist

- [ ] API keys set in environment
- [ ] Backend CORS configured correctly
- [ ] Frontend .env points to correct backend
- [ ] SSL/HTTPS enabled
- [ ] Database backups configured (if using persistence)
- [ ] Error logging set up
- [ ] Rate limiting configured
- [ ] CDN configured for static assets
- [ ] Monitoring/alerting enabled
- [ ] Backup server ready

---

## 🎯 Performance Optimization

### Frontend
```bash
# Optimize bundle
npm run build -- --minify=terser

# Analyze bundle size
npm install -D rollup-plugin-visualizer
```

### Backend
- Enable HTTP caching headers
- Compress responses (gzip)
- Use CDN for static files
- Implement request rate limiting
- Cache model lists

### Database (if added)
- Index frequently queried columns
- Archive old conversations
- Use connection pooling
- Regular backups

---

## 🚨 Monitoring

### Logs
```bash
# Backend logs
docker logs cake-server -f

# Frontend logs
docker logs cake-web -f
```

### Health Checks
```bash
# Backend health
curl http://localhost:8000/v1/models

# Frontend health
curl http://localhost:3000
```

---

## 🔄 CI/CD Pipeline Example (GitHub Actions)

```yaml
name: Deploy CAKE Core

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'

      - name: Install dependencies
        run: |
          npm install
          cd web && npm install && cd ..

      - name: Build
        run: npm run build

      - name: Deploy to Railway
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
        run: railway up
```

---

## 📝 Post-Deployment

1. Test all chat features
2. Verify API endpoints
3. Check error logging
4. Monitor performance
5. Set up backup schedule
6. Configure auto-scaling if needed

---

## 🆘 Troubleshooting

### Backend won't start
```bash
# Check port in use
lsof -i :8000

# Check logs
docker logs cake-server
npm run server 2>&1 | tail -20
```

### Frontend can't connect to API
- Check VITE_API_URL environment variable
- Verify backend is running
- Check CORS headers in backend
- Check firewall rules

### Slow performance
- Check API response times
- Monitor CPU/memory usage
- Check database queries
- Enable caching

---

## 📚 Additional Resources

- [Node.js Deployment Guide](https://nodejs.org/en/docs/guides/nodejs-docker-webapp/)
- [React Vite Documentation](https://vitejs.dev/guide/ssr.html)
- [Docker Compose Reference](https://docs.docker.com/compose/compose-file/)
- [Nginx Configuration Guide](https://nginx.org/en/docs/)

---

## 💬 Support

For deployment issues:
1. Check logs for specific errors
2. Verify all environment variables
3. Test API endpoints with curl
4. Check firewall/security rules
5. Review system resources

---

Happy deploying! 🚀
