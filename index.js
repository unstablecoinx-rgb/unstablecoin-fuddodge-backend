// === UnStableCoin Leaderboard + Game API ===
// by UnStableCoin community ⚡
// Version: full release with event + reset command

const express = require("express");
const bodyParser = require("body-parser");
const TelegramBot = require("node-telegram-bot-api");
const cors = require("cors");
const axios = require("axios");
require("dotenv").config();

// === Environment ===
const token = process.env.TELEGRAM_BOT_TOKEN;
const JSONBIN_ID = process.env.JSONBIN_ID;             // Main leaderboard
const EVENT_JSONBIN_ID = process.env.EVENT_JSONBIN_ID; // Event leaderboard
const JSONBIN_KEY = process.env.JSONBIN_KEY;
const RESET_KEY = process.env.RESET_KEY;

if (!token || !JSONBIN_ID || !EVENT_JSONBIN_ID || !JSONBIN_KEY) {
  console.error("❌ Missing environment variables (TOKEN / JSONBIN_ID / EVENT_JSONBIN_ID / JSONBIN_KEY)");
  process.exit(1);
}

// === Express setup ===
const app = express();
app.use(cors({ origin: "*" }));
app.use(bodyParser.json());

// === JSONBin config ===
const MAIN_BIN_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_ID}`;
const EVENT_BIN_URL = `https://api.jsonbin.io/v3/b/${EVENT_JSONBIN_ID}`;

