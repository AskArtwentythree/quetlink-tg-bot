/**
 * Праздники по дате (MM-DD). Используется на шаге «Какой повод?».
 */

import holidaysByDate from "./holidays.json";

const HOLIDAYS = holidaysByDate as Record<string, string[]>;

function formatMonthDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}-${day}`;
}

/** Возвращает праздники на указанную дату (месяц-день). Ключ в формате MM-DD. */
function getHolidaysForDate(monthDay: string): string[] {
  return HOLIDAYS[monthDay] ?? [];
}

/** Праздники на сегодня (по локальной дате пользователя). */
export function getHolidaysForToday(): string[] {
  const now = new Date();
  return getHolidaysForDate(formatMonthDay(now));
}

/**
 * Собирает праздники начиная с переданной даты и с последующих дней,
 * пока не наберётся minCount названий или не пройдёт maxDaysAhead дней.
 * Без дубликатов.
 */
export function getHolidaysAggregated(
  fromDate: Date,
  minCount: number = 6,
  maxDaysAhead: number = 14,
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (let d = 0; d < maxDaysAhead; d++) {
    const date = new Date(fromDate);
    date.setDate(date.getDate() + d);
    const key = formatMonthDay(date);
    const list = getHolidaysForDate(key) ?? [];

    for (const name of list) {
      if (!seen.has(name)) {
        seen.add(name);
        result.push(name);
      }
    }

    if (result.length >= minCount) break;
  }

  return result;
}

/** Все уникальные названия праздников из календаря (для случайной выборки). */
let allHolidaysCache: string[] | null = null;

function getAllHolidayNames(): string[] {
  if (allHolidaysCache) return allHolidaysCache;
  const seen = new Set<string>();
  for (const list of Object.values(HOLIDAYS)) {
    for (const name of list) {
      if (name?.trim()) seen.add(name.trim());
    }
  }
  allHolidaysCache = [...seen];
  return allHolidaysCache;
}

/** Fisher–Yates shuffle (на месте), возвращает тот же массив. */
function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Возвращает count случайных праздников из всего календаря (без повторов).
 * При каждом вызове — новая случайная выборка.
 */
export function getRandomHolidays(count: number = 12): string[] {
  const all = getAllHolidayNames();
  if (all.length <= count) return shuffleInPlace([...all]);
  const shuffled = shuffleInPlace([...all]);
  return shuffled.slice(0, count);
}
