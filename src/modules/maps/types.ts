export interface GeoPoint {
    lat: number;
    lng: number;
    displayName: string;
}

export interface POI {
    id: number;
    name: string;       // "tourism", "amenity", "shop", etc.
    type: string;       // e.g. "temple", "restaurant", "hotel"
    tag: string;
    lat: number;
    lng: number;
    address?: string;
}

export interface RouteSegment {
    from: string;
    to: string;
    distanceKm: number;
    durationMin: number;
}

export interface TripWeather {
    date: string;       // ISO date string
    maxC: number;
    minC: number;
    weatherCode: number;
    description: string;
}