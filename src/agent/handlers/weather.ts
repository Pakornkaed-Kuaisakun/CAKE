import type { AIProvider, ChatResult } from "../../providers/types.js";
import { formatChatResult } from "../../shared/utils/utils.js";
import { getWeatherReport } from "../../modules/weather/index.js";

export async function handleWeather(
  _provider: AIProvider,
  _input: string,
  _model?: string,
): Promise<ChatResult> {
  const report = await getWeatherReport();
  return formatChatResult(report);
}
