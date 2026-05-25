import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { TokenBudgetTracker } from "../src/agent/tokenBudgetTracker.js";
import { MemoryManager } from "../src/modules/memory/index.js";
import { CakeAgent } from "../src/agent/index.js";
import { AIProvider } from "../src/providers/types.js";

const TEST_STORAGE = path.join(process.cwd(), "test", "tmp-memory");

const stubProvider: AIProvider = {
  name: "openai",
  embed: async (_text: string) => Array(16).fill(1),
  chat: async () => ({
    text: "[DECISION] refined summary",
    usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
  }),
};

afterAll();

function afterAll() {
  if (fs.existsSync(TEST_STORAGE)) {
    fs.rmSync(TEST_STORAGE, { recursive: true, force: true });
  }
}

function resetStorage() {
  afterAll();
  fs.mkdirSync(TEST_STORAGE, { recursive: true });
}

async function testTokenBudgetReport() {
  const tracker = new TokenBudgetTracker(1000);
  tracker.record(200);
  tracker.recordSavings(40);
  tracker.record(100);

  assert.strictEqual(tracker.isNearLimit(), false);
  const report = tracker.getReport();
  assert.strictEqual(report.sessionTokens, 300);
  assert.strictEqual(report.remainingTokens, 700);
  assert.strictEqual(report.savedTokens, 40);
  assert.strictEqual(report.hourlyLimit, 1000);
}

async function testMemoryReflection() {
  resetStorage();

  const memory = new MemoryManager(stubProvider, TEST_STORAGE);
  await memory.remember(
    "This is a long note with [ACTION] and important follow-up details.",
    { source: "conversation" },
  );
  await memory.remember(
    "Decision: choose the best path and record it clearly.",
    { source: "conversation" },
  );

  const updated = await (memory as any).reflectAndUpdate("gpt-4o-mini", 5);
  assert.ok(updated >= 0, "reflectAndUpdate should return a non-negative count");

  const entries = (memory as any).store.listEntries();
  assert.strictEqual(entries.length, 2);
  assert.ok(entries.every((entry: any) => typeof entry.text === "string" && entry.text.length > 0));
}

async function testBudgetGating() {
  const agent = new CakeAgent(stubProvider, "gpt-4o-mini");
  assert.strictEqual(agent.shouldRetrieveMemory(50), true);

  (agent as any).budgetTracker.record(500_000 * 0.92);
  assert.strictEqual(agent.shouldRetrieveMemory(50), false);
}

async function main() {
  try {
    await testTokenBudgetReport();
    await testMemoryReflection();
    await testBudgetGating();
    console.log("PASS: memory reflection and budget gating tests passed.");
  } catch (err) {
    console.error("TEST FAILED", err);
    process.exit(1);
  } finally {
    afterAll();
  }
}

main();
