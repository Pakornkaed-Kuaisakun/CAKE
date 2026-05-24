import * as H from "./handlers/index.js";
import type { AIProvider, ChatResult } from "../providers/types.js";
import { getPluginIntentMap } from "./plugins/index.js";

import type { RunOptions } from "./index.js";

export type Handler = (
  provider: AIProvider,
  input: string,
  model?: string,
  options?: RunOptions,
) => Promise<ChatResult>;

export const BASE_INTENT_MAP: Record<string, Handler> = {
  // ── Core chat ──────────────────────────────────────────────────────────────
  chat: H.handleChat,

  // ── Email ──────────────────────────────────────────────────────────────────
  email: H.handleEmail,
  email_send: H.handleSendEmail,

  // ── News ───────────────────────────────────────────────────────────────────
  news: H.handleNews,

  // ── Calendar ───────────────────────────────────────────────────────────────
  calendar_list: H.handleCalendarList,
  calendar_create: H.handleCalendarCreate,
  calendar_remove: H.handleCalendarRemove,

  // ── Todos ──────────────────────────────────────────────────────────────────
  todo_list: H.handleTodoList,
  todo_add: H.handleTodoAdd,
  todo_remove: H.handleTodoRemove,
  todo_remove_all: H.handleTodoRemoveAll,
  plan: H.handlePlan,

  // ── Files ──────────────────────────────────────────────────────────────────
  file_list: H.handleFileList,
  file_read: H.handleFileRead,
  file_summarize: H.handleFileSummarize,
  file_compose: H.handleFileCompose,
  file_find: H.handleFindFile,
  directory_tree: H.handleDirectoryTree,

  // ── Documents ──────────────────────────────────────────────────────────────
  document_read: H.handleReadDocument,
  document_summarize: H.handleSummarizeDocument,
  document_ask: H.handleAskDocument,
  memory_index: H.handleIndexDocument,

  // ── Search ─────────────────────────────────────────────────────────────────
  search: H.handleSearch,

  // ── Cron ───────────────────────────────────────────────────────────────────
  cron_list: H.handleListCron,
  cron_schedule: H.handleScheduleTask,
  cron_remove: H.handleRemoveCron,

  // ── Notifications ──────────────────────────────────────────────────────────
  notify: H.handleNotify,
  test_notify: H.handleTestNotify,

  // ── Finance / Weather ──────────────────────────────────────────────────────
  finance: H.handleFinanceReport,
  weather: H.handleWeather,

  // ── Export ─────────────────────────────────────────────────────────────────
  export: H.handleExport,

  // ── System ─────────────────────────────────────────────────────────────────
  security_scan: H.handleSecurityScan,
  diagnose: H.handleDiagnoseSystem,
  performance: H.handleDiagnosePerformance,

  // ── Shell ──────────────────────────────────────────────────────────────────
  bash: H.handleBash,

  // ── Autonomous Agent ───────────────────────────────────────────────────────
  autonomous: H.handleAutonomous,

  // ── Plugins ────────────────────────────────────────────────────────────────
  plugins: H.handlePlugins,

  screenshot: H.handleScreenshot,
  vision: H.handleScreenshot,

  // ── Vector Database ────────────────────────────────────────────────────────
  vdb_query: H.handleVdbQuery,
  vdb_search: H.handleVdbQuery,
  vdb_ask: H.handleVdbQuery,
  vdb_add: H.handleVdbAdd,
  vdb_insert: H.handleVdbAdd,
  vdb_ingest: H.handleVdbIngest,
  vdb_import: H.handleVdbIngest,
  vdb_index: H.handleVdbIngest,
  vdb_create: H.handleVdbCreate,
  vdb_list: H.handleVdbList,
  vdb_ls: H.handleVdbList,
  vdb_delete: H.handleVdbDelete,
  vdb_remove: H.handleVdbDelete,
  vdb_drop: H.handleVdbDrop,
  vdb_clear: H.handleVdbClear,
  vdb_info: H.handleVdbInfo,
  vdb: H.handleVdbDispatch,
  // ── Locker ─────────────────────────────────────────────────────────────────
  locker_add: H.handleLockerAdd,
  locker_get: H.handleLockerGet,
  locker_show: H.handleLockerGet,
  locker_list: H.handleLockerList,
  locker_delete: H.handleLockerDelete,
  locker_remove: H.handleLockerDelete,
  locker_update: H.handleLockerUpdate,
  locker_clear: H.handleLockerClear,
  locker_info: H.handleLockerInfo,
  locker: H.handleLockerInfo, // bare "locker" → info/help
};

/**
 * Returns the merged intent map: built-ins + all loaded plugin intents.
 * Called on every routing decision so new plugins are always reflected.
 */
export function getIntentMap(): Record<string, Handler> {
  return { ...BASE_INTENT_MAP, ...getPluginIntentMap() };
}

// Keep backward-compat alias for the few places that import intentMap directly
export const intentMap: Record<string, Handler> = new Proxy({} as any, {
  get(_t, key: string) {
    return getIntentMap()[key];
  },
  has(_t, key: string) {
    return key in getIntentMap();
  },
  ownKeys() {
    return Object.keys(getIntentMap());
  },
  getOwnPropertyDescriptor(_t, key: string) {
    const v = getIntentMap()[key];
    return v ? { value: v, enumerable: true, configurable: true } : undefined;
  },
});
