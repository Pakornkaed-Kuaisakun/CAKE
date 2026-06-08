// handleTripPlan() — the main orchestrator for the CAKE Trip Planner feature.
//
// Flow (mirrors the architecture SVG):
//   1. Parse natural-language input (Thai / English)
//   2. Geocoder   → Nominatim/OSM (name → lat/lng)
//   3. POI search → Overpass API  (places by tag)
//   4. Route plan → OSRM          (order + distances)
//   5. Budget     → calculateBudget()
//   6. AI synth   → Claude builds day-by-day itinerary
//   7. Export     → itinerary text + GeoJSON map + Markdown file

import type { AIProvider, ChatResult } from "../../providers/types.js";
import type { RunOptions } from "../index.js";
import {
  geocode,
  searchPOI,
  routeDistances,
  fetchWeatherForecast,
  buildGeoJSON,
  deduplicatePOIs,
  type POI,
  type GeoPoint,
} from "../../modules/maps/index.js";
import {
  parseTripInput,
  calculateBudget,
  interestsToTags,
  formatItinerary,
  generateTips,
  type TripInput,
  type TripPlan,
  type DayPlan,
} from "../../modules/trip/index.js";
import { exportSink } from "./export.js";
import { formatChatResult } from "../../shared/utils/utils.js";

const SEP = "─".repeat(60);

// ── Main handler ──────────────────────────────────────────────────────────────

export async function handleTripPlan(
  provider: AIProvider,
  input: string,
  model?: string,
  options?: RunOptions,
): Promise<ChatResult> {
  const emit = (msg: string) => options?.onChunk?.(msg);

  emit(`[TRIP PLANNER] 🗺️ Travel Planning...\n${SEP}\n`);

  // ── Step 1: Parse intent ──────────────────────────────────────────────────
  const tripInput = parseTripInput(input);
  emit(
    `Destination: ${tripInput.destination}\n` +
      `Days: ${tripInput.days} Nights: ${tripInput.nights} | Travelers: ${tripInput.travelers}\n` +
      `Budget: ${tripInput.budget} | Accommodation: ${tripInput.accommodation}\n` +
      `Interests: ${tripInput.interests.join(", ")}\n\n`,
  );

  // ── Step 2: Geocode destination ─────────────────────────────────────────────────────────
  emit(`Searching for "${tripInput.destination}"...\n`);
  const origin = await geocode(tripInput.destination);
  if (!origin) {
    return formatChatResult(
      "❌ Location not found" +
        `Could not find coordinates for "${tripInput.destination}". Please try another spelling or check your input.`,
    );
  }
  emit(
    `✅ Found at ${origin.displayName.split(",").slice(0, 2).join(",")} (${origin.lat.toFixed(4)}, ${origin.lng.toFixed(4)})\n`,
  );

  // ── Step 3: POI Search ─────────────────────────────────────────────────────────
  const tags = interestsToTags(tripInput.interests);
  emit(`🏛️ Attraction search: (${tags.join(", ")})...\n`);

  const poisRaw = await searchPOI(origin.lat, origin.lng, tags, 20000, 20);
  // De-dup by name proximity and keep top results
  const pois = deduplicatePOIs(poisRaw, 15);
  emit(`✅ Places found: ${pois.length}\n`);

  // ── Step 4: Route distances ───────────────────────────────────────────────
  emit(`🚗 Calculating routes...\n`);
  const routePoints = [
    { name: tripInput.destination, lat: origin.lat, lng: origin.lng },
    ...pois.slice(0, 8).map((p) => ({ name: p.name, lat: p.lat, lng: p.lng })),
  ];

  const routes = await routeDistances(routePoints);
  emit(`✅ Calculated ${routes.length} routes\n\n`);

  // ── Step 5: Weather ───────────────────────────────────────────────────────
  emit(`🌤️ Fetching Weather...\n`);
  const weather = await fetchWeatherForecast(
    origin.lat,
    origin.lng,
    tripInput.days,
  );
  emit(`✅ Fetched ${weather.length} days weather forecast.\n`);

  // ── Step 6: Budget calculation ────────────────────────────────────────────
  const budget = calculateBudget(tripInput);
  emit(
    `💰 Budget Summary:\n` +
      `  Accommodation: ${budget.accommodation.toLocaleString()} THB | Food: ${budget.food.toLocaleString()} THB\n` +
      `  Transport: ${budget.transport.toLocaleString()} THB | Activities: ${budget.activities.toLocaleString()} THB\n` +
      `  Total: ${budget.total.toLocaleString()} THB (~${budget.perPersonPerDay.toLocaleString()} THB/person/day)\n\n`,
  );

  // ── Step 7: AI synthesis ──────────────────────────────────────────────────
  emit(`🤖 Creating travel itinerary...\n`);
  const days = await synthesizeItinerary(
    provider,
    tripInput,
    pois,
    budget,
    weather,
    model,
  );

  // ── Build GeoJSON ─────────────────────────────────────────────────────────
  const geoJSON = buildGeoJSON(pois, origin);
  const tips = generateTips(tripInput);

  const plan: TripPlan = {
    input: tripInput,
    destination: origin.displayName.split(",")[0],
    totalDays: tripInput.days,
    totalBudget: budget.total,
    budgetBreakdown: budget,
    days,
    pois,
    routes,
    weather,
    geoJSON,
    tips,
  };

  // ── Format & export ───────────────────────────────────────────────────────
  const markdown = formatItinerary(plan);
  const timestamp = Date.now();
  const slug = tripInput.destination.replace(/\s+/g, "_").replace(/[^\w]/g, "");

  // Export Markdown itinerary
  const mdResult = await exportSink(
    markdown,
    "trip_plan",
    `md trip_${slug}_${timestamp}.md`,
  );
  emit(`\n📄 ${mdResult.text}\n`);

  // Export GeoJSON map
  const geoJsonStr = JSON.stringify(geoJSON, null, 2);
  const geoResult = await exportSink(
    geoJsonStr,
    "trip_plan",
    `json map_${slug}_${timestamp}.json`,
  );
  emit(`🗺️  ${geoResult.text}\n`);

  emit(`\n${SEP}\n✅ Planning completed!\n`);

  return formatChatResult(markdown);
}

