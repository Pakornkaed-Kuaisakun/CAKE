// Trip planning helpers: input parsing, budget estimation, itinerary formatting
import type { TripInput, DayPlan, TripPlan, BudgetBreakdown } from "./types.js";

// ── Input parser ──────────────────────────────────────────────────────────────
// Parses natural-language trip requests (Thai + English)
const INTEREST_KEYWORDS: Record<string, string[]> = {
  temple: ["วัด", "temple", "wat", "พระธาตุ"],
  museum: ["พิพิธภัณฑ์", "museum"],
  restaurant: ["ร้านอาหาร", "กิน", "อาหาร", "food", "eat", "restaurant"],
  cafe: ["คาเฟ่", "กาแฟ", "cafe", "coffee"],
  market: ["ตลาด", "market", "ช้อปปิ้ง", "shopping"],
  viewpoint: ["วิวทิวทัศน์", "view", "จุดชมวิว", "viewpoint", "ดอย"],
  waterfall: ["น้ำตก", "waterfall"],
  beach: ["ทะเล", "หาด", "beach", "sea"],
  attraction: ["ท่องเที่ยว", "สถานที่", "สวน", "park"],
  guesthouse: ["โรงแรม", "ที่พัก", "hotel", "hostel"],
};

const ACCOMMODATION_KEYWORDS = {
  budget: ["ราคาถูก", "budget", "ประหยัด", "hostel", "cheap"],
  luxury: ["หรู", "luxury", "5 ดาว", "resort", "high-end"],
};

export function parseTripInput(raw: string): TripInput {
  const lower = raw.toLowerCase();

  // Destination: Thai provinces / cities  (simple extraction)
  const destPatterns = [
    /(?:ไป|plan.*to|trip.*to|visit|เที่ยว)\s+([ก-๙a-zA-Z\s]+?)(?:\s+\d|\s+วัน|,|$)/i,
    /([ก-๙a-zA-Z]+(?:\s[ก-๙a-zA-Z]+)?)\s+(?:\d+\s*วัน|\d+\s*day)/i,
  ];
  let destination = "เชียงใหม่"; // sensible default
  for (const p of destPatterns) {
    const m: any = raw.match(p);
    if (m?.[1]?.trim().length > 1) {
      destination = m[1].trim();
      break;
    }
  }

  // Days/nights
  const dayMatch = raw.match(/(\d+)\s*(?:วัน|day)/i);
  const nightMatch = raw.match(/(\d+)\s*(?:คืน|night)/i);
  const days = dayMatch ? parseInt(dayMatch[1]) : 3;
  const nights = nightMatch ? parseInt(nightMatch[1]) : Math.max(1, days - 1);

  // Budget (THB)
  const budgetMatch =
    raw.match(/(?:งบ|budget|฿|baht)\s*[\s:]?\s*([\d,]+)/i) ??
    raw.match(/([\d,]+)\s*(?:บาท|baht|฿)/i);
  const budget = budgetMatch
    ? parseInt(budgetMatch[1].replace(/,/g, ""))
    : days * 2000;

  // Travelers
  const travMatch = raw.match(/(\d+)\s*(?:คน|person|people|pax|traveler)/i);
  const travelers = travMatch ? parseInt(travMatch[1]) : 1;

  // Interests from keywords
  const interests: string[] = [];
  for (const [interest, kws] of Object.entries(INTEREST_KEYWORDS)) {
    if (kws.some((kw) => lower.includes(kw.toLowerCase()))) {
      interests.push(interest);
    }
  }
  if (interests.length === 0)
    interests.push("temple", "restaurant", "attraction");

  // Accommodation tier
  let accommodation: "budget" | "mid" | "luxury" = "mid";
  if (ACCOMMODATION_KEYWORDS.budget.some((k) => lower.includes(k)))
    accommodation = "budget";
  else if (ACCOMMODATION_KEYWORDS.luxury.some((k) => lower.includes(k)))
    accommodation = "luxury";

  return {
    destination,
    days,
    nights,
    budget,
    travelers,
    interests,
    accommodation,
  };
}

// ── Budget calculator ─────────────────────────────────────────────────────────

const ACCOMMODATION_COST_PER_NIGHT: Record<string, number> = {
  budget: 400,
  mid: 1200,
  luxury: 3500,
};

const FOOD_COST_PER_PERSON_PER_DAY: Record<string, number> = {
  budget: 250,
  mid: 500,
  luxury: 1200,
};

export function calculateBudget(input: TripInput): BudgetBreakdown {
  const { days, nights, budget, travelers, accommodation } = input;

  const accPerNight = ACCOMMODATION_COST_PER_NIGHT[accommodation];
  const accTotal = accPerNight * nights;

  const foodPerDay = FOOD_COST_PER_PERSON_PER_DAY[accommodation];
  const foodTotal = foodPerDay * days * travelers;

  const transportTotal = Math.round(budget * 0.2);
  const activitiesTotal = Math.round(budget * 0.15);
  const shoppingTotal = Math.round(budget * 0.1);
  const contingency = Math.round(budget * 0.05);

  const total =
    accTotal +
    foodTotal +
    transportTotal +
    activitiesTotal +
    shoppingTotal +
    contingency;

  return {
    accommodation: accTotal,
    food: foodTotal,
    transport: transportTotal,
    activities: activitiesTotal,
    shopping: shoppingTotal,
    contingency,
    total,
    perPersonPerDay: Math.round(total / travelers / days),
  };
}

