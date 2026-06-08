// Free map APIs: Nominatim (OSM geocoding), Overpass (POI search),
// OSRM (routing + distances), Open-Meteo (weather at destination)
// No API keys required.

import { APP_NAME, APP_REPO } from "../../config/constants.js";
import type { GeoPoint, POI, RouteSegment, TripWeather } from "./types.js";

// ── Nominatim: name → coordinates ────────────────────────────────────────────

const NOMINATIM = "https://nominatim.openstreetmap.org";

export async function geocode(placeName: string): Promise<GeoPoint | null> {
  const url = `${NOMINATIM}/search?q=${encodeURIComponent(placeName)}&format=json&limit=1&accept-language=th,en`;
  const res = await fetchWithTimeout(url, 8000, {
    "User-Agent": `${APP_NAME}-TripPlanner/1.0 (github.com/${APP_REPO})`,
  });
  if (!res.ok) return null;
  const data = (await res.json()) as any[];
  if (!data.length) return null;
  return {
    lat: parseFloat(data[0].lat),
    lng: parseFloat(data[0].lng),
    displayName: data[0].display_name,
  };
}

// ── Overpass: POI search ──────────────────────────────────────────────────────
const OVERPASS = "https://overpass-api.de/api/interperter";

const TAG_QUERIES: Record<string, string> = {
  temple: 'node["amenity"="place_of_worship"]["religion"="buddhist"]',
  museum: 'node["tourism"="museum"]',
  restaurant: 'node["amenity"="restaurant"]',
  hotel: 'node["tourism"="hotel"]',
  guesthouse: 'node["tourism"="guest_house"]',
  viewpoint: 'node["tourism"="viewpoint"]',
  waterfall: 'node["natural"="waterfall"]',
  beach: 'node["natural"="beach"]',
  market: 'node["amenity"="marketplace"]',
  cafe: 'node["amenity"="cafe"]',
  attraction: 'node["tourism"="attraction"]',
};

export async function searchPOI(
  lat: number,
  lng: number,
  tags: string[],
  radiusM: number = 15_000,
  maxResults: number = 12,
): Promise<POI[]> {
  const tagUnions = tags
    .map((t) => TAG_QUERIES[t] ?? `node["tourism"="${t}"]`)
    .map((q) => `${q}(around:${radiusM},${lat},${lng});`)
    .join("\n");

  const query = `[out:json][timeout:20];
    (
    ${tagUnions}
    );
    out body ${maxResults * tags.length};`;

  const res = await fetchWithTimeout(
    OVERPASS,
    20000,
    {},
    "POST",
    `data=${encodeURIComponent(query)}`,
  );
  if (!res.ok) return [];
  const data: any = await res.json();

  const seen = new Set<string>();
  const results: POI[] = [];

  for (const el of data.elements ?? []) {
    const name = el.tags?.name ?? el.tags?.["name:en"] ?? el.tags?.["name:th"];
    if (!name) continue;
    const key = `${name}:${el.lat}:${el.lon}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const type =
      Object.keys(el.tags ?? {}).find((k) =>
        ["tourism", "amenity", "natural", "shop"].includes(k),
      ) ?? "place";
    const tag = el.tags?.[type] ?? "attraction";

    results.push({
      id: el.id,
      name,
      type,
      tag,
      lat: el.lat,
      lng: el.lon,
      address: el.tags?.["addr:full"] ?? el.tags?.["addr:street"],
    });

    if (results.length >= maxResults) break;
  }

  return results;
}

// ── OSRM: route distances + durations ────────────────────────────────────────

const OSRM = "https://router.project-osrm.org/table/v1/driving";

export async function routeDistances(
  points: Array<{ name: string; lat: number; lng: number }>,
): Promise<RouteSegment[]> {
  if (points.length < 2) return [];

  const coords = points.map((p) => `${p.lng},${p.lat}`).join(";");
  const url = `${OSRM}/${coords}?sources=all&destinations=all&annotations=duration,distance`;

  const res = await fetchWithTimeout(url, 10000);
  if (!res.ok) return buildFallbackSegments(points);

  const data: any = await res.json();
  const durationMatrix: number[][] = data.durations ?? [];
  const distanceMatrix: number[][] = data.distances ?? [];

  const segments: RouteSegment[] = [];
  for (let i = 0; i < points.length; i++) {
    const distM = distanceMatrix[i]?.[i + 1] ?? 0;
    const durS = durationMatrix[i]?.[i + 1] ?? 0;
    segments.push({
      from: points[i].name,
      to: points[i + 1].name,
      distanceKm: Math.round((distM / 1000) * 10) / 10,
      durationMin: Math.round(durS / 60),
    });
  }
  return segments;
}

function buildFallbackSegments(
  points: Array<{ name: string; lat: number; lng: number }>,
): RouteSegment[] {
  const segments: RouteSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const d = haversineKm(points[i], points[i + 1]);
    segments.push({
      from: points[i].name,
      to: points[i + 1].name,
      distanceKm: Math.round(d * 10) / 10,
      durationMin: Math.round((d / 60) * 60), // ~60 km/h
    });
  }
  return segments;
}

function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// ── Open-Meteo: weather forecast ──────────────────────────────────────────────

const WEATHER_CODES: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  71: "Slight snow",
  73: "Moderate snow",
  75: "Heavy snow",
  80: "Rain showers",
  81: "Moderate showers",
  82: "Violent showers",
  95: "Thunderstorm",
};

export async function fetchWeatherForecast(
  lat: number,
  lng: number,
  days = 3,
): Promise<TripWeather[]> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    daily: "temperature_2m_max,temperature_2m_min,weather_code",
    forecast_days: String(Math.min(days, 16)),
    timezone: "auto",
  });
  const res = await fetchWithTimeout(
    `https://api.open-meteo.com/v1/forecast?${params}`,
    8000,
  );
  if (!res.ok) return [];
  const data: any = await res.json();
  return (data.daily?.time ?? []).map((date: string, i: number) => ({
    date,
    maxC: Math.round(data.daily.temperature_2m_max[i] ?? 30),
    minC: Math.round(data.daily.temperature_2m_min[i] ?? 22),
    weatherCode: data.daily.weather_code[i] ?? 0,
    description: WEATHER_CODES[data.daily.weather_code[i]] ?? "Unknown",
  }));
}

// ── GeoJSON builder ───────────────────────────────────────────────────────────

export function buildGeoJSON(pois: POI[], origin: GeoPoint): object {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [origin.lng, origin.lat] },
        properties: { name: origin.displayName.split(",")[0], type: "origin" },
      },
      ...pois.map((p) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.lng, p.lat] },
        properties: {
          name: p.name,
          type: p.type,
          tag: p.tag,
          address: p.address,
        },
      })),
    ],
  };
}

// ── POI deduplication ─────────────────────────────────────────────────────────

export function deduplicatePOIs(pois: POI[], maxCount: number): POI[] {
  const seen = new Set<string>();
  const result: POI[] = [];

  for (const p of pois) {
    // Normalise name for dedup
    const key = p.name.toLocaleLowerCase().replace(/\s+/g, "");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(p);
    if (result.length >= maxCount) break;
  }

  return result;
}

// ── Fetch helper ──────────────────────────────────────────────────────────────
async function fetchWithTimeout(
  url: string,
  ms: number = 5000,
  headers: Record<string, string> = {},
  method: "GET" | "POST" = "GET",
  body?: string,
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...headers,
      },
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(id);
  }
}

export type { POI, GeoPoint, RouteSegment, TripWeather };
