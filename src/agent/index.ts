// src/agent/index.ts
import type { AIProvider, TokenUsage } from "../providers/types.js";
import { ConversationHistory } from "./history.js";
import { MemoryManager } from "../modules/memory/index.js";
import { matchRoute } from "./router.js";
import { aiIntentRouter } from "./AiRouter.js";
import { intentMap } from "./intentMap.js";
import { SYSTEM_PROMPT } from "../config/constants.js";
import { initCronManager } from "./handlers/cron.js";

export interface AgentResponse {

  text: string;
  usage?: TokenUsage;
}

export class CakeAgent {
  private provider: AIProvider;
  private history: ConversationHistory;
  private memory: MemoryManager;
  private model: string | undefined;

  constructor(provider: AIProvider, model?: string) {
    this.provider = provider;
    this.history = new ConversationHistory();
    this.memory = new MemoryManager(provider);
    this.model = model;

    // Initialize Cron - execute jobs through agent.run()
    initCronManager(async (job) => {
      console.log(`[BOOT] Running scheduled task: ${job.taskDescription}`);
      await this.run(job.taskDescription);
    });
  }



  setModel(model: string | undefined) {
    this.model = model;
  }

  clearHistory(): void {
    this.history.clear();
  }

  async run(input: string): Promise<AgentResponse> {
    // 1. Retrieve relevant context from memory
    const relevantContext = await this.memory.retrieve(input);
    const contextString = relevantContext.length > 0 
      ? "\n\nRelevant context from past interactions:\n" + relevantContext.map(c => `- ${c}`).join("\n")
      : "";

    const handler = matchRoute(input);

    if (handler) {
      const result = await handler(this.provider, input, this.model);
      
      // Save successful tool results to memory if they are informative
      if (result.text.length > 50) {
        await this.memory.remember(`User asked: ${input}\nResult: ${result.text}`, { source: "tool" });
      }

      return { text: result.text, usage: result.usage };
    }

    const intent = await aiIntentRouter(this.provider, input, this.model);
    const aiHandler = intentMap[intent];

    if (aiHandler) {
      const result = await aiHandler(this.provider, input, this.model);
      return { text: result.text, usage: result.usage };
    }

    // Fallback: general conversation with history + RAG context
    this.history.push("user", input);
    
    const result = await this.provider.chat(this.history.getAll(), {
      systemPrompt: SYSTEM_PROMPT + contextString,
      model: this.model,
    });

    this.history.push("assistant", result.text);

    // Save this interaction to memory for future RAG retrieval
    await this.memory.remember(`User: ${input}\nAssistant: ${result.text}`, { source: "conversation" });

    return { text: result.text, usage: result.usage };
  }
}

