import { GeoResult, WeatherResponse } from "./types.js";
import { weatherCodeMap, weatherLabel } from "./weatherCode.js";
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
  const place = [geo.city, geo.region, geo.country_name];

  const today = `${weather.daily.time[0]}: ${weatherLabel(weather.daily.weather_code[0])}, ${weather.daily.temperature_2m_min[0]}°C to ${weather.daily.temperature_2m_max[0]}°C, Precipitation: ${weather.daily.precipitation_sum[0]}mm, Max P: ${weather.daily.precipitation_probability_max[0]}%`;

  const tomorrow = `${weather.daily.time[1]}: ${weatherLabel(weather.daily.weather_code[1])}, ${weather.daily.temperature_2m_min[1]}°C to ${weather.daily.temperature_2m_max[1]}°C, Precipitation: ${weather.daily.precipitation_sum[1]}mm, Max P: ${weather.daily.precipitation_probability_max[1]}%`;

  const dayAfter = `${weather.daily.time[2]}: ${weatherLabel(weather.daily.weather_code[2])}, ${weather.daily.temperature_2m_min[2]}°C to ${weather.daily.temperature_2m_max[2]}°C, Precipitation: ${weather.daily.precipitation_sum[2]}mm, Max P: ${weather.daily.precipitation_probability_max[2]}%`;

  return [
    `[WEATHER] Location from IP: ${place || "Unknown location"} (${geo.latitude.toFixed(4)}, ${geo.longitude.toFixed(4)})`,
    `Current: ${weather.current.temperature_2m}°C, ${weatherLabel(weather.current.weather_code)}, wind speed ${weather.current.wind_speed_10m}km/h, humidity ${weather.current.relative_humidity_2m}%`,
    `Forecast`,
    `- ${today}`,
    `- ${tomorrow}`,
    `- ${dayAfter}`,
  ].join("\n");
}
