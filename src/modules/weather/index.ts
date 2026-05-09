import type { WeatherResponse } from "./types.js";
import { weatherLabel } from "./weatherCode.js";
import { detectLocationFromIP } from "./location.js";
import {
  loadWeatherCache,
  saveWeatherCache,
  loadLocationCache,
  saveLocationCache,
} from "./cache.js";

export async function getWeatherReport(): Promise<string> {
  let geo = loadLocationCache();

  if (!geo) {
    geo = await detectLocationFromIP();
    saveLocationCache(geo);
  }

  const params = new URLSearchParams({
    latitude: String(geo.latitude),
    longitude: String(geo.longitude),
    current: "temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m",
    daily:
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max",
    forecast_days: "3",
    timezone: "auto",
  });

  let weather = loadWeatherCache<WeatherResponse>();

  if (!weather) {
    const weatherRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?${params.toString()}`,
    );

    if (!weatherRes.ok) {
      throw new Error(`Weather API request failed (${weatherRes.status})`);
    }

    weather = (await weatherRes.json()) as WeatherResponse;
    saveWeatherCache(weather);
  }

  // Fix: filter undefined parts and join properly
  const placeParts = [geo.city, geo.region, geo.country_name].filter(Boolean);
  const place =
    placeParts.length > 0 ? placeParts.join(", ") : "Unknown location";

  const fmtDay = (i: number) =>
    `${weather!.daily.time[i]}: ${weatherLabel(weather!.daily.weather_code[i])}, ` +
    `${weather!.daily.temperature_2m_min[i]}°C to ${weather!.daily.temperature_2m_max[i]}°C, ` +
    `Precipitation: ${weather!.daily.precipitation_sum[i]}mm, ` +
    `Max P: ${weather!.daily.precipitation_probability_max[i]}%`;

  return [
    `[WEATHER] Location from IP: ${place} (${geo.latitude.toFixed(4)}, ${geo.longitude.toFixed(4)})`,
    `Current: ${weather.current.temperature_2m}°C, ${weatherLabel(weather.current.weather_code)}, ` +
      `wind speed ${weather.current.wind_speed_10m}km/h, humidity ${weather.current.relative_humidity_2m}%`,
    `Forecast`,
    `- ${fmtDay(0)}`,
    `- ${fmtDay(1)}`,
    `- ${fmtDay(2)}`,
  ].join("\n");
}
