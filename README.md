# ⚡ CAKE — AI Unified Runtime Assistant v0.1.0

Modular AI framework CLI + Discord bot. Supports Claude, OpenAI, Gemini, and local Ollama models.

---

## Project Structure

```
src/
├── config/
│   ├── env.ts              # All env vars in one typed object — import from here
│   └── constants.ts        # App-wide constants (paths, prompts, version)
│
├── providers/              # AI backends — all implement AIProvider interface
│   ├── types.ts            # AIProvider, Message, ChatOptions interfaces
│   ├── claude.ts
│   ├── openai.ts
│   ├── gemini.ts
│   ├── ollama.ts
│   └── index.ts            # createProvider() factory
│
├── modules/                # Feature modules — each split into focused files
│   ├── email/
│   │   ├── imap.ts         # Raw IMAP fetching only
│   │   ├── summarize.ts    # AI summarization only
│   │   └── index.ts        # Public re-exports
│   ├── news/
│   │   ├── fetch.ts        # RSS feed fetching
│   │   ├── summarize.ts    # AI summarization + digest
│   │   └── index.ts
│   ├── calendar/
│   │   ├── auth.ts         # Google OAuth flow
│   │   ├── events.ts       # CRUD operations
│   │   └── index.ts
│   ├── todo/
│   │   ├── store.ts        # JSON read/write operations
│   │   ├── plan.ts         # AI plan generation
│   │   └── index.ts
│   ├── search/
│   │   ├── duckduckgo.ts   # Raw DDG API fetch
│   │   ├── answer.ts       # AI answer synthesis
│   │   └── index.ts
│   └── files/
│       ├── operations.ts   # Pure fs operations (read/write/list/delete/move)
│       ├── ai.ts           # AI-powered file ops (summarize/edit/compose)
│       └── index.ts
│
├── agent/                  # Routing brain
│   ├── router.ts           # ROUTES table — regex → handler mapping
│   ├── handlers.ts         # One handler function per intent
│   ├── history.ts          # ConversationHistory class
│   └── index.ts            # AuraAgent class
│
├── cli/                    # React Ink terminal UI
│   ├── index.tsx           # Entry point — render(<App />) only
│   ├── App.tsx             # Root layout — calls useAgent hook
│   ├── components/
│   │   ├── Header.tsx      # Provider/version bar
│   │   ├── MessageList.tsx # Chat history display
│   │   └── InputBar.tsx    # Text input
│   └── hooks/
│       └── useAgent.ts     # All agent + slash-command logic
│
└── discord/                # Discord.js slash command bot
    ├── index.ts            # Entry point + command dispatcher
    ├── register.ts         # Command definitions + API registration
    └── handlers/           # One file per command group
        ├── ask.ts
        ├── email.ts
        ├── news.ts
        ├── calendar.ts
        ├── todos.ts
        ├── search.ts
        └── files.ts
```

---

## Adding a New Module

1. Create `src/modules/<name>/` with focused files + `index.ts`
2. Add a handler function in `src/agent/handlers.ts`
3. Add a route entry in `src/agent/router.ts` (one line)
4. _(Optional)_ Add a Discord slash command in `src/discord/register.ts` + handler in `src/discord/handlers/`

That's it — nothing else needs to change.

---

## Setup

```bash
cp .env.example .env   # fill in API keys
npm install
npm run dev            # CLI
npm run discord        # Discord bot
```

## Switching Providers at Runtime

```
/provider ollama       # switch to local Ollama
/provider claude       # switch back to Claude
/model mistral         # change model
```

## Google Calendar Auth

```
/calendar auth             # prints OAuth URL
/calendar token <code>     # saves token
```

---

## Supported Providers

| Provider | Env Var             | Default Model   |
| -------- | ------------------- | --------------- |
| `claude` | `ANTHROPIC_API_KEY` | claude-opus-4-5 |
| `openai` | `OPENAI_API_KEY`    | gpt-4o          |
| `gemini` | `GEMINI_API_KEY`    | gemini-1.5-pro  |
| `ollama` | `OLLAMA_BASE_URL`   | llama3          |
