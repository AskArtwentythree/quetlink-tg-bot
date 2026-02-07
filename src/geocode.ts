/**
 * Локальное обратное геокодирование по координатам.
 * Для России: приоритетно russian-cities_with_english.json (русские названия, много городов).
 * Для остального мира: cities5000.txt (все города из файла, не только крупные).
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

interface RussianCityPoint {
  name: string;
  lat: number;
  lon: number;
}

const EARTH_RADIUS_KM = 6371;
const GRID_CELL_SIZE = 1.0;
/** Максимальная дистанция (км), чтобы считать точку «в этом городе» для России */
const MAX_RU_MATCH_KM = 80;
/** Примерные границы России для быстрой проверки (широта, долгота) */
const RU_BBOX = { latMin: 41, latMax: 82, lonMin: 19, lonMax: 180 };

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
  if (parts.length < 15) return null;
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

function inRussiaBbox(lat: number, lon: number): boolean {
  return (
    lat >= RU_BBOX.latMin &&
    lat <= RU_BBOX.latMax &&
    lon >= RU_BBOX.lonMin &&
    lon <= RU_BBOX.lonMax
  );
}

interface CityGridIndex {
  grid: Map<string, CityData[]>;
  cities: CityData[];
  isReady: boolean;
}

interface RussianGeoIndex {
  grid: Map<string, RussianCityPoint[]>;
  cities: RussianCityPoint[];
  isReady: boolean;
}

let cityIndex: CityGridIndex | null = null;
let russianGeoIndex: RussianGeoIndex | null = null;
let loadPromise: Promise<void> | null = null;
let russianNamesMap: Map<string, string> | null = null;

async function loadRussianGeo(): Promise<RussianGeoIndex> {
  if (russianGeoIndex?.isReady) return russianGeoIndex;
  const jsonPath = join(DATA_DIR, "russian-cities_with_english.json");
  const content = await fs.readFile(jsonPath, "utf-8");
  const raw = JSON.parse(content) as Array<{
    name: string;
    english_name?: string;
    coords?: { lat: string; lon: string };
  }>;
  const cities: RussianCityPoint[] = [];
  const grid = new Map<string, RussianCityPoint[]>();

  for (const c of raw) {
    const latStr = c.coords?.lat;
    const lonStr = c.coords?.lon;
    if (!c.name?.trim() || latStr == null || lonStr == null) continue;
    const lat = parseFloat(latStr);
    const lon = parseFloat(lonStr);
    if (Number.isNaN(lat) || Number.isNaN(lon)) continue;
    const point: RussianCityPoint = { name: c.name.trim(), lat, lon };
    cities.push(point);
    const key = getGridKey(lat, lon);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key)!.push(point);
  }

  russianGeoIndex = { grid, cities, isReady: true };
  return russianGeoIndex;
}

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
  if (loadPromise) {
    await loadPromise;
    return cityIndex!;
  }

  loadPromise = (async () => {
    await loadRussianGeo();
    const filePath = join(DATA_DIR, "data_geo", "cities5000.txt");
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.split("\n");
    const cities: CityData[] = [];
    const grid = new Map<string, CityData[]>();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const city = parseCityLine(trimmed);
      if (city) {
        cities.push(city);
        const key = getGridKey(city.lat, city.lon);
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key)!.push(city);
      }
    }

    await loadRussianNamesMap();
    cityIndex = { grid, cities, isReady: true };
  })();

  await loadPromise;
  return cityIndex!;
}

/**
 * Ищет ближайший город в российском индексе в пределах MAX_RU_MATCH_KM.
 */
function findNearestRussianCity(
  ruIndex: RussianGeoIndex,
  lat: number,
  lon: number
): { name: string; distance: number } | null {
  const keys = getNeighborGridKeys(lat, lon);
  const candidates: RussianCityPoint[] = [];
  for (const key of keys) {
    const list = ruIndex.grid.get(key);
    if (list) candidates.push(...list);
  }
  const toCheck = candidates.length > 0 ? candidates : ruIndex.cities;

  let nearest: RussianCityPoint | null = null;
  let minDist = Infinity;
  for (const c of toCheck) {
    const d = haversineDistance(lat, lon, c.lat, c.lon);
    if (d < minDist) {
      minDist = d;
      nearest = c;
    }
  }
  if (!nearest || minDist > MAX_RU_MATCH_KM) return null;
  return { name: nearest.name, distance: minDist };
}

/**
 * По координатам возвращает строку для отображения: "г. Город, Страна".
 * Для России сначала ищет в russian-cities (русское название); иначе cities5000 + перевод по имени.
 */
export async function reverseGeocodeDisplay(
  lat: number,
  lon: number
): Promise<string | null> {
  await loadCitiesAsync();

  if (inRussiaBbox(lat, lon) && russianGeoIndex) {
    const ru = findNearestRussianCity(russianGeoIndex, lat, lon);
    if (ru) return `г. ${ru.name}, Россия`;
  }

  const index = cityIndex!;
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
