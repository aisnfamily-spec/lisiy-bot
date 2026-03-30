// Лисий Bot — Telegram License Key Manager
// ENV: BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_TG (your telegram username)

import { Bot, InlineKeyboard } from "grammy";
import { createClient } from "@supabase/supabase-js";

const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_TG = process.env.ADMIN_TG || "@your_username";
const PRODUCT = "yt-comment-bot";
const FREE_KEYS = 2;

if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing env: BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const bot = new Bot(BOT_TOKEN);
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateKey() {
  const hex = () =>
    Array.from({ length: 4 }, () =>
      Math.floor(Math.random() * 16).toString(16).toUpperCase()
    ).join("");
  return `LISIY-${hex()}-${hex()}-${hex()}`;
}

async function getUserKeys(telegramUserId) {
  const { data, error } = await supabase
    .from("yt_comment_bot_keys")
    .select("*")
    .eq("telegram_user_id", telegramUserId)
    .eq("product", PRODUCT)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function createKeys(telegramUserId, count) {
  const keys = [];
  for (let i = 0; i < count; i++) {
    const key = generateKey();
    keys.push({
      key,
      product: PRODUCT,
      telegram_user_id: telegramUserId,
      hardware_id: null,
      is_active: true,
    });
  }
  const { data, error } = await supabase
    .from("yt_comment_bot_keys")
    .insert(keys)
    .select();
  if (error) throw error;
  return data;
}

function formatKeyStatus(row) {
  const status = !row.is_active
    ? "deactivated"
    : row.hardware_id
    ? "activated"
    : "not used";
  const icon = !row.is_active ? "\u274C" : row.hardware_id ? "\u2705" : "\u26AA";
  return `${icon} \`${row.key}\` — ${status}`;
}

// ─── Commands ────────────────────────────────────────────────────────────────

bot.command("start", async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    let keys = await getUserKeys(userId);

    if (keys.length < FREE_KEYS) {
      const newKeys = await createKeys(userId, FREE_KEYS - keys.length);
      keys = [...keys, ...newKeys];
    }

    const keyList = keys.map(formatKeyStatus).join("\n");

    await ctx.reply(
      `\u{1F98A} *\u041B\u0438\u0441\u0438\u0439 Bot \u2014 YouTube Comment Bot*\n\n` +
        `\u0422\u0432\u043E\u0457 \u043A\u043B\u044E\u0447\u0456 \u0430\u043A\u0442\u0438\u0432\u0430\u0446\u0456\u0457:\n${keyList}\n\n` +
        `\u{1F4CB} *\u042F\u043A \u0430\u043A\u0442\u0438\u0432\u0443\u0432\u0430\u0442\u0438:*\n` +
        `1. \u0412\u0441\u0442\u0430\u043D\u043E\u0432\u0438 \u0440\u043E\u0437\u0448\u0438\u0440\u0435\u043D\u043D\u044F \u0432 Chrome\n` +
        `2. \u0412\u0456\u0434\u043A\u0440\u0438\u0439 YouTube\n` +
        `3. \u0412\u0432\u0435\u0434\u0438 \u043A\u043B\u044E\u0447 \u0443 \u043C\u043E\u0434\u0430\u043B\u044C\u043D\u043E\u043C\u0443 \u0432\u0456\u043A\u043D\u0456\n\n` +
        `\u26A0\uFE0F \u041A\u043E\u0436\u0435\u043D \u043A\u043B\u044E\u0447 \u043F\u0440\u0438\u0432'\u044F\u0437\u0443\u0454\u0442\u044C\u0441\u044F \u0434\u043E \u043E\u0434\u043D\u043E\u0433\u043E \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0430 \u043D\u0430\u0437\u0430\u0432\u0436\u0434\u0438.`,
      { parse_mode: "Markdown" }
    );
  } catch (e) {
    console.error("start error:", e);
    await ctx.reply("\u274C \u041F\u043E\u043C\u0438\u043B\u043A\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0430. \u0421\u043F\u0440\u043E\u0431\u0443\u0439 \u043F\u0456\u0437\u043D\u0456\u0448\u0435.");
  }
});

bot.command("keys", async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    const keys = await getUserKeys(userId);

    if (!keys.length) {
      await ctx.reply("\u0423 \u0442\u0435\u0431\u0435 \u043D\u0435\u043C\u0430\u0454 \u043A\u043B\u044E\u0447\u0456\u0432. \u041D\u0430\u0442\u0438\u0441\u043D\u0438 /start \u0449\u043E\u0431 \u043E\u0442\u0440\u0438\u043C\u0430\u0442\u0438.");
      return;
    }

    const keyList = keys.map(formatKeyStatus).join("\n");
    await ctx.reply(
      `\u{1F511} *\u0422\u0432\u043E\u0457 \u043A\u043B\u044E\u0447\u0456:*\n\n${keyList}\n\n` +
        `\u2705 activated = \u043F\u0440\u0438\u0432'\u044F\u0437\u0430\u043D\u043E \u0434\u043E \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0430\n` +
        `\u26AA not used = \u0449\u0435 \u043D\u0435 \u0430\u043A\u0442\u0438\u0432\u043E\u0432\u0430\u043D\u043E`,
      { parse_mode: "Markdown" }
    );
  } catch (e) {
    console.error("keys error:", e);
    await ctx.reply("\u274C \u041F\u043E\u043C\u0438\u043B\u043A\u0430. \u0421\u043F\u0440\u043E\u0431\u0443\u0439 \u043F\u0456\u0437\u043D\u0456\u0448\u0435.");
  }
});

bot.command("buy", async (ctx) => {
  await ctx.reply(
    `\u{1F4B3} *\u041F\u0440\u0438\u0434\u0431\u0430\u0442\u0438 \u0434\u043E\u0434\u0430\u0442\u043A\u043E\u0432\u0456 \u043A\u043B\u044E\u0447\u0456*\n\n` +
      `\u0414\u043B\u044F \u043F\u043E\u043A\u0443\u043F\u043A\u0438 \u043D\u0430\u043F\u0438\u0448\u0456\u0442\u044C: ${ADMIN_TG}`,
    { parse_mode: "Markdown" }
  );
});

// Fallback
bot.on("message", async (ctx) => {
  await ctx.reply(
    "\u{1F98A} *\u041B\u0438\u0441\u0438\u0439 Bot*\n\n" +
      "/start \u2014 \u041E\u0442\u0440\u0438\u043C\u0430\u0442\u0438 \u043A\u043B\u044E\u0447\u0456\n" +
      "/keys \u2014 \u041C\u043E\u0457 \u043A\u043B\u044E\u0447\u0456\n" +
      "/buy \u2014 \u041A\u0443\u043F\u0438\u0442\u0438 \u0449\u0435",
    { parse_mode: "Markdown" }
  );
});

bot.start();
console.log("\u{1F98A} \u041B\u0438\u0441\u0438\u0439 Bot started!");
