import fs from "fs";
import path from "path";
import { CAKE_DIR } from "../../config/constants.js";

const CACHE_FILE = path.join(CAKE_DIR, "weather.json");

interface WeatherCache<T> {
  date: string;

  data: T;
}

function todayKey(): string {
  return new Date().toISOString().split("T")[0];
}

export function loadWeatherCache<T>(): T | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) {
      return null;
    }

    const raw = fs.readFileSync(CACHE_FILE, "utf-8");

    const cache = JSON.parse(raw) as WeatherCache<T>;

    /**
     * reset daily
     */

    if (cache.date !== todayKey()) {
      return null;
    }

    return cache.data;
  } catch {
    return null;
  }
}

export function saveWeatherCache<T>(data: T): void {
  fs.mkdirSync(CAKE_DIR, {
    recursive: true,
  });

  const payload: WeatherCache<T> = {
    date: todayKey(),

    data,
  };

  fs.writeFileSync(CACHE_FILE, JSON.stringify(payload, null, 2));
}
