/**
 * Telegram-бот Quetlink — опрос и подбор подарков один в один с мини-приложением.
 * Запуск: положите BOT_TOKEN и BASE_URL в .env и выполните pnpm start
 */
import "dotenv/config";
import { createReadStream, existsSync } from "fs";
import { join } from "path";

import { Telegraf, Context } from "telegraf";
import type { Update } from "telegraf/types";
import {
  AGE_OPTIONS,
  BUDGET_OPTIONS,
  ALWAYS_OCCASIONS,
  SAMPLE_HOLIDAYS,
  MOCK_PRODUCTS,
  MOCK_PRODUCTS_EXPENSIVE,
  MOCK_PRODUCTS_CHEAP,
  type ProductSummary,
} from "./data.js";
import { reverseGeocodeDisplay } from "./geocode.js";

const BACK_BTN = "◀️ Назад";
const DONE_OCCASION_BTN = "✅ Готово";
const CONFIRM_LOCATION_BTN = "✅ Всё верно";
const CHANGE_LOCATION_BTN = "✏️ Изменить";

/** Отвечает на callback query; игнорирует ошибку «query is too old» (устаревшая кнопка). */
async function safeAnswerCbQuery(ctx: Context, text?: string): Promise<void> {
  try {
    await ctx.answerCbQuery(text);
  } catch (err: unknown) {
    const desc =
      err && typeof err === "object" && "response" in err
        ? String(
            (err as { response?: { description?: string } }).response
              ?.description ?? ""
          )
        : "";
    if (
      desc.includes("query is too old") ||
      desc.includes("query ID is invalid")
    ) {
      return;
    }
    throw err;
  }
}

const ALL_PRODUCTS = [
  ...MOCK_PRODUCTS,
  ...MOCK_PRODUCTS_EXPENSIVE,
  ...MOCK_PRODUCTS_CHEAP,
];

function getProductById(id: number): ProductSummary | undefined {
  return ALL_PRODUCTS.find((p) => p.id === id);
}

const BOT_TOKEN = process.env.BOT_TOKEN;
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

if (!BOT_TOKEN) {
  console.error("Set BOT_TOKEN env variable");
  process.exit(1);
}

type Step =
  | "idle"
  | 1
  | 2
  | 3
  | 4
  | 5
  | "5_confirm"
  | 6
  | "loading"
  | "results";

type UserState = {
  step: Step;
  /** На шаге 5: ждём ввод названия города после нажатия «Указать город вручную» */
  waitingForCityName?: boolean;
  answers: {
    name: string;
    age: string | null;
    budget: string | null;
    prompt: string;
    location: string;
    /** Выбранные поводы (на шаге 6 можно несколько) */
    occasions: string[];
  };
  products: ProductSummary[];
  priceFilter: "default" | "up" | "down";
  favorites: number[];
};

const userStates = new Map<number, UserState>();

function getState(ctx: Context): UserState {
  const id = ctx.from?.id;
  if (!id) throw new Error("No user id");
  let state = userStates.get(id);
  if (!state) {
    state = {
      step: "idle",
      answers: {
        name: "",
        age: null,
        budget: null,
        prompt: "",
        location: "",
        occasions: [],
      },
      products: [],
      priceFilter: "default",
      favorites: [],
    };
    userStates.set(id, state);
  }
  return state;
}

