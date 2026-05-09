import * as H from "./handlers/index.js";

import type { AIProvider, ChatResult } from "../providers/types.js";

export type Handler = (
  provider: AIProvider,
  input: string,
  model?: string,
) => Promise<ChatResult>;

export const intentMap: Record<string, Handler> = {
  email: H.handleEmail,
  news: H.handleNews,
  calendar_list: H.handleCalendarList,
  calendar_create: H.handleCalendarCreate,
  calendar_remove: H.handleCalendarRemove,
  todo_list: H.handleTodoList,
  todo_add: H.handleTodoAdd,
  plan: H.handlePlan,
  file_list: H.handleFileList,
  directory_tree: H.handleDirectoryTree,
  document_read: H.handleReadDocument,
  document_summarize: H.handleSummarizeDocument,
  document_ask: H.handleAskDocument,
  file_read: H.handleFileRead,
  file_summarize: H.handleFileSummarize,
  file_compose: H.handleFileCompose,
  search: H.handleSearch,
  memory_index: H.handleIndexDocument,
  cron_list: H.handleListCron,
  cron_schedule: H.handleScheduleTask,
  cron_remove: H.handleRemoveCron,
  notify: H.handleNotify,
  test_notify: H.handleTestNotify,
  finance: H.handleFinanceReport,
  weather: H.handleWeather,
  // Sink — also reachable as a standalone intent
  export: H.handleExport,
  save: H.handleExport,
  write: H.handleExport,
};
