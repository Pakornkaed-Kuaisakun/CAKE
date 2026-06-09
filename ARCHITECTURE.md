```
╔════════════════════════════════════════════════════════════════════════════╗
║                   CAKE Core - Web UI Architecture                           ║
╚════════════════════════════════════════════════════════════════════════════╝

┌─────────────────────────────────────────────────────────────────────────────┐
│                          🌐 USER BROWSER (Port 3000)                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  React Application (Vite + Tailwind CSS)                              │  │
│  │                                                                        │  │
│  │  ┌─────────────────┬──────────────────┬─────────────────────────┐    │  │
│  │  │                 │                  │                         │    │  │
│  │  │  <Sidebar>      │  <ChatView>      │ <MessageBubble>         │    │  │
│  │  │  • Chats List   │  • Messages      │ • User Messages         │    │  │
│  │  │  • New Chat     │  • Input Area    │ • AI Responses          │    │  │
│  │  │  • Settings     │  • Loading      │ • Copy Button           │    │  │
│  │  │                 │                  │                         │    │  │
│  │  └─────────────────┴──────────────────┴─────────────────────────┘    │  │
│  │                                                                        │  │
│  │  ┌──────────────────────────────────────────────────────────────┐    │  │
│  │  │ <ModelSelector>                                              │    │  │
│  │  │ • Provider Dropdown (Claude, OpenAI, Gemini, Ollama)        │    │  │
│  │  │ • Model Dropdown (gpt-4, claude-3, etc)                     │    │  │
│  │  └──────────────────────────────────────────────────────────────┘    │  │
│  │                                                                        │  │
│  │  ┌──────────────────────────────────────────────────────────────┐    │  │
│  │  │ Zustand Store (useChatStore)                                 │    │  │
│  │  │ • Conversations[]                                             │    │  │
│  │  │ • currentConversationId                                      │    │  │
│  │  │ • selectedModel                                              │    │  │
│  │  │ • isLoading                                                  │    │  │
│  │  └──────────────────────────────────────────────────────────────┘    │  │
│  │                                                                        │  │
│  │  ┌──────────────────────────────────────────────────────────────┐    │  │
│  │  │ API Client (web/src/api/chatApi.ts)                          │    │  │
│  │  │ • getAvailableModels()                                       │    │  │
│  │  │ • chatCompletion() - Non-streaming                           │    │  │
│  │  │ • streamChatCompletion() - Streaming (Async Generator)       │    │  │
│  │  └──────────────────────────────────────────────────────────────┘    │  │
│  │                                                                        │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌─ HTTP Requests ──────────────────────────────────────────────────────┐  │
│  │ GET  /v1/models                                                      │  │
│  │ POST /v1/chat/completions (with streaming support)                   │  │
│  │ Accept: application/json, text/event-stream                          │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                           │                                  │
│                                           ▼                                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                            │
                                            │ (CORS Proxy)
                                            │
┌─────────────────────────────────────────────────────────────────────────────┐
│                    🖥️  CAKE Core Backend (Port 8000)                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ HTTP Server (Node.js Native)                                          │  │
│  │                                                                        │  │
│  │ Routes:                                                               │  │
│  │  • GET  /v1/models         ──▶  Returns available models             │  │
│  │  • POST /v1/chat/completions ──▶  Routes to CakeAgent.run()          │  │
│  │                                                                        │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                    │                                         │
│                                    ▼                                         │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ CakeAgent (src/agent/index.ts)                                        │  │
│  │                                                                        │  │
│  │ • Router.ts        - Routes requests to handlers                     │  │
│  │ • Handlers         - Feature-specific logic                          │  │
│  │ • History.ts       - Conversation management                         │  │
│  │                                                                        │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                    │                                         │
│                                    ▼                                         │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ Providers (src/providers/)                                            │  │
│  │                                                                        │  │
│  │ ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  │  │
│  │ │  claude.ts   │  │  openai.ts   │  │  gemini.ts   │  │ ollama.ts│  │  │
│  │ │              │  │              │  │              │  │          │  │  │
│  │ │ Anthropic    │  │ OpenAI API   │  │ Google API   │  │ Local    │  │  │
│  │ │ SDK          │  │              │  │              │  │ Model    │  │  │
│  │ └──────────────┘  └──────────────┘  └──────────────┘  └──────────┘  │  │
│  │                                                                        │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                    │                                         │
│                                    ▼                                         │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ Modules (src/modules/)                                                │  │
│  │                                                                        │  │
│  │ • email/       - Email integration                                    │  │
│  │ • calendar/    - Calendar integration                                 │  │
│  │ • todo/        - Todo management                                      │  │
│  │ • search/      - Web search                                           │  │
│  │ • vectordb/    - Vector database                                      │  │
│  │ • memory/      - Memory management                                    │  │
│  │ • news/        - News aggregation                                     │  │
│  │ ... and more                                                          │  │
│  │                                                                        │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │  External APIs & Services     │
                    │                               │
                    │ • Anthropic Claude            │
                    │ • OpenAI GPT                  │
                    │ • Google Gemini               │
                    │ • Local Ollama Server         │
                    │ • Email (IMAP/SMTP)           │
                    │ • Google Calendar             │
                    │ • Web Search (DuckDuckGo)     │
                    │ • And more...                 │
                    │                               │
                    └───────────────────────────────┘


╔════════════════════════════════════════════════════════════════════════════╗
║                           Data Flow Example                                 ║
╚════════════════════════════════════════════════════════════════════════════╝

1. USER SENDS MESSAGE
   Browser                          Backend
   │                                │
   ├─ User types "hello"            │
   ├─ Presses Enter                 │
   ├─ MessageBubble renders         │
   │  (user message)                │
   ├─ ChatView sends POST            │
   │  /v1/chat/completions ────────▶ CakeAgent.run()
   │                                │ ├─ Routes to handler
   │                                │ ├─ Selects provider
   │                                │ └─ Calls API
   │ ◀─ Streams responses ◀──────── Returns chunks
   │  (event-stream)                │
   ├─ Updates UI in real-time       │
   │  (streaming animation)         │
   ├─ MessageBubble updates         │
   │  (final response)              │
   │                                │
   └─ Conversation saved            │


╔════════════════════════════════════════════════════════════════════════════╗
║                        File Structure Overview                              ║
╚════════════════════════════════════════════════════════════════════════════╝

cake/
│
├── src/
│   ├── server/index.ts             (HTTP server & API routes)
│   ├── agent/
│   │   ├── index.ts                (CakeAgent class)
│   │   ├── router.ts               (Route mappings)
│   │   ├── handlers/               (Slash command handlers)
│   │   └── autonomous/             (Autonomous execution)
│   │
│   ├── providers/
│   │   ├── types.ts                (AIProvider interface)
│   │   ├── claude.ts               (Anthropic)
│   │   ├── openai.ts               (OpenAI)
│   │   ├── gemini.ts               (Google)
│   │   └── ollama.ts               (Local)
│   │
│   ├── modules/                    (Feature modules)
│   └── config/                     (Configuration)
│
├── web/                            ⭐ NEW WEB UI
│   ├── src/
│   │   ├── main.tsx                (Entry point)
│   │   ├── App.tsx                 (Root component)
│   │   ├── App.css                 (Styles)
│   │   ├── index.css               (Global styles)
│   │   │
│   │   ├── components/
│   │   │   ├── ChatView.tsx        (Main chat interface)
│   │   │   ├── Sidebar.tsx         (Conversation list)
│   │   │   ├── MessageBubble.tsx   (Message display)
│   │   │   └── ModelSelector.tsx   (Provider/model selection)
│   │   │
│   │   ├── api/
│   │   │   └── chatApi.ts          (API client)
│   │   │
│   │   └── store/
│   │       └── chatStore.ts        (Zustand state)
│   │
│   ├── package.json                (Dependencies)
│   ├── vite.config.ts              (Build config)
│   ├── tsconfig.json               (TypeScript config)
│   ├── tailwind.config.js          (Tailwind config)
│   ├── index.html                  (HTML template)
│   ├── Dockerfile                  (Container image)
│   └── README.md                   (Documentation)
│
├── package.json                    (Root dependencies)
├── QUICKSTART.md                   (Quick start guide)
├── DEPLOYMENT.md                   (Deployment guide)
├── docker-compose.yml              (Docker Compose)
├── Dockerfile.server               (Server container)
│
└── README.md                       (Updated with web UI info)


╔════════════════════════════════════════════════════════════════════════════╗
║                         Tech Stack Summary                                  ║
╚════════════════════════════════════════════════════════════════════════════╝

FRONTEND (web/)
├─ React 19                 - UI library
├─ TypeScript               - Type safety
├─ Vite                     - Build tool
├─ Tailwind CSS             - Styling
├─ Zustand                  - State management
├─ Axios                    - HTTP client
└─ Lucide React             - Icons

BACKEND (src/)
├─ Node.js                  - Runtime
├─ TypeScript               - Type safety
├─ Anthropic SDK            - Claude integration
├─ OpenAI SDK               - GPT integration
├─ Google Generative AI     - Gemini integration
└─ Ollama client            - Local models

INFRASTRUCTURE
├─ Vite Dev Server          - HMR on port 3000
├─ Node.js HTTP Server      - API on port 8000
├─ Docker                   - Containerization
├─ Docker Compose           - Orchestration
└─ Tailwind CSS             - Utility-first CSS


╔════════════════════════════════════════════════════════════════════════════╗
║                              Commands                                       ║
╚════════════════════════════════════════════════════════════════════════════╝

npm run dev          - Terminal CLI (React Ink)
npm run dev:web      - Web UI dev server (port 3000)
npm run dev:server   - Backend server (port 8000)
npm run dev:all      - Both server & web (recommended)
npm run build        - Build both backend & frontend
npm run server       - Run built backend
npm run discord      - Discord bot

cd web
npm run dev          - Web dev server only
npm run build        - Build web app
npm run preview      - Preview production build


╔════════════════════════════════════════════════════════════════════════════╗
║                           Access Points                                     ║
╚════════════════════════════════════════════════════════════════════════════╝

Development:
  Frontend:  http://localhost:3000
  Backend:   http://localhost:8000
  API Docs:  http://localhost:8000/v1/models

Production (Docker):
  Frontend:  http://your-domain.com
  Backend:   http://your-domain.com/v1/*
```

---

## 🎯 What's Next?

✅ **Web UI Created**
- Modern, responsive interface
- OpenWebUI-inspired design
- Real-time message streaming
- Multi-provider support

🚀 **Next Steps:**
1. Start development: `npm run dev:all`
2. Test chat functionality
3. Customize theme/styling
4. Add more features to components
5. Deploy to production

📚 **Documentation:**
- QUICKSTART.md - 5-minute setup
- DEPLOYMENT.md - Production guide
- web/README.md - Frontend docs

🐳 **Docker Ready:**
- docker-compose.yml for full stack
- Dockerfile.server for backend
- web/Dockerfile for frontend

---

**Your CAKE Core web UI is ready to go! 🍰**
