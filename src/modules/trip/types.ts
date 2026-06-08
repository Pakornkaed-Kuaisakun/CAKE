export interface TripInput {
  destination: string;
  days: number;
  nights: number;
  budget: number; // THB Total
  travelers: number;
  interests: string[]; // e.g. ["temple", "food", "nature"]
  accommodation: "budget" | "mid" | "luxury";
}

export interface DayPlan {
  day: number;
  date?: string;
  theme: string;
  morning: string[];
  afternoon: string[];
  evening: string[];
  meals: { breakfast?: string; lunch?: string; dinner?: string };
  estimatedCost: number;
  travelNotes?: string;
}

export interface TripPlan {
  input: TripInput;
  destination: string;
  totalDays: number;
  totalBudget: number;
  budgetBreakdown: BudgetBreakdown;
  days: DayPlan[];
  pois: import("../maps/types.js").POI[];
  routes: import("../maps/types.js").RouteSegment[];
  weather: import("../maps/types.js").TripWeather[];
  geoJSON: object;
  tips: string[];
}

export interface BudgetBreakdown {
  accommodation: number;
  food: number;
  transport: number;
  activities: number;
  shopping: number;
  contingency: number;
  total: number;
  perPersonPerDay: number;
}