// ── AI itinerary synthesis ────────────────────────────────────────────────────

async function synthesizeItinerary(
  provider: AIProvider,
  input: TripInput,
  pois: POI[],
  budget: import("../../modules/trip/index.js").BudgetBreakdown,
  weather: import("../../modules/maps/types.js").TripWeather[],
  model?: string,
): Promise<DayPlan[]> {
  const poiList = pois
    .slice(0, 12)
    .map((p, i) => `${i + 1}. ${p.name} (${p.tag})`)
    .join("\n");

  const weatherSummary = weather
    .slice(0, input.days)
    .map((w, i) => `Day ${i + 1}: ${w.description} ${w.minC}–${w.maxC}°C`)
    .join(", ");

  const dailyCost = Math.round(budget.total / input.days);

  const systemPrompt = `You are an expert Thai travel planner. 
  You speak both Thai and English fluently.
  Always respond with a valid JSON array only — no markdown fences, no preamble.`;

  const userPrompt = `Create a ${input.days}-day trip itinerary to ${input.destination}, Thailand.
  
  Travelers: ${input.travelers} person(s)
  Accommodation: ${input.accommodation} tier (${budget.accommodation / input.nights} THB/night)
  Daily budget: ${dailyCost} THB
  Interests: ${input.interests.join(", ")}
  
  Available places (use their exact names):
  ${poiList}
  
  Weather forecast: ${weatherSummary}
  
  Return a JSON array with exactly ${input.days} day objects. Each object must have:
  {
    "day": <number>,
    "theme": "<Thai theme name for this day>",
    "morning": ["<place1>", "<place2>"],
    "afternoon": ["<place3>", "<place4>"],
    "evening": ["<place5 or activity>"],
    "meals": {
      "breakfast": "<local dish or place>",
      "lunch": "<local dish or place>",
      "dinner": "<local dish or place>"
    },
    "estimatedCost": <number in THB>,
    "travelNotes": "<transport tip in Thai>"
  }
  
  Rules:
  - Use actual place names from the list above when possible
  - Distribute POIs across all ${input.days} days logically (geographically close on same day)
  - estimatedCost should total to approximately ${dailyCost} THB
  - travelNotes in Thai, practical and brief
  - theme in Thai (e.g. "วัดและวัฒนธรรม", "ธรรมชาติและวิว")`;

  try {
    const result = await provider.chat(
      [{ role: "user", content: userPrompt }],
      { model, systemPrompt, temperature: 0.6, maxTokens: 2500 },
    );

    const cleaned = result.text.replace(/```json|```/g, "").trim();
    const parsed: any[] = JSON.parse(cleaned);

    return parsed.map((d: any, i: number) => ({
      day: d.day ?? i + 1,
      date: weather[i]?.date,
      theme: d.theme ?? `Day ${i + 1}`,
      morning: Array.isArray(d.morning) ? d.morning : [],
      afternoon: Array.isArray(d.afternoon) ? d.afternoon : [],
      evening: Array.isArray(d.evening) ? d.evening : [],
      meals: d.meals ?? {},
      estimatedCost: d.estimatedCost ?? Math.round(budget.total / input.days),
      travelNotes: d.travelNotes,
    }));
  } catch {
    // Fallback: distribute POIs evenly across days
    return buildFallbackDays(input, pois, budget, weather);
  }
}

function buildFallbackDays(
  input: TripInput,
  pois: POI[],
  budget: import("../../modules/trip/index.js").BudgetBreakdown,
  weather: import("../../modules/maps/types.js").TripWeather[],
): DayPlan[] {
  const perDayCost = Math.round(budget.total / input.days);
  const chunkSize = Math.ceil(pois.length / input.days);

  return Array.from({ length: input.days }, (_, i) => {
    const dayPois = pois.slice(i * chunkSize, (i + 1) * chunkSize);
    const morning = dayPois.slice(0, 2).map((p) => p.name);
    const afternoon = dayPois.slice(2, 4).map((p) => p.name);
    const evening = dayPois.slice(4, 5).map((p) => p.name);

    return {
      day: i + 1,
      date: weather[i]?.date,
      theme: `Day ${i + 1} — ${input.destination}`,
      morning,
      afternoon,
      evening,
      meals: {
        breakfast: "Local breakfast",
        lunch: "Local restaurant",
        dinner: "Local night market",
      },
      estimatedCost: perDayCost,
      travelNotes: "Travel by songthaew or taxi",
    };
  });
}
