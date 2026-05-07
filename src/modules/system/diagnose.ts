import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";

export type DiagnosisResult = {
  category: string;
  status: "ok" | "warning" | "error";
  message: string;
};

export async function diagnoseSystem(): Promise<DiagnosisResult[]> {
  const results: DiagnosisResult[] = [];

  // OS INFO
  results.push({
    category: "system",
    status: "ok",
    message:
      `${os.type()} ${os.release()} | ` +
      `${os.arch()} | ` +
      `${Math.round(os.totalmem() / 1024 / 1024 / 1024)} GB RAM`,
  });

  // CPU LOAD
  const load = os.loadavg()[0];

  if (load > 4) {
    results.push({
      category: "performance",
      status: "warning",
      message: `High CPU load: ${load.toFixed(2)} (system may be slow)`,
    });
  } else {
    results.push({
      category: "performance",
      status: "ok",
      message: `CPU load OK: ${load.toFixed(2)}`,
    });
  }

  // Memory
  const freeMem = os.freemem() / os.totalmem();

  if (freeMem < 0.15) {
    results.push({
      category: "memory",
      status: "warning",
      message: "Low available RAM",
    });
  } else {
    results.push({
      category: "memory",
      status: "ok",
      message: `${Math.round(os.freemem() / 1024 / 1024 / 1024)} GB free RAM`,
    });
  }

  // NODE.JS VERSION
  results.push({
    category: "node",
    status: "ok",
    message: `Node.js ${process.version}`,
  });

  // PACKAGE MANAGER (npm / yarn / pnpm / bun)
  try {
    const lockfile = path.join(process.cwd(), "package-lock.json");
    const yarnLock = path.join(process.cwd(), "yarn.lock");
    const pnpmLock = path.join(process.cwd(), "pnpm-lock.yaml");
    const bunLock = path.join(process.cwd(), "bun.lockb");

    if (fs.existsSync(lockfile)) {
      results.push({
        category: "environment",
        status: "ok",
        message: "Using npm",
      });
    } else if (fs.existsSync(yarnLock)) {
      results.push({
        category: "environment",
        status: "ok",
        message: "Using Yarn",
      });
    } else if (fs.existsSync(pnpmLock)) {
      results.push({
        category: "environment",
        status: "ok",
        message: "Using pnpm",
      });
    } else if (fs.existsSync(bunLock)) {
      results.push({
        category: "environment",
        status: "ok",
        message: "Using Bun",
      });
    } else {
      results.push({
        category: "environment",
        status: "warning",
        message: "No package manager lock file detected",
      });
    }
  } catch {}

  // GIT STATUS (only if not inside .git)
  if (!process.cwd().includes(".git")) {
    try {
      const status = execSync("git status --porcelain").toString().trim();

      if (status) {
        results.push({
          category: "git",
          status: "warning",
          message: `Uncommitted changes detected`,
        });
      } else {
        results.push({
          category: "git",
          status: "ok",
          message: `Clean working directory`,
        });
      }
    } catch {}
  } else {
    results.push({
      category: "git",
      status: "error",
      message: `Inside .git directory`,
    });
  }

  // GIT VERSION
  try {
    execSync("git --version");

    results.push({
      category: "git",
      status: "ok",
      message: "Git installed",
    });
  } catch {
    results.push({
      category: "git",
      status: "warning",
      message: "Git not installed",
    });
  }

  // NODE_MODULES
  const node_modules = path.join(process.cwd(), "node_modules");

  if (fs.existsSync(node_modules)) {
    results.push({
      category: "environment",
      status: "ok",
      message: `node_modules exists`,
    });
  } else {
    results.push({
      category: "environment",
      status: "error",
      message: `node_modules not found`,
    });
  }

  // ENV FILE
  const envFile = path.resolve(".env");

  if (!fs.existsSync(envFile)) {
    results.push({
      category: "env",
      status: "warning",
      message: ".env file not found",
    });
  } else {
    results.push({
      category: "env",
      status: "ok",
      message: ".env detected",
    });
  }

  // TYPESCRIPT
  const tsconfig = path.resolve("tsconfig.json");

  if (!fs.existsSync(tsconfig)) {
    results.push({
      category: "typescript",
      status: "warning",
      message: "tsconfig.json missing",
    });
  } else {
    results.push({
      category: "typescript",
      status: "ok",
      message: "TypeScript configured",
    });
  }

  // INTERNET
  try {
    execSync("ping -c 1 google.com", {
      stdio: "ignore",
    });

    results.push({
      category: "network",
      status: "ok",
      message: "Internet connection available",
    });
  } catch {
    results.push({
      category: "network",
      status: "warning",
      message: "No internet connection",
    });
  }

  // PROJECT SIZE
  try {
    const projectSize = execSync("du -sh .").toString().trim();

    results.push({
      category: "environment",
      status: "ok",
      message: `Project size: ${projectSize}`,
    });
  } catch {
    results.push({
      category: "environment",
      status: "warning",
      message: "Could not calculate project size",
    });
  }

  // API KEYS
  const apiKeys = [
    "GOOGLE_API_KEY",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "ANTHROPIC_API_KEY",
  ];

  for (const apiKey of apiKeys) {
    if (
      !process.env[apiKey] ||
      process.env[apiKey] === "" ||
      process.env[apiKey] === "undefined" ||
      process.env[apiKey] === "YOUR_API_KEY"
    ) {
      results.push({
        category: "env",
        status: "warning",
        message: `${apiKey} not found`,
      });
    } else {
      results.push({
        category: "env",
        status: "ok",
        message: `${apiKey} found`,
      });
    }
  }

  // BASE LOCAL LLM URL
  const baseLocalLLMUrl = process.env.OLLAMA_BASE_URL;

  if (!baseLocalLLMUrl) {
    results.push({
      category: "env",
      status: "warning",
      message: "OLLAMA_BASE_URL not found",
    });
  } else {
    results.push({
      category: "env",
      status: "ok",
      message: "OLLAMA_BASE_URL detected",
    });
  }

  // LAST MODIFIED
  const lastModified = fs.statSync(process.cwd()).mtime.toLocaleString();

  results.push({
    category: "environment",
    status: "ok",
    message: `Last modified: ${lastModified}`,
  });

  return results;
}
