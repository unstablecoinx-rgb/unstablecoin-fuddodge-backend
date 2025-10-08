// === UnStableCoin Game Bot ===
// ⚡ Version: Full Stable Build (callback + leaderboards + info + fixes)
// Author: UnStableCoin Community
// ------------------------------------

const express = require("express");
const bodyParser = require("body-parser");
const TelegramBot = require("node-telegram-bot-api");
const cors = require("cors");
const axios = require("axios");
require("dotenv").config();

// === ENVIRONMENT VARIABLES ===
const token = process.env.TELEGRAM_BOT_TOKEN;
const JSONBIN_ID = process.env.JSONBIN_ID;
const EVENT_JSONBIN_ID = process.env.EVENT_JSONBIN_ID;
const JSONBIN_KEY = process.env.JSONBIN_KEY;

if (!token || !JSONBIN_ID || !EVENT_JSONBIN_ID || !JSONBIN_KEY) {
  console.error("❌ Missing environment variables!");
  process.exit(1);
}

// === SETTINGS ===
const ADMIN_USERS = ["unstablecoinx", "unstablecoinx_bot", "pachenko_14"];
const app = express();
app.use(cors({ origin: "https://theunstable.io" }));
app.use(bodyParser.json());

// === JSONBin URLs ===
const MAIN_BIN_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_ID}`;
const EVENT_BIN_URL = `https://api.jsonbin.io/v3/b/${EVENT_JSONBIN_ID}`;

// === TELEGRAM BOT ===
const bot = new TelegramBot(token);
bot.setWebHook(`https://unstablecoin-fuddodge-backend.onrender.com/bot${token}`);
console.log(`✅ Webhook set to: https://unstablecoin-fuddodge-backend.onrender.com/bot${token}`);

// === EXPRESS ENDPOINTS ===
app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.get("/", (req, res) => {
  res.send("💛 UnStableCoin Game Bot is online and unstable as ever.");
});

// === HELPERS ===
async function sendSafeMessage(chatId, message) {
  try {
    await bot.sendMessage(chatId, message, { parse_mode: "HTML", disable_web_page_preview: true });
  } catch (err) {
    console.error("❌ Telegram send failed:", err.message);
  }
}

async function getLeaderboard() {
  try {
    const res = await axios.get(MAIN_BIN_URL, { headers: { "X-Master-Key": JSONBIN_KEY } });
    return res.data.record || {};
  } catch (err) {
    console.error("❌ Error loading leaderboard:", err.message);
    return {};
  }
}

async function getEventData() {
  try {
    const res = await axios.get(EVENT_BIN_URL, { headers: { "X-Master-Key": JSONBIN_KEY } });
    const data = res.data.record || {};
    if (data.scores) return data;
    if (typeof data === "object") return { scores: data };
    return { scores: {} };
  } catch (err) {
    console.error("❌ Error fetching event data:", err.message);
    return { scores: {} };
  }
}

// === TELEGRAM COMMANDS ===

// ✅ START (native inline Play button)
bot.onText(/\/start/, async (msg) => {
  try {
    await bot.sendGame(msg.chat.id, "US_FUD_Dodge", {
      reply_markup: {
        inline_keyboard: [[{ text: "🎮 Play Now", callback_game: {} }]],
      },
    });
  } catch (err) {
    console.error("❌ Failed to send start game:", err.message);
    await sendSafeMessage(
      msg.chat.id,
      `🎮 <b>Play FUD Dodge</b>\nIf the button doesn’t work, open manually:\n👉 <a href="https://theunstable.io/fuddodge">theunstable.io/fuddodge</a>`
    );
  }
});

// HELP
bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;
  const text = `
<b>💛 Welcome to the UnStableCoin Game Bot</b>

Available commands:
🎮 <b>/play</b> – Start the game  
🏆 <b>/top10</b> – View top 10  
📈 <b>/top50</b> – View top 50  
⚡ <b>/eventtop10</b> – Event top 10  
🥇 <b>/eventtop50</b> – Event top 50  
ℹ️ <b>/about</b> – Learn more  
🕹️ <b>/info</b> or <b>/howtoplay</b> – Game rules
`;
  await sendSafeMessage(chatId, text);
});

// PLAY
bot.onText(/\/play/, async (msg) => {
  const chatId = msg.chat.id;
  const isPrivate = msg.chat.type === "private";

  if (isPrivate) {
    await bot.sendMessage(chatId, "🎮 <b>Play FUD Dodge</b>", {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "⚡ Open Game", web_app: { url: "https://theunstable.io/fuddodge" } }],
        ],
      },
    });
  } else {
    await bot.sendMessage(
      chatId,
      `💨 FUD levels too high in here 😅  
Play safely in a private chat 👇`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "⚡ Open DM to Play", url: "https://t.me/UnStableCoinBot?start=play" }],
          ],
        },
      }
    );
  }
});