// === Telegram setup (webhook mode for Render) ===
const bot = new TelegramBot(token, { webHook: true });
const WEBHOOK_URL = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`;
bot.setWebHook(`${WEBHOOK_URL}/bot${token}`);

// === Helper functions ===
async function getScores(binUrl) {
  try {
    const res = await axios.get(binUrl, { headers: { "X-Master-Key": JSONBIN_KEY } });
    return res.data.record || {};
  } catch (err) {
    console.error("⚠️ Failed to fetch scores:", err.message);
    return {};
  }
}

async function saveScores(binUrl, scores) {
  try {
    await axios.put(binUrl, scores, {
      headers: {
        "Content-Type": "application/json",
        "X-Master-Key": JSONBIN_KEY,
      },
    });
  } catch (err) {
    console.error("⚠️ Failed to save scores:", err.message);
  }
}

// === Markdown escape helper ===
function escapeMarkdown(text) {
  if (!text) return "";
  return text
    .replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&")
    .replace(/\\@/g, "@");
}

// === REST endpoints ===
app.get("/leaderboard", async (req, res) => {
  const scores = await getScores(MAIN_BIN_URL);
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 10);
  res.json(sorted.map(([username, score]) => ({ username, score })));
});

app.get("/eventtop", async (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const scores = await getScores(EVENT_BIN_URL);
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, limit);
  res.json(sorted.map(([username, score]) => ({ username, score })));
});

app.post("/submit", async (req, res) => {
  let { username, score } = req.body;
  if (!username || typeof score !== "number") {
    return res.status(400).json({ error: "Missing username or score" });
  }

  username = username.replace(/^@+/, "@");
  const mainScores = await getScores(MAIN_BIN_URL);
  const eventScores = await getScores(EVENT_BIN_URL);

  if (!mainScores[username] || score > mainScores[username]) mainScores[username] = score;
  if (!eventScores[username] || score > eventScores[username]) eventScores[username] = score;

  await saveScores(MAIN_BIN_URL, mainScores);
  await saveScores(EVENT_BIN_URL, eventScores);

  res.json({ success: true, message: "Score saved", username, score });
});

// === Reset Event leaderboard (protected) ===
app.post("/resetevent", async (req, res) => {
  const key = req.query.key || req.body.key;
  if (key !== RESET_KEY) {
    return res.status(403).json({ error: "Invalid or missing RESET_KEY" });
  }
  await saveScores(EVENT_BIN_URL, {});
  console.log("🧹 Event leaderboard reset!");
  res.json({ success: true, message: "Event leaderboard reset" });
});

// === Telegram Webhook Receiver ===
app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// === Telegram Commands ===
bot.onText(/\/start/, (msg) => {
  const user = msg.from.username ? `@${msg.from.username}` : msg.from.first_name || "player";
  const text = [
    `💛 Welcome, ${escapeMarkdown(user)}!`,
    ``,
    `This is the *UnStableCoin FUD Dodge* bot.`,
    ``,
    `🚀 Commands:`,
    `/play – Launch the mini-game`,
    `/top10 – Main leaderboard`,
    `/eventtop – Event leaderboard (Top 10)`,
    `/eventtop50 – Event leaderboard (Top 50)`,
    `/resetevent – Admin only`,
    `/rules – How to play`,
    `/help – Show available commands`,
  ].join("\n");

  bot.sendMessage(msg.chat.id, text, { parse_mode: "MarkdownV2" });
});

bot.onText(/\/help/, (msg) => {
  const text = [
    `🧭 Commands:`,
    `/play – Launch the mini-game`,
    `/top10 – Main leaderboard`,
    `/eventtop – Event leaderboard (Top 10)`,
    `/eventtop50 – Event leaderboard (Top 50)`,
    `/rules – How to play`,
    `/help – Show available commands`,
  ].join("\n");
  bot.sendMessage(msg.chat.id, text);
});

bot.onText(/\/rules/, (msg) => {
  const text = [
    `🎮 *How to Play*`,
    `Dodge the falling FUD and scams.`,
    `Collect coins, memes and green candles to boost your score.`,
    `Avoid rugs and skulls.`,
    ``,
    `🪙 Coin: +200`,
    `⚡ Lightning: +500 (clears screen)`,
    `📈 Green candle: +200 + Shield`,
    `💀 FUD Skull: Game Over`,
    ``,
    `Play at your own risk. Stay unstable. 💛⚡`,
  ].join("\n");
  bot.sendMessage(msg.chat.id, text, { parse_mode: "MarkdownV2" });
});

// === Leaderboard sender ===
async function sendTopList(msg, binUrl, title, limit = 10) {
  try {
    const scores = await getScores(binUrl);
    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, limit);
    if (!sorted.length) return bot.sendMessage(msg.chat.id, "No scores yet.");

    let text = `🏆 *${escapeMarkdown(title)}*\n\n`;
    sorted.forEach(([user, score], i) => {
      const rank = i + 1;
      const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : " ";
      const safeUser = escapeMarkdown(user.startsWith("@") ? user : "@" + user);
      text += `${medal} ${rank}\\. ${safeUser}: ${score}\n`;
    });

    await bot.sendMessage(msg.chat.id, text, { parse_mode: "MarkdownV2" });
  } catch (err) {
    console.error("⚠️ Leaderboard send failed:", err.message);
    bot.sendMessage(msg.chat.id, "⚠️ Failed to load leaderboard.");
  }
}

bot.onText(/\/top10/, (msg) => sendTopList(msg, MAIN_BIN_URL, "Top 10 FUD Dodgers", 10));
bot.onText(/\/eventtop/, (msg) => sendTopList(msg, EVENT_BIN_URL, "Event Leaderboard (Top 10)", 10));
bot.onText(/\/eventtop50/, (msg) => sendTopList(msg, EVENT_BIN_URL, "Event Leaderboard (Top 50)", 50));

// === /resetevent command (admin only, confirmation) ===
bot.onText(/\/resetevent/, async (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;
  const ADMIN_USERS = ["UnstablecoinX"]; // change this!

  if (!ADMIN_USERS.includes(msg.from.username)) {
    return bot.sendMessage(chatId, "⛔ You’re not authorized to reset the leaderboard.");
  }

  await bot.sendMessage(
    chatId,
    "⚠️ Are you sure you want to reset the *Event Leaderboard*?\n\nReply with `YES RESET` to confirm.",
    { parse_mode: "MarkdownV2" }
  );

  bot.once("message", async (response) => {
    if (response.chat.id !== chatId || response.from.username !== msg.from.username) return;
    if (response.text && response.text.trim().toUpperCase() === "YES RESET") {
      try {
        await axios.post(`${WEBHOOK_URL}/resetevent`, { key: process.env.RESET_KEY });
        await bot.sendMessage(chatId, "🧹 Event leaderboard has been *reset successfully*.", { parse_mode: "MarkdownV2" });
      } catch (err) {
        console.error("❌ Reset failed:", err.message);
        await bot.sendMessage(chatId, "⚠️ Reset failed\\. Check logs or try again later\\.", { parse_mode: "MarkdownV2" });
      }
    } else {
      await bot.sendMessage(chatId, "❎ Reset cancelled.", { parse_mode: "MarkdownV2" });
    }
  });
});

// === Game launch ===
bot.onText(/\/play/, (msg) => {
  bot.sendGame(msg.chat.id, "US_FUD_Dodge");
});

bot.on("callback_query", (query) => {
  if (query.game_short_name === "US_FUD_Dodge") {
    bot.answerCallbackQuery({
      callback_query_id: query.id,
      url: "https://theunstable.io/fuddodge",
    });
  }
});

// === Web root ===
app.get("/", (req, res) => {
  res.send(`
    <h1>🎮 UnStableCoin FUD Dodge Bot</h1>
    <p>Bot running with dual leaderboards + Telegram integration.</p>
    <ul>
      <li>GET /leaderboard</li>
      <li>GET /eventtop</li>
      <li>POST /submit</li>
      <li>POST /resetevent?key=RESET_KEY</li>
    </ul>
  `);
});

// === Start server ===
const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 UnStableCoinBot webhook listening on port ${PORT}`);
});
