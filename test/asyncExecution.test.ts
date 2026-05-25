import assert from "node:assert";
import { CakeAgent } from "../src/agent/index.js";
import type { AIProvider } from "../src/providers/types.js";

const stubProvider: AIProvider = {
  name: "openai" as const,
  async chat(messages) {
    const prompt = messages[messages.length - 1]?.content ?? "";
    await new Promise((resolve) => setTimeout(resolve, 30));
    return {
      text: `Executed: ${prompt}`,
      usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
    };
  },
};

async function testAsyncExecutionFeature() {
  const agent = new CakeAgent(stubProvider, "gpt-4o-mini");

  const queued = await agent.run("async summarize the project plan");
  assert.ok(/Queued background task/i.test(queued.text));

  const idMatch = queued.text.match(/task\s+([0-9a-f-]+)\b/i);
  assert.ok(idMatch?.[1], "Expected task id in queued response");
  const taskId = idMatch![1];

  const status = await agent.run(`async_status ${taskId}`);
  assert.ok(/Status:/i.test(status.text));

  let finished = false;
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const poll = await agent.run(`async_status ${taskId}`);
    if (/Status:\s*completed/i.test(poll.text)) {
      finished = true;
      break;
    }
  }

  assert.ok(finished, "Background task should complete within the time window");

  const listResult = await agent.run("async_list");
  assert.ok(/completed/i.test(listResult.text), "Async list should include completed task");
}

async function main() {
  try {
    await testAsyncExecutionFeature();
    console.log("PASS: asynchronous execution feature works.");
  } catch (err) {
    console.error("TEST FAILED", err);
    process.exit(1);
  }
}

main();