// ABOUT
bot.onText(/\/about/, async (msg) => {
  const chatId = msg.chat.id;
  const text = `
<b>UnStableCoin ($US)</b>  
A cultural experiment on Solana.  
Born without presale. Built by chaos, memes, and belief.

🌐 <a href="https://theunstable.io">Website</a>  
🐦 <a href="https://x.com/UnStableCoinX">X</a>  
💬 <a href="https://t.me/UnStableCoin_US">Telegram</a>
`;
  await sendSafeMessage(chatId, text);
});

// INFO / HOWTOPLAY
bot.onText(/\/info|\/howtoplay/, async (msg) => {
  const chatId = msg.chat.id;
  const text = `
🎮 <b>How to Play FUD Dodge</b>

🪙 <b>Goal:</b>  
Dodge FUD and scams. Collect coins, memes, and green candles to grow your MCap.  
Simple? Not really.

⚡ <b>Power-ups:</b>  
• ⚡ Lightning – Clears all FUD on screen  
• 🪙 Coin – +200 MCap  
• 🟢 Green Candle – Shield + bonus  
• 🧠 Meme – Random word drop  

💀 <b>Threats:</b>  
• ☠️ FUD Skull – Game Over  
• 🏴‍☠️ The Scammer! – -50% MCap  
• 🔴 Red Candle – -500 MCap  

📊 <b>Compete on:</b>  
• /top10 – All time legends  
• /eventtop10 – Current event leaderboard  

Keep dodging. Keep growing.  
Stay unstable. 💛⚡
`;
  await sendSafeMessage(chatId, text);
});

// === LEADERBOARD COMMANDS ===
bot.onText(/\/top10/, async (msg) => {
  const chatId = msg.chat.id;
  const data = await getLeaderboard();
  const sorted = Object.entries(data).sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return sendSafeMessage(chatId, "No scores yet. Be the first to play!");

  let message = "<b>🏆 Top 10 Players</b>\n\n";
  sorted.slice(0, 10).forEach(([user, score], i) => {
    message += `${i + 1}. <b>${user}</b> – ${score} pts\n`;
  });
  await sendSafeMessage(chatId, message);
});

bot.onText(/\/top50/, async (msg) => {
  const chatId = msg.chat.id;
  const data = await getLeaderboard();
  const sorted = Object.entries(data).sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return sendSafeMessage(chatId, "No scores yet.");

  let message =
    "<b>🏅 Legends, try-harders & those who get scammed too often – Top 50</b>\n\n";
  sorted.slice(0, 50).forEach(([user, score], i) => {
    message += `${i + 1}. <b>${user}</b> – ${score} pts\n`;
  });
  await sendSafeMessage(chatId, message);
});

bot.onText(/\/eventtop10/, async (msg) => {
  const chatId = msg.chat.id;
  const eventData = await getEventData();
  const scores = eventData.scores || {};

  const sorted = Object.entries(scores)
    .filter(([user]) => !user.startsWith("_"))
    .sort((a, b) => b[1] - a[1]);

  if (!sorted.length) return sendSafeMessage(chatId, "No event scores yet.");

  let message = "<b>🥇 Event Top 10</b>\n\n";
  sorted.slice(0, 10).forEach(([user, score], i) => {
    message += `${i + 1}. <b>${user}</b> – ${score} pts\n`;
  });
  await sendSafeMessage(chatId, message);
});

bot.onText(/\/eventtop50/, async (msg) => {
  const chatId = msg.chat.id;
  const eventData = await getEventData();
  const scores = eventData.scores || {};

  const sorted = Object.entries(scores)
    .filter(([user]) => !user.startsWith("_"))
    .sort((a, b) => b[1] - a[1]);

  if (!sorted.length) return sendSafeMessage(chatId, "No event scores yet.");

  let message = "<b>⚡ Those still dodging FUD like it’s 2023 – Event Top 50</b>\n\n";
  sorted.slice(0, 50).forEach(([user, score], i) => {
    message += `${i + 1}. <b>${user}</b> – ${score} pts\n`;
  });
  await sendSafeMessage(chatId, message);
});

// === CALLBACK FIX ===
bot.on("callback_query", async (query) => {
  try {
    if (query.game_short_name === "US_FUD_Dodge") {
      await bot.answerCallbackQuery(query.id, {
        url: "https://theunstable.io/fuddodge",
      });
    }
  } catch (err) {
    console.error("❌ Game callback error:", err.message);
  }
});

// === SERVER START ===
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 UnStableCoinBot running on port ${PORT}`);
});