function fullImageUrl(path: string): string {
  const base = BASE_URL.replace(/\/$/, "");
  return path.startsWith("http")
    ? path
    : `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}

/** Путь к фото: если есть локальная папка bot/images — с диска, иначе по BASE_URL */
function getImageSource(imagePath: string): string {
  const name =
    imagePath
      .replace(/^\/images\//, "")
      .split("/")
      .pop() || imagePath;
  const localPath = join(process.cwd(), "images", name);
  if (existsSync(localPath)) return localPath;
  return fullImageUrl(imagePath);
}

const bot = new Telegraf<Context<Update>>(BOT_TOKEN);

// Меню команд задаётся при запуске (см. bot.launch ниже)

// ——— Помощь и команды ———
bot.help((ctx) =>
  ctx.reply(
    "📋 <b>Команды бота:</b>\n\n" +
      "<b>/start</b> — начать подбор подарка (короткий опрос из 6 вопросов)\n" +
      "<b>/help</b> — эта справка\n" +
      "<b>/new</b> — начать опрос заново\n\n" +
      "Во время опроса можно нажать «◀️ Назад», чтобы вернуться к предыдущему вопросу.\n" +
      "Под каждым подарком: «Характеристики» — полное описание, «В избранное» — сохранить.",
    { parse_mode: "HTML" }
  )
);

// ——— Старт и сброс ———
bot.start((ctx) => {
  const state = getState(ctx);
  state.step = 1;
  state.answers = {
    name: "",
    age: null,
    budget: null,
    prompt: "",
    location: "",
    occasions: [],
  };
  state.products = [];
  state.priceFilter = "default";
  return ctx.reply("Как его зовут? (1/6)", {
    reply_markup: { remove_keyboard: true },
  });
});

// ——— Шаг 1: имя (текст) ———
bot.on("text", async (ctx) => {
  const chatId = ctx.chat?.id;
  if (chatId) await ctx.telegram.sendChatAction(chatId, "typing");
  const state = getState(ctx);
  const text = (ctx.message as { text?: string }).text?.trim() ?? "";

  if (text === "/new") {
    state.step = 1;
    state.answers = {
      name: "",
      age: null,
      budget: null,
      prompt: "",
      location: "",
      occasions: [],
    };
    state.products = [];
    state.priceFilter = "default";
    return ctx.reply("Как его зовут? (1/6)", {
      reply_markup: { remove_keyboard: true },
    });
  }

  if (text === BACK_BTN) {
    if (state.step === 2) {
      state.step = 1;
      return ctx.reply("Как его зовут? (1/6)", {
        reply_markup: { remove_keyboard: true },
      });
    }
    if (state.step === 3) {
      state.step = 2;
      const keyboard = [
        ...AGE_OPTIONS.map((o) => [{ text: o }]),
        [{ text: BACK_BTN }],
      ];
      return ctx.reply("Сколько ему лет? (2/6)", {
        reply_markup: { keyboard, resize_keyboard: true },
      });
    }
    if (state.step === 4) {
      state.step = 3;
      const keyboard = [
        ...BUDGET_OPTIONS.map((o) => [{ text: o }]),
        [{ text: BACK_BTN }],
      ];
      return ctx.reply("Твой бюджет? (3/6)", {
        reply_markup: { keyboard, resize_keyboard: true },
      });
    }
    if (state.step === 5) {
      state.waitingForCityName = false;
      state.step = 4;
      return ctx.reply(
        "Что он любит? Опишите увлечения или характер. (4/6)\n\nНапример: любит кофе и книги, геймер, увлекается рыбалкой, минималист, ценит handmade.",
        {
          reply_markup: {
            keyboard: [[{ text: BACK_BTN }]],
            resize_keyboard: true,
          },
        }
      );
    }
    if (state.step === "5_confirm") {
      state.step = 5;
      state.waitingForCityName = false;
      const keyboard = [
        [{ text: "📍 Отправить геолокацию", request_location: true }],
        [{ text: "Указать город вручную" }],
        [{ text: BACK_BTN }],
      ];
      return ctx.reply("Откуда вы? (5/6)", {
        reply_markup: { keyboard, resize_keyboard: true },
      });
    }
    if (state.step === 6) {
      state.step = 5;
      state.waitingForCityName = false;
      const keyboard = [
        [{ text: "📍 Отправить геолокацию", request_location: true }],
        [{ text: "Указать город вручную" }],
        [{ text: BACK_BTN }],
      ];
      return ctx.reply("Откуда вы? (5/6)", {
        reply_markup: { keyboard, resize_keyboard: true },
      });
    }
    return ctx.reply("Кнопка «Назад» доступна на шагах 2–6.");
  }

  if (state.step === 1) {
    if (!text) return ctx.reply("Введите имя получателя подарка.");
    state.answers.name = text;
    state.step = 2;
    const keyboard = [
      ...AGE_OPTIONS.map((opt) => [{ text: opt }]),
      [{ text: BACK_BTN }],
    ];
    return ctx.reply("Сколько ему лет? (2/6)", {
      reply_markup: {
        keyboard,
        resize_keyboard: true,
        input_field_placeholder: "Выберите возраст",
      },
    });
  }

  if (state.step === 2) {
    if (!AGE_OPTIONS.includes(text))
      return ctx.reply("Выберите вариант из кнопок ниже.");
    state.answers.age = text;
    state.step = 3;
    const keyboard = [
      ...BUDGET_OPTIONS.map((opt) => [{ text: opt }]),
      [{ text: BACK_BTN }],
    ];
    return ctx.reply("Твой бюджет? (3/6)", {
      reply_markup: {
        keyboard,
        resize_keyboard: true,
        input_field_placeholder: "Выберите бюджет",
      },
    });
  }

  if (state.step === 3) {
    if (!BUDGET_OPTIONS.includes(text))
      return ctx.reply("Выберите бюджет из кнопок.");
    state.answers.budget = text;
    state.step = 4;
    return ctx.reply(
      "Что он любит? Опишите увлечения или характер. (4/6)\n\nНапример: любит кофе и книги, геймер, увлекается рыбалкой, минималист, ценит handmade.",
      {
        reply_markup: {
          keyboard: [[{ text: BACK_BTN }]],
          resize_keyboard: true,
          input_field_placeholder: "Увлечения, характер…",
        },
      }
    );
  }

  if (state.step === 4) {
    if (!text) return ctx.reply("Напишите хотя бы пару слов.");
    state.answers.prompt = text;
    state.step = 5;
    const keyboard = [
      [{ text: "📍 Отправить геолокацию", request_location: true }],
      [{ text: "Указать город вручную" }],
      [{ text: BACK_BTN }],
    ];
    return ctx.reply("Откуда вы? (5/6)", {
      reply_markup: {
        keyboard,
        resize_keyboard: true,
        input_field_placeholder: "Геолокация или город",
      },
    });
  }

  if (state.step === "5_confirm") {
    if (text === CONFIRM_LOCATION_BTN) {
      state.step = 6;
      if (!Array.isArray(state.answers.occasions)) state.answers.occasions = [];
      const occasionOptions = [...ALWAYS_OCCASIONS, ...SAMPLE_HOLIDAYS].slice(
        0,
        12
      );
      const keyboard = [
        ...occasionOptions.map((opt) => [{ text: opt }]),
        [{ text: DONE_OCCASION_BTN }],
        [{ text: BACK_BTN }],
      ];
      return ctx.reply(
        "Повод для подарка? (6/6) Можно выбрать несколько. Нажмите «Готово», когда закончите.",
        {
          reply_markup: {
            keyboard,
            resize_keyboard: true,
            input_field_placeholder: "Поводы или Готово",
          },
        }
      );
    }
    if (text === CHANGE_LOCATION_BTN) {
      state.step = 5;
      state.waitingForCityName = false;
      const keyboard = [
        [{ text: "📍 Отправить геолокацию", request_location: true }],
        [{ text: "Указать город вручную" }],
        [{ text: BACK_BTN }],
      ];
      return ctx.reply("Откуда вы? (5/6)", {
        reply_markup: {
          keyboard,
          resize_keyboard: true,
          input_field_placeholder: "Геолокация или город",
        },
      });
    }
    return ctx.reply(
      "Нажмите «Всё верно», если город определён правильно, или «Изменить», чтобы указать место заново."
    );
  }

  if (state.step === 5) {
    if (state.waitingForCityName) {
      state.answers.location = text;
      state.waitingForCityName = false;
      state.step = 6;
      if (!Array.isArray(state.answers.occasions)) state.answers.occasions = [];
      const occasionOptions = [...ALWAYS_OCCASIONS, ...SAMPLE_HOLIDAYS].slice(
        0,
        12
      );
      const keyboard = [
        ...occasionOptions.map((opt) => [{ text: opt }]),
        [{ text: DONE_OCCASION_BTN }],
        [{ text: BACK_BTN }],
      ];
      return ctx.reply(
        "Повод для подарка? (6/6) Можно выбрать несколько. Нажмите «Готово», когда закончите.",
        {
          reply_markup: {
            keyboard,
            resize_keyboard: true,
            input_field_placeholder: "Поводы или Готово",
          },
        }
      );
    }
    if (text === "Указать город вручную") {
      state.waitingForCityName = true;
      return ctx.reply(
        "Введите название города. Можно нажать «◀️ Назад», чтобы вернуться.",
        {
          reply_markup: {
            keyboard: [[{ text: BACK_BTN }]],
            resize_keyboard: true,
            input_field_placeholder: "Название города",
          },
        }
      );
    }
    return ctx.reply(
      "Нажмите «Отправить геолокацию» или «Указать город вручную»."
    );
  }

  if (state.step === 6) {
    const occasionOptions = [...ALWAYS_OCCASIONS, ...SAMPLE_HOLIDAYS].slice(
      0,
      12
    );
    const keyboard = [
      ...occasionOptions.map((opt) => [{ text: opt }]),
      [{ text: DONE_OCCASION_BTN }],
      [{ text: BACK_BTN }],
    ];

    if (text === DONE_OCCASION_BTN) {
      if (state.answers.occasions.length === 0) {
        return ctx.reply(
          "Выберите хотя бы один повод или нажмите кнопки выше.",
          {
            reply_markup: { keyboard, resize_keyboard: true },
          }
        );
      }
      state.step = "loading";
      const parts: string[] = [];
      if (state.answers.name) parts.push(`Подарок для ${state.answers.name}`);
      if (state.answers.age) parts.push(state.answers.age);
      if (state.answers.budget) parts.push(`бюджет ${state.answers.budget}`);
      if (state.answers.prompt) parts.push(state.answers.prompt);
      if (state.answers.location) parts.push(state.answers.location);
      if (state.answers.occasions.length)
        parts.push(`поводы: ${state.answers.occasions.join(", ")}`);
      state.products = [...MOCK_PRODUCTS];
      state.priceFilter = "default";
      await ctx.reply("Подбираем подарки…", {
        reply_markup: { remove_keyboard: true },
      });
      return sendResults(ctx, state);
    }

    const textNorm = text.trim();
    if (occasionOptions.some((o) => o.trim() === textNorm)) {
      const idx = state.answers.occasions.findIndex(
        (o) => o.trim() === textNorm
      );
      if (idx >= 0) {
        const removed = state.answers.occasions[idx];
        state.answers.occasions.splice(idx, 1);
        await ctx.reply(`Повод «${removed}» отменён.`);
      } else {
        const toAdd =
          occasionOptions.find((o) => o.trim() === textNorm) ?? textNorm;
        state.answers.occasions.push(toAdd);
      }
      const selected = state.answers.occasions.length
        ? `Выбрано: ${state.answers.occasions.join(", ")}. `
        : "";
      return ctx.reply(
        `${selected}Нажмите ещё поводы при необходимости или «${DONE_OCCASION_BTN}», когда закончите.`,
        { reply_markup: { keyboard, resize_keyboard: true } }
      );
    }

    return ctx.reply("Выберите повод из кнопок или нажмите «Готово».", {
      reply_markup: { keyboard, resize_keyboard: true },
    });
  }

  // Дополнить промпт (на экране результатов)
  if (state.step === "results" && text && !text.startsWith("/")) {
    state.answers.prompt = text;
    state.products = [...MOCK_PRODUCTS];
    state.priceFilter = "default";
    return sendResults(ctx, state);
  }
});

// ——— Геолокация (шаг 5): показываем определённый город и кнопку «Изменить» ———
bot.on("location", async (ctx) => {
  const state = getState(ctx);
  if (state.step !== 5) return;
  const loc = ctx.message.location;
  if (!loc) return;
  const locationKeyboard = [
    [{ text: "📍 Отправить геолокацию", request_location: true }],
    [{ text: "Указать город вручную" }],
    [{ text: BACK_BTN }],
  ];
  try {
    const display = await reverseGeocodeDisplay(loc.latitude, loc.longitude);
    state.answers.location =
      display ?? `${loc.latitude.toFixed(2)}°, ${loc.longitude.toFixed(2)}°`;
    state.step = "5_confirm";
    const confirmKeyboard = [
      [{ text: CONFIRM_LOCATION_BTN }, { text: CHANGE_LOCATION_BTN }],
      [{ text: BACK_BTN }],
    ];
    return ctx.reply(`Мы определили: ${state.answers.location}. Всё верно?`, {
      reply_markup: { keyboard: confirmKeyboard, resize_keyboard: true },
    });
  } catch {
    return ctx.reply(
      "Не удалось определить место по геолокации. Попробуйте отправить ещё раз или нажмите «Указать город вручную».",
      { reply_markup: { keyboard: locationKeyboard, resize_keyboard: true } }
    );
  }
});

// ——— Результаты: кнопки Дороже / Дешевле / Дополнить / Новый запрос / Избранное ———
bot.action(/^action:(.+)$/, async (ctx) => {
  const state = getState(ctx);
  const action = ctx.match[1];

  if (action === "price_up") {
    await safeAnswerCbQuery(ctx);
    state.products = [...MOCK_PRODUCTS_EXPENSIVE];
    state.priceFilter = "up";
    return sendResults(ctx, state);
  }
  if (action === "price_down") {
    await safeAnswerCbQuery(ctx);
    state.products = [...MOCK_PRODUCTS_CHEAP];
    state.priceFilter = "down";
    return sendResults(ctx, state);
  }
  if (action === "supplement") {
    await safeAnswerCbQuery(ctx);
    state.step = "results";
    return ctx.reply("Дополните промпт: напишите, что ещё учесть при подборе.");
  }
  if (action === "new_request") {
    await safeAnswerCbQuery(ctx);
    state.step = 1;
    state.answers = {
      name: "",
      age: null,
      budget: null,
      prompt: "",
      location: "",
      occasions: [],
    };
    return ctx.reply("Как его зовут? (1/6)", {
      reply_markup: { remove_keyboard: true },
    });
  }
  if (action === "favorites") {
    await safeAnswerCbQuery(ctx);
    if (state.favorites.length === 0) {
      return ctx.reply(
        "В избранном пока пусто. Нажмите «В избранное» под товаром, чтобы добавить."
      );
    }
    const allProducts = [
      ...MOCK_PRODUCTS,
      ...MOCK_PRODUCTS_EXPENSIVE,
      ...MOCK_PRODUCTS_CHEAP,
    ];
    const toShow = allProducts.filter((p) => state.favorites.includes(p.id));
    if (toShow.length === 0) return ctx.reply("В избранном пока ничего нет.");
    return sendProductList(ctx, toShow, state, "❤️ Избранное");
  }
  if (action.startsWith("fav_")) {
    const id = Number(action.slice(4));
    if (state.favorites.includes(id)) {
      state.favorites = state.favorites.filter((x) => x !== id);
    } else {
      state.favorites.push(id);
    }
    return safeAnswerCbQuery(
      ctx,
      state.favorites.includes(id)
        ? "Добавлено в избранное"
        : "Убрано из избранного"
    );
  }
  if (action.startsWith("specs_")) {
    const id = Number(action.slice(6));
    const product = getProductById(id);
    await safeAnswerCbQuery(ctx);
    if (!product) return ctx.reply("Товар не найден.");
    const text =
      product.specs ??
      `${product.category}\nЦена: ${
        product.price
      }\nРейтинг: ${product.rating.toFixed(1)} (${product.reviews} отзывов)`;
    return ctx.reply(text);
  }
});

async function sendProductList(
  ctx: Context,
  products: ProductSummary[],
  state: UserState,
  title: string
): Promise<void> {
  await ctx.reply(title);
  const chatId = ctx.chat?.id;
  for (const p of products) {
    if (chatId) await ctx.telegram.sendChatAction(chatId, "upload_photo");
    const isFav = state.favorites.includes(p.id);
    const caption = `${p.category}\n${p.price} · ${p.rating.toFixed(1)} (${
      p.reviews
    } отзывов)`;
    try {
      const photo = getImageSource(p.image);
      const input = photo.startsWith("http")
        ? { url: photo }
        : { source: createReadStream(photo) };
      await ctx.replyWithPhoto(input, {
        caption,
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "📋 Характеристики",
                callback_data: `action:specs_${p.id}`,
              },
              {
                text: isFav ? "❤️ В избранном" : "🤍 В избранное",
                callback_data: `action:fav_${p.id}`,
              },
            ],
          ],
        },
      });
    } catch {
      await ctx.reply(caption + `\n[Фото: ${p.image}]`);
    }
  }
  const keyboard = {
    inline_keyboard: [
      [
        { text: "Дороже", callback_data: "action:price_up" },
        { text: "Дешевле", callback_data: "action:price_down" },
      ],
      [{ text: "Дополнить промпт", callback_data: "action:supplement" }],
      [
        { text: "Новый запрос", callback_data: "action:new_request" },
        { text: "❤️ Избранное", callback_data: "action:favorites" },
      ],
    ],
  };
  await ctx.reply("Что дальше?", { reply_markup: keyboard });
}

function formatAnswersSummary(answers: UserState["answers"]): string {
  const lines: string[] = [];
  if (answers.name?.trim()) lines.push(`• Для кого: ${answers.name.trim()}`);
  if (answers.age) lines.push(`• Возраст: ${answers.age}`);
  if (answers.budget) lines.push(`• Бюджет: ${answers.budget}`);
  if (answers.prompt?.trim())
    lines.push(`• Увлечения: ${answers.prompt.trim()}`);
  if (answers.location?.trim())
    lines.push(`• Откуда: ${answers.location.trim()}`);
  if (answers.occasions?.length)
    lines.push(`• Поводы: ${answers.occasions.join(", ")}`);
  if (lines.length === 0) return "";
  return "\n\n📋 Подытог:\n" + lines.join("\n");
}

async function sendResults(ctx: Context, state: UserState): Promise<void> {
  state.step = "results";
  const summary = formatAnswersSummary(state.answers);
  const title = "Вот подборка подарков по вашим ответам:" + summary;
  return sendProductList(ctx, state.products, state, title);
}

// ——— Обработка ошибок ———
bot.catch((err, ctx) => {
  console.error("bot error", err);
  ctx.reply("Что-то пошло не так. Попробуйте /new или /start.").catch(() => {});
});

// ——— Запуск ———
bot.launch().then(async () => {
  await bot.telegram.setMyCommands([
    { command: "start", description: "Начать подбор подарка" },
    { command: "help", description: "Помощь и список команд" },
    { command: "new", description: "Новый опрос с начала" },
  ]);
  // Кнопка меню рядом с полем ввода: по умолчанию открывает список команд
  await bot.telegram.setChatMenuButton({ menuButton: { type: "commands" } });
  await bot.telegram.setMyDescription(
    "Подбор персональных подарков по короткому опросу: возраст, бюджет, увлечения, повод. Можно смотреть характеристики и сохранять в избранное."
  );
  await bot.telegram.setMyShortDescription(
    "Персональный подбор подарков по опросу"
  );
  console.log("Quetlink bot started");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
