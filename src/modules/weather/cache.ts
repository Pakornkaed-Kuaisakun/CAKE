import fs from "fs";
import path from "path";
import { CAKE_DIR } from "../../config/constants.js";
import { GeoResult, WeatherResponse } from "./types.js";

const CACHE_DIR = path.join(CAKE_DIR, "cache");
const LOCATION_CACHE_FILE = path.join(CACHE_DIR, "location.json");
const WEATHER_CACHE_FILE = path.join(CACHE_DIR, "weather.json");

interface Cache<T> {
  date: string;

  data: T;
}

function todayKey(): string {
  return new Date().toISOString().split("T")[0];
}

export function loadWeatherCache<T>(): T | null {
  try {
    if (!fs.existsSync(WEATHER_CACHE_FILE)) {
      return null;
    }

    const raw = fs.readFileSync(WEATHER_CACHE_FILE, "utf-8");

    const cache = JSON.parse(raw) as Cache<T>;

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

export function loadLocationCache(): GeoResult | null {
  try {
    if (!fs.existsSync(LOCATION_CACHE_FILE)) {
      return null;
    }

    const raw = fs.readFileSync(LOCATION_CACHE_FILE, "utf-8");

    const cache = JSON.parse(raw) as Cache<GeoResult>;

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
  fs.mkdirSync(CACHE_DIR, {
    recursive: true,
  });

  const payload: Cache<T> = {
    date: todayKey(),

    data,
  };

  fs.writeFileSync(WEATHER_CACHE_FILE, JSON.stringify(payload, null, 2));
}

export function saveLocationCache(data: GeoResult): void {
  fs.mkdirSync(CACHE_DIR, {
    recursive: true,
  });

  const payload: Cache<GeoResult> = {
    date: todayKey(),

    data,
  };

  fs.writeFileSync(LOCATION_CACHE_FILE, JSON.stringify(payload, null, 2));
}
