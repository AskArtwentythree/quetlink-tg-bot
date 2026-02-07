/**
 * Страны и города: гибридная схема.
 * - Все страны — из файла (COUNTRY_LIST).
 * - Города России — из russian-cities_with_english.json (русские названия для выбора и перевода).
 * - Города остальных стран СНГ — из файла (CITIES_STATIC).
 * - Города всех остальных стран — по API (/api/cities).
 */

import russianCitiesWithEnglish from "./russian-cities_with_english.json";

type RussianCityItemWithEnglish = {
  name: string;
  population: number;
  english_name?: string;
};
/** Города России для ручного выбора (без Донецка), отсортированы по населению */
const russianCityNames: string[] = (
  russianCitiesWithEnglish as RussianCityItemWithEnglish[]
)
  .filter((c) => c.name !== "Донецк")
  .sort((a, b) => b.population - a.population)
  .map((c) => c.name);

/** Код страны ISO 3166-1 alpha-2 */
export type CountryCode = string;

export interface CountryItem {
  /** Название для отображения (рус.) */
  name: string;
  /** Код страны для API */
  code: CountryCode;
}

/** Все страны для селектора */
export const COUNTRY_LIST: CountryItem[] = [
  // Популярные в Telegram
  { name: "Россия", code: "RU" },
  { name: "Беларусь", code: "BY" },
  { name: "Казахстан", code: "KZ" },
  { name: "Украина", code: "UA" },
  { name: "Узбекистан", code: "UZ" },
  { name: "Таджикистан", code: "TJ" },
  { name: "Армения", code: "AM" },
  { name: "Грузия", code: "GE" },
  { name: "Азербайджан", code: "AZ" },
  { name: "Турция", code: "TR" },
  { name: "Германия", code: "DE" },
  { name: "Израиль", code: "IL" },
  { name: "Киргизия", code: "KG" },
  { name: "Молдова", code: "MD" },
  { name: "Латвия", code: "LV" },
  { name: "Литва", code: "LT" },
  { name: "Эстония", code: "EE" },
  { name: "Польша", code: "PL" },
  { name: "Великобритания", code: "GB" },
  { name: "Франция", code: "FR" },
  { name: "Италия", code: "IT" },
  { name: "Испания", code: "ES" },
  { name: "Индия", code: "IN" },
  { name: "Индонезия", code: "ID" },
  { name: "Таиланд", code: "TH" },
  { name: "Вьетнам", code: "VN" },
  { name: "Китай", code: "CN" },
  { name: "Бразилия", code: "BR" },
  { name: "Мексика", code: "MX" },
  { name: "Аргентина", code: "AR" },
  { name: "Колумбия", code: "CO" },
  { name: "Чили", code: "CL" },
  { name: "Перу", code: "PE" },
  { name: "Австралия", code: "AU" },
  { name: "Канада", code: "CA" },
  { name: "США", code: "US" },
  { name: "Нигерия", code: "NG" },
  { name: "Египет", code: "EG" },
  { name: "ЮАР", code: "ZA" },
  { name: "Кения", code: "KE" },
  { name: "Гана", code: "GH" },
  { name: "Танзания", code: "TZ" },
  { name: "Уганда", code: "UG" },
  { name: "Алжир", code: "DZ" },
  { name: "Марокко", code: "MA" },
  { name: "Тунис", code: "TN" },
  { name: "Эфиопия", code: "ET" },
  { name: "Кот-д'Ивуар", code: "CI" },
  { name: "Камерун", code: "CM" },
  { name: "Сенегал", code: "SN" },
  { name: "Мали", code: "ML" },
  { name: "Буркина-Фасо", code: "BF" },
  { name: "Нигер", code: "NE" },
  { name: "Чад", code: "TD" },
  { name: "Судан", code: "SD" },
  { name: "Ангола", code: "AO" },
  { name: "Мозамбик", code: "MZ" },
  { name: "Замбия", code: "ZM" },
  { name: "Зимбабве", code: "ZW" },
  { name: "Ботсвана", code: "BW" },
  { name: "Намибия", code: "NA" },
  { name: "Руанда", code: "RW" },
  { name: "Гвинея", code: "GN" },
  { name: "Бенин", code: "BJ" },
  { name: "Того", code: "TG" },
  { name: "Ливия", code: "LY" },
  { name: "Либерия", code: "LR" },
  { name: "Маврикий", code: "MU" },
  { name: "Мадагаскар", code: "MG" },
  { name: "Конго (ДРК)", code: "CD" },
  { name: "Конго", code: "CG" },
  { name: "Габон", code: "GA" },
  { name: "Экваториальная Гвинея", code: "GQ" },
  { name: "Гамбия", code: "GM" },
  { name: "Сьерра-Леоне", code: "SL" },
  { name: "Малави", code: "MW" },
  { name: "Мавритания", code: "MR" },
  { name: "Сомали", code: "SO" },
  { name: "Джибути", code: "DJ" },
  { name: "Эсватини", code: "SZ" },
  { name: "Центральноафриканская Республика", code: "CF" },
  { name: "Коморы", code: "KM" },
  { name: "Лесото", code: "LS" },
  { name: "Гвинея-Бисау", code: "GW" },
  { name: "Эритрея", code: "ER" },
  { name: "Кабо-Верде", code: "CV" },
  { name: "Сейшелы", code: "SC" },
  { name: "Сан-Томе и Принсипи", code: "ST" },
  { name: "Южный Судан", code: "SS" },
];