// ── POI tag extractor ─────────────────────────────────────────────────────────

export function interestsToTags(interests: string[]): string[] {
  const valid = new Set([
    "temple",
    "museum",
    "restaurant",
    "cafe",
    "market",
    "viewpoint",
    "waterfall",
    "beach",
    "attraction",
    "guesthouse",
    "hotel",
  ]);
  const tags = interests.filter((i) => valid.has(i));
  if (!tags.includes("restaurant")) tags.push("restaurant");
  if (!tags.includes("attraction") && !tags.includes("temple"))
    tags.push("attraction");
  return [...new Set(tags)];
}

// ── Itinerary formatter ───────────────────────────────────────────────────────

export function formatItinerary(plan: TripPlan): string {
  const { input, budgetBreakdown: bb, days, weather, routes, tips } = plan;
  const lines: string[] = [];

  lines.push(
    `# 🗺️ Trip Plan ${plan.destination} ${input.days} days ${input.nights} nights`,
  );
  lines.push(
    `**Total Budget:** ฿${bb.total.toLocaleString()} | **Per Person Per Day:** ฿${bb.perPersonPerDay.toLocaleString()}`,
  );
  lines.push("");

  // Budget breakdown
  lines.push("## 💰 Budget Summary");
  lines.push(`| Item | ฿ |`);
  lines.push(`|--------|---|`);
  lines.push(
    `| Accommodation (${input.nights} nights) | ${bb.accommodation.toLocaleString()} |`,
  );
  lines.push(`| Food | ${bb.food.toLocaleString()} |`);
  lines.push(`| Transport | ${bb.transport.toLocaleString()} |`);
  lines.push(`| Activities | ${bb.activities.toLocaleString()} |`);
  lines.push(`| Shopping | ${bb.shopping.toLocaleString()} |`);
  lines.push(`| Contingency | ${bb.contingency.toLocaleString()} |`);
  lines.push(`| **Total** | **${bb.total.toLocaleString()}** |`);
  lines.push("");

  // Weather
  if (weather.length > 0) {
    lines.push("## 🌤️ Weather Forecast");
    weather.slice(0, input.days).forEach((w) => {
      lines.push(`- **${w.date}**: ${w.description} ${w.minC}–${w.maxC}°C`);
    });
    lines.push("");
  }

  // Day-by-day
  days.forEach((d) => {
    lines.push(`## Day ${d.day}${d.date ? ` (${d.date})` : ""} — ${d.theme}`);
    lines.push("");
    if (d.morning.length)
      lines.push(`**🌅 Morning:** ${d.morning.join(" → ")}`);
    if (d.afternoon.length)
      lines.push(`**☀️ Afternoon:** ${d.afternoon.join(" → ")}`);
    if (d.evening.length)
      lines.push(`**🌆 Evening/Night:** ${d.evening.join(" → ")}`);
    lines.push("");
    const meals = Object.entries(d.meals)
      .filter(([, v]) => v)
      .map(
        ([k, v]) =>
          `${k === "breakfast" ? "Breakfast" : k === "lunch" ? "Lunch" : "Dinner"}: ${v}`,
      )
      .join(" | ");
    if (meals) lines.push(`🍽️ ${meals}`);
    lines.push(`💸 Estimated cost today: ฿${d.estimatedCost.toLocaleString()}`);
    if (d.travelNotes) lines.push(`🚗 ${d.travelNotes}`);
    lines.push("");
  });

  // Routes summary
  if (routes.length > 0) {
    lines.push("## 🚗 Distance between places");
    routes.forEach((r) => {
      lines.push(
        `- ${r.from} → ${r.to}: ${r.distanceKm} km (~${r.durationMin} minutes)`,
      );
    });
    lines.push("");
  }

  // Tips
  if (tips.length > 0) {
    lines.push("## 💡 Tips");
    tips.forEach((t) => lines.push(`- ${t}`));
  }

  return lines.join("\n");
}

// ── Default tips by destination ───────────────────────────────────────────────

export function generateTips(input: TripInput): string[] {
  const tips: string[] = [
    "Bring drinking water and sunscreen throughout the trip",
    "Cash payment is more convenient than cards in local stores",
    "Book accommodation in advance during festivals",
  ];

  if (input.accommodation === "budget") {
    tips.push("Choose hostels or guesthouses to save on accommodation costs");
  }
  if (input.interests.includes("temple")) {
    tips.push(
      "Dress modestly when entering temples — no shorts or sleeveless shirts",
    );
  }
  if (input.interests.includes("market")) {
    tips.push("Markets are open early morning 6-9 AM, good for fresh produce");
  }
  if (input.days >= 3) {
    tips.push("Rent a scooter or car to save travel time");
  }

  return tips;
}

export type { TripInput, DayPlan, TripPlan, BudgetBreakdown };
