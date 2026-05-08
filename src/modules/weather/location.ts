import { GeoResult } from "./types.js";

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const num = Number.parseFloat(value);

    if (Number.isFinite(num)) {
      return num;
    }
  }

  return null;
}

export async function detectLocationFromIP(): Promise<GeoResult> {
  const providers = [
    /**
     * ipwho.is
     */

    async (): Promise<GeoResult | null> => {
      const res = await fetch("https://ipwho.is/");

      if (!res.ok) {
        return null;
      }

      const data = (await res.json()) as Record<string, unknown>;

      const latitude = asNumber(data.latitude);

      const longitude = asNumber(data.longitude);

      if (latitude == null || longitude == null) {
        return null;
      }

      return {
        latitude,
        longitude,

        city: typeof data.city === "string" ? data.city : undefined,

        region: typeof data.region === "string" ? data.region : undefined,

        country_name:
          typeof data.country === "string" ? data.country : undefined,
      };
    },

    /**
     * ipinfo.io
     */

    async (): Promise<GeoResult | null> => {
      const res = await fetch("https://ipinfo.io/json");

      if (!res.ok) {
        return null;
      }

      const data = (await res.json()) as Record<string, unknown>;

      if (typeof data.loc !== "string") {
        return null;
      }

      const [lat, lon] = data.loc.split(",");

      const latitude = asNumber(lat);

      const longitude = asNumber(lon);

      if (latitude == null || longitude == null) {
        return null;
      }

      return {
        latitude,
        longitude,

        city: typeof data.city === "string" ? data.city : undefined,

        region: typeof data.region === "string" ? data.region : undefined,

        country_name:
          typeof data.country === "string" ? data.country : undefined,
      };
    },
  ];

  for (const provider of providers) {
    try {
      const result = await provider();

      if (result) {
        return result;
      }
    } catch {
      continue;
    }
  }

  /**
   * fallback
   */

  // return {
  //   latitude: 13.7563,
  //   longitude: 100.5018,
  //   city: "Bangkok",
  //   region: "Bangkok",
  //   country_name: "Thailand",
  // };
  throw new Error("Location detection failed");
}