/** Маппинг: название страны (рус.) → код */
const NAME_TO_CODE: Record<string, CountryCode> = Object.fromEntries(
  COUNTRY_LIST.map((c) => [c.name, c.code])
);

/** Города из статического файла — Россия из JSON, остальные СНГ из этого объекта. По коду страны. */
export const CITIES_STATIC: Record<CountryCode, string[]> = {
  RU: russianCityNames,
  BY: ["Минск", "Гомель", "Могилёв", "Витебск", "Гродно", "Брест"],
  KZ: [
    "Алматы",
    "Астана",
    "Шымкент",
    "Караганда",
    "Актобе",
    "Тараз",
    "Павлодар",
    "Усть-Каменогорск",
    "Семей",
  ],
  UA: [
    "Киев",
    "Харьков",
    "Одесса",
    "Днепр",
    "Донецк",
    "Запорожье",
    "Львов",
    "Кривой Рог",
    "Николаев",
    "Мариуполь",
    "Луганск",
    "Винница",
    "Полтава",
    "Чернигов",
    "Херсон",
    "Черкассы",
    "Сумы",
    "Хмельницкий",
    "Черновцы",
    "Житомир",
  ],
  UZ: [
    "Ташкент",
    "Самарканд",
    "Наманган",
    "Андижан",
    "Бухара",
    "Фергана",
    "Нукус",
    "Карши",
    "Коканд",
    "Маргилан",
  ],
  TJ: [
    "Душанбе",
    "Худжанд",
    "Кулоб",
    "Бохтар",
    "Истаравшан",
    "Пенджикент",
    "Хорог",
  ],
  AM: [
    "Ереван",
    "Гюмри",
    "Ванадзор",
    "Вагаршапат",
    "Раздан",
    "Армавир",
    "Горис",
    "Иджеван",
    "Капан",
    "Гавар",
  ],
  GE: [
    "Тбилиси",
    "Батуми",
    "Кутаиси",
    "Рустави",
    "Зугдиди",
    "Гори",
    "Поти",
    "Сенаки",
    "Самтредиа",
    "Марнеули",
  ],
  AZ: [
    "Баку",
    "Гянджа",
    "Сумгаит",
    "Мингячевир",
    "Ленкорань",
    "Нахичевань",
    "Ширван",
    "Шеки",
    "Евлах",
    "Ханкенди",
  ],
  KG: [
    "Бишкек",
    "Ош",
    "Джалал-Абад",
    "Кара-Балта",
    "Нарын",
    "Баткен",
    "Токмок",
    "Каракол",
    "Талас",
    "Кызыл-Кия",
  ],
  MD: [
    "Кишинёв",
    "Тирасполь",
    "Бельцы",
    "Бендеры",
    "Кагул",
    "Унгены",
    "Сороки",
    "Оргеев",
    "Дубоссары",
    "Комрат",
  ],
};

/** Получить код страны по названию */
export function getCountryCode(countryName: string): CountryCode | undefined {
  return NAME_TO_CODE[countryName];
}

/** Нужно ли для страны запрашивать города по API (все не-СНГ страны) */
export function isCountryUseApi(countryName: string): boolean {
  const code = getCountryCode(countryName);
  if (!code) return false;
  return !CITIES_STATIC[code];
}

/** Получить статический список городов по названию страны (если есть) */
export function getCitiesStatic(countryName: string): string[] | undefined {
  const code = getCountryCode(countryName);
  return code ? CITIES_STATIC[code] : undefined;
}

/** Названия стран для селектора (только имена) */
export const COUNTRY_OPTIONS = COUNTRY_LIST.map((c) => c.name);
