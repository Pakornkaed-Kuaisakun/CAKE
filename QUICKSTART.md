# CAKE Core Web UI - Quick Start Guide

## 🚀 Quick Start (5 minutes)

### Step 1: Install Dependencies

```bash
# Root project
npm install

# Web UI
cd web
npm install
cd ..
```

### Step 2: Start Everything

Run both the backend server and web UI:

```bash
npm run dev:all
```

This will start:
- **Backend Server**: http://localhost:8000
- **Web UI**: http://localhost:3000

### Step 3: Open Browser

Navigate to: **http://localhost:3000**

You should see the CAKE Core chat interface!

---

## 📝 What You Can Do

1. **Start a new chat** - Click "New Chat" in the sidebar
2. **Select a provider** - Choose between Claude, OpenAI, Gemini, or Ollama
3. **Select a model** - Pick your preferred model from the dropdown
4. **Send messages** - Type and press Enter (or Shift+Enter for new line)
5. **View history** - All conversations are listed in the sidebar
6. **Copy responses** - Hover over AI messages and click the copy icon

---

## 🔧 Environment Setup

### Create `.env` file in root:
```bash
cp .env.example .env
```

### Create `.env` file in web folder:
```bash
cp web/.env.example web/.env
```

Edit as needed (default values usually work fine).

---

## 📦 Running Separately

### Backend Only
```bash
npm run dev:server
```
Access at: http://localhost:8000/v1/models

### Frontend Only
```bash
npm run dev:web
```
Access at: http://localhost:3000
(Make sure backend is running!)

---

## 🏗️ Building for Production

```bash
npm run build
```

This builds both:
- Backend TypeScript → JavaScript
- Web UI → Optimized static files in `web/dist`

---

## 🐳 Docker Setup (Optional)

### Run with Docker Compose
```yaml
version: '3.8'
services:
  cake-server:
    build: .
    ports:
      - "8000:8000"
    environment:
      - PORT=8000
      - ANTHROPIC_API_KEY=your-key-here

  cake-web:
    build: ./web
    ports:
      - "3000:3000"
    environment:
      - VITE_API_URL=http://cake-server:8000
```

---

## 🎨 Customization

### Change Theme Colors
Edit `web/tailwind.config.js`:
```javascript
colors: {
  'primary': '#10a37f',      // Main accent color
  'surface': '#1a1a1a',      // Dark background
  'surface-light': '#2a2a2a' // Lighter surface
}
```

### Change API Endpoint
Edit `web/.env`:
```
VITE_API_URL=http://your-server:port
```

---

## 📚 Project Structure

```
cake/
├── src/                 # Backend (Node.js)
│   ├── server/         # HTTP server & API routes
│   ├── agent/          # AI routing logic
│   ├── providers/      # Claude, OpenAI, Gemini, Ollama
│   └── modules/        # Feature modules
│
├── web/                # Frontend (React + Vite)
│   ├── src/
│   │   ├── components/ # React components
│   │   ├── api/       # API client
│   │   └── store/     # Zustand state
│   └── dist/          # Built files (production)
│
└── README.md           # This file
```

---

## 🚨 Troubleshooting

### "Cannot connect to API"
1. Check backend is running: `npm run dev:server`
2. Verify `VITE_API_URL` in `web/.env`
3. Check browser console for CORS errors

### "Models list is empty"
1. Ensure backend has provider API keys set (.env)
2. Check backend logs for errors
3. Restart backend server

### "Messages not streaming"
1. Check browser Network tab for `/v1/chat/completions` requests
2. Verify backend is receiving requests
3. Check provider API keys are valid

### "Port 3000 or 8000 already in use"
Kill existing processes or change ports in `vite.config.ts` and `src/server/index.ts`

---

## 🔐 Security Notes

- Store API keys in `.env` files (never commit!)
- `.env` files are in `.gitignore`
- Don't share your `.env` files
- For production, use environment variables

---

## 📈 Next Steps

1. Customize the UI components in `web/src/components/`
2. Add new features using the CAKE Core API
3. Integrate additional handlers and modules
4. Deploy to production

---

## 💬 Support

For issues or questions:
1. Check existing GitHub issues
2. Review backend logs: `npm run dev:server`
3. Check frontend console (F12 in browser)
4. Check `.env` file configuration

---

Happy chatting! 🍰
