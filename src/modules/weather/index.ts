import { GeoResult, WeatherResponse } from "./types.js";
import { weatherCodeMap, weatherLabel } from "./weatherCode.js";

export async function getWeatherReport(): Promise<string> {
  const geoRes = await fetch("https://ipapi.co/json/");
  if (!geoRes.ok) {
    throw new Error(`Failed to detect location from IP (${geoRes.status})`);
  }

  const geo = (await geoRes.json()) as GeoResult;
  if (typeof geo.latitude !== "number" || typeof geo.longitude !== "number") {
    throw new Error("IP lookup did not return latitude/longitude");
  }

  const params = new URLSearchParams({
    latitude: String(geo.latitude),
    longitude: String(geo.longitude),
    current:
      "temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m,time",
    daily:
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,time",
    forecast_days: "3",
    timezone: "auto",
  });

  const weatherRes = await fetch(
    `https://api.open-meteo.com/v1/forecast?${params.toString()}`,
  );
  if (!weatherRes.ok) {
    throw new Error(`Weather API request failed (${weatherRes.status})`);
  }

  const weather = (await weatherRes.json()) as WeatherResponse;
  const place = [geo.city, geo.region, geo.country_name];

  const today = `${weather.daily.time[0]}: ${weatherLabel(weather.daily.weather_code[0])}, ${weather.daily.temperature_2m_min[0]}°C to ${weather.daily.temperature_2m_max[0]}°C, P: ${weather.daily.precipitation_sum[0]}mm`;

  const tomorrow = `${weather.daily.time[1]}: ${weatherLabel(weather.daily.weather_code[1])}, ${weather.daily.temperature_2m_min[1]}°C to ${weather.daily.temperature_2m_max[1]}°C, P: ${weather.daily.precipitation_sum[1]}mm`;

  const dayAfter = `${weather.daily.time[2]}: ${weatherLabel(weather.daily.weather_code[2])}, ${weather.daily.temperature_2m_min[2]}°C to ${weather.daily.temperature_2m_max[2]}°C, P: ${weather.daily.precipitation_sum[2]}mm`;

  return [
    `[WEATHER] Location from IP: ${place || "Unknown location"} (${geo.latitude.toFixed(4)}, ${geo.longitude.toFixed(4)})`,
    `Current: ${weather.current.temperature_2m}°C, ${weatherLabel(weather.current.weather_code)}, wind speed ${weather.current.wind_speed_10m}km/h, humidity ${weather.current.relative_humidity_2m}%`,
    `Forecast`,
    `- ${today}`,
    `- ${tomorrow}`,
    `- ${dayAfter}`,
  ].join("\n");
}
