/**
 * Локальное обратное геокодирование — та же логика, что в миниаппе (geocode-local.ts).
 * Координаты → ближайший крупный город и страна по данным cities5000.txt.
 */

import { promises as fs } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { CODE_TO_COUNTRY_NAME } from "./country-codes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");

interface CityData {
  name: string;
  lat: number;
  lon: number;
  countryCode: string;
  population: number;
  featureCode: string;
}

const MIN_POPULATION = 500_000;
const MAJOR_CITY_FEATURE_CODES = new Set(["PPLC", "PPLA"]);
const EARTH_RADIUS_KM = 6371;
const GRID_CELL_SIZE = 1.0;

function isLargeCity(city: CityData): boolean {
  if (city.population >= MIN_POPULATION) return true;
  if (MAJOR_CITY_FEATURE_CODES.has(city.featureCode)) return true;
  return false;
}

function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

function parseCityLine(line: string): CityData | null {
  const parts = line.split("\t");
  if (parts.length < 9) return null;
  const name = parts[1]?.trim();
  const latStr = parts[4]?.trim();
  const lonStr = parts[5]?.trim();
  const featureCode = (parts[7]?.trim() ?? "").toUpperCase();
  const countryCode = parts[8]?.trim()?.toUpperCase();
  const populationStr = parts[14]?.trim();
  const population = populationStr ? parseInt(populationStr, 10) : 0;
  const populationNum = Number.isNaN(population) ? 0 : Math.max(0, population);
  if (!name || !latStr || !lonStr || !countryCode) return null;
  const lat = parseFloat(latStr);
  const lon = parseFloat(lonStr);
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
  return {
    name,
    lat,
    lon,
    countryCode,
    population: populationNum,
    featureCode,
  };
}

function getGridKey(lat: number, lon: number): string {
  const latCell = Math.floor(lat / GRID_CELL_SIZE);
  const lonCell = Math.floor(lon / GRID_CELL_SIZE);
  return `${latCell},${lonCell}`;
}

function getNeighborGridKeys(lat: number, lon: number): string[] {
  const latCell = Math.floor(lat / GRID_CELL_SIZE);
  const lonCell = Math.floor(lon / GRID_CELL_SIZE);
  const keys: string[] = [];
  for (let dLat = -1; dLat <= 1; dLat++) {
    for (let dLon = -1; dLon <= 1; dLon++) {
      keys.push(`${latCell + dLat},${lonCell + dLon}`);
    }
  }
  return keys;
}

interface CityGridIndex {
  grid: Map<string, CityData[]>;
  cities: CityData[];
  isReady: boolean;
}

let cityIndex: CityGridIndex | null = null;
let loadPromise: Promise<CityGridIndex> | null = null;
let russianNamesMap: Map<string, string> | null = null;

async function loadRussianNamesMap(): Promise<Map<string, string>> {
  if (russianNamesMap) return russianNamesMap;
  const jsonPath = join(DATA_DIR, "russian-cities_with_english.json");
  const content = await fs.readFile(jsonPath, "utf-8");
  const cities = JSON.parse(content) as Array<{
    name: string;
    english_name?: string;
  }>;
  const map = new Map<string, string>();
  for (const c of cities) {
    if (c.name === "Донецк" || !c.english_name?.trim()) continue;
    map.set(c.english_name.trim().toLowerCase(), c.name);
  }
  russianNamesMap = map;
  return map;
}

async function loadCitiesAsync(): Promise<CityGridIndex> {
  if (cityIndex?.isReady) return cityIndex;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const filePath = join(DATA_DIR, "data_geo", "cities5000.txt");
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.split("\n");
    const cities: CityData[] = [];
    const grid = new Map<string, CityData[]>();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const city = parseCityLine(trimmed);
      if (city && isLargeCity(city)) {
        cities.push(city);
        const key = getGridKey(city.lat, city.lon);
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key)!.push(city);
      }
    }

    await loadRussianNamesMap();

    cityIndex = { grid, cities, isReady: true };
    return cityIndex;
  })();

  return loadPromise;
}

/**
 * Находит ближайший город к координатам (как в миниаппе).
 * Возвращает строку для отображения: "г. Город, Страна".
 */
export async function reverseGeocodeDisplay(
  lat: number,
  lon: number
): Promise<string | null> {
  const index = await loadCitiesAsync();
  if (index.cities.length === 0) return null;

  const neighborKeys = getNeighborGridKeys(lat, lon);
  const candidates: CityData[] = [];
  for (const key of neighborKeys) {
    const citiesInCell = index.grid.get(key);
    if (citiesInCell) candidates.push(...citiesInCell);
  }
  const citiesToCheck = candidates.length > 0 ? candidates : index.cities;

  let nearestCity: CityData | null = null;
  let minDistance = Infinity;
  for (const city of citiesToCheck) {
    const distance = haversineDistance(lat, lon, city.lat, city.lon);
    if (distance < minDistance) {
      minDistance = distance;
      nearestCity = city;
    }
  }

  if (!nearestCity) return null;

  const countryName =
    CODE_TO_COUNTRY_NAME[nearestCity.countryCode] ?? nearestCity.countryCode;
  let displayCity = nearestCity.name;
  if (nearestCity.countryCode === "RU" && russianNamesMap) {
    const ru = russianNamesMap.get(nearestCity.name.toLowerCase());
    if (ru) displayCity = ru;
  }

  if (displayCity && countryName) return `г. ${displayCity}, ${countryName}`;
  if (displayCity) return `г. ${displayCity}`;
  if (countryName) return countryName;
  return null;
}
