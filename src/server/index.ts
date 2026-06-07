import "dotenv/config";
import http from "http";
import crypto from "crypto";
import { getDefaultProvider } from "../providers/index.js";
import { CakeAgent } from "../agent/index.js";

const PORT = process.env.PORT || 8000;

function sendJson(res: http.ServerResponse, status: number, data: any) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  // ── CORS Headers ──────────────────────────────────────────────────────────
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── GET /v1/models ────────────────────────────────────────────────────────
  if (req.method === "GET" && req.url === "/v1/models") {
    sendJson(res, 200, {
      object: "list",
      data: [
        {
          id: "cake",
          object: "model",
          created: Math.floor(Date.now() / 1000),
          owned_by: "cake",
        },
      ],
    });
    return;
  }

  // ── POST /v1/chat/completions ─────────────────────────────────────────────
  if (req.method === "POST" && req.url === "/v1/chat/completions") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", async () => {
      try {
        const payload = JSON.parse(body);
        const { messages, stream = false } = payload;

        if (!Array.isArray(messages) || messages.length === 0) {
          sendJson(res, 400, {
            error: "Messages array is required and must not be empty",
          });
          return;
        }

        const lastMsg = messages[messages.length - 1];
        const history = messages.slice(0, -1);

        const provider = getDefaultProvider();
        const agent = new CakeAgent(provider);

        // Load conversation history into agent context
        const formattedHistory = history.map((m: any) => ({
          role: (m.role === "system"
            ? "system"
            : m.role === "assistant"
              ? "assistant"
              : "user") as "system" | "assistant" | "user",
          content:
            typeof m.content === "string"
              ? m.content
              : JSON.stringify(m.content),
        }));
        agent.loadHistory(formattedHistory);

        const chatcmplId = `chatcmpl-${crypto.randomUUID()}`;
        const created = Math.floor(Date.now() / 1000);

        if (stream) {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });

          // Define callback to stream tokens back to client
          const onChunk = (chunk: string) => {
            const data = {
              id: chatcmplId,
              object: "chat.completion.chunk",
              created,
              model: "cake",
              choices: [
                {
                  delta: { content: chunk },
                  index: 0,
                  finish_reason: null,
                },
              ],
            };
            res.write(`data: ${JSON.stringify(data)}\n\n`);
          };

          try {
            await agent.run(lastMsg.content, { onChunk });

            // Send end block
            const endData = {
              id: chatcmplId,
              object: "chat.completion.chunk",
              created,
              model: "cake",
              choices: [
                {
                  delta: {},
                  index: 0,
                  finish_reason: "stop",
                },
              ],
            };
            res.write(`data: ${JSON.stringify(endData)}\n\n`);
            res.write("data: [DONE]\n\n");
            res.end();
          } catch (runErr: any) {
            const errData = {
              id: chatcmplId,
              object: "chat.completion.chunk",
              choices: [
                {
                  delta: {
                    content: `\n[Error running agent: ${runErr.message}]`,
                  },
                  index: 0,
                  finish_reason: "stop",
                },
              ],
            };
            res.write(`data: ${JSON.stringify(errData)}\n\n`);
            res.write("data: [DONE]\n\n");
            res.end();
          }
        } else {
          // Non-streaming response
          const result = await agent.run(lastMsg.content);
          sendJson(res, 200, {
            id: chatcmplId,
            object: "chat.completion",
            created,
            model: "cake",
            choices: [
              {
                message: {
                  role: "assistant",
                  content: result.text,
                },
                finish_reason: "stop",
                index: 0,
              },
            ],
            usage: {
              prompt_tokens: result.usage?.inputTokens ?? 0,
              completion_tokens: result.usage?.outputTokens ?? 0,
              total_tokens:
                (result.usage?.inputTokens ?? 0) +
                (result.usage?.outputTokens ?? 0),
            },
          });
        }
      } catch (parseErr: any) {
        sendJson(res, 400, {
          error: `Invalid JSON payload: ${parseErr.message}`,
        });
      }
    });
    return;
  }

  // ── Fallback 404 ──────────────────────────────────────────────────────────
  sendJson(res, 404, { error: "Not Found" });
});

server.listen(PORT, () => {
  console.log(
    `🌐 OpenAI-compatible Cake Server running at http://localhost:${PORT}`,
  );
});
