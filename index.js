// === UnStableCoin Leaderboard Bot ===
// Version: JSONBin fix + reset safe
// ⚡ Built for Render deployment

const express = require("express");
const bodyParser = require("body-parser");
const TelegramBot = require("node-telegram-bot-api");
const cors = require("cors");
const axios = require("axios");
require("dotenv").config();

// === ENV ===
const token = process.env.TELEGRAM_BOT_TOKEN;
const JSONBIN_ID = process.env.JSONBIN_ID;
const EVENT_JSONBIN_ID = process.env.EVENT_JSONBIN_ID;
const JSONBIN_KEY = process.env.JSONBIN_KEY;
const RESET_KEY = process.env.RESET_KEY;

if (!token || !JSONBIN_ID || !EVENT_JSONBIN_ID || !JSONBIN_KEY) {
  console.error("❌ Missing environment variables!");
  process.exit(1);
}

const ADMIN_USERS = ["unstablecoinx", "unstablecoinx_bot"]; // lowercase usernames, no @

// === Express ===
const app = express();
app.use(cors({ origin: "*" }));
app.use(bodyParser.json());

// === JSONBin URLs ===
const MAIN_BIN_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_ID}`;
const EVENT_BIN_URL = `https://api.jsonbin.io/v3/b/${EVENT_JSONBIN_ID}`;

// === JSONBin Helpers ===
async function getScores(binUrl) {
  try {
    const res = await axios.get(`${binUrl}/latest`, {
      headers: { "X-Master-Key": JSONBIN_KEY }
    });
    return res.data.record || {};
  } catch (err) {
    console.error("⚠️ Failed to fetch scores:", err.response?.data || err.message);
    return {};
  }
}

async function saveScores(binUrl, scores) {
  try {
    const data = Object.keys(scores).length ? scores : { _reset: true };
    await axios.put(binUrl, data, {
      headers: {
        "Content-Type": "application/json",
        "X-Master-Key": JSONBIN_KEY
      }
    });
  } catch (err) {
    console.error("⚠️ Failed to save scores:", err.response?.data || err.message);
  }
}

// === REST Endpoints ===
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

app.post("/resetevent", async (req, res) => {
  const key = req.query.key || req.body.key;
  if (key !== RESET_KEY) return res.status(403).json({ error: "Invalid RESET_KEY" });

  await saveScores(EVENT_BIN_URL, {});
  console.log("🧹 Event leaderboard reset!");
  res.json({ success: true, message: "Event leaderboard reset" });
});

// === Telegram Setup ===
const bot = new TelegramBot(token, { webHook: true });
const url = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`;
bot.setWebHook(`${url}/bot${token}`);

app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// === Helpers ===
async function sendTopList(msg, binUrl, title, limit = 10) {
  const scores = await getScores(binUrl);
  const sorted = Object.entries(scores).filter(([u]) => !u.startsWith("_")).sort((a, b) => b[1] - a[1]).slice(0, limit);
  if (!sorted.length) return bot.sendMessage(msg.chat.id, "No scores yet.");

  let text = `🏆 ${title}\n\n`;
  sorted.forEach(([user, score], i) => {
    const rank = i + 1;
    const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : " ";
    text += `${medal} ${rank}. ${user}: ${score}\n`;
  });
  bot.sendMessage(msg.chat.id, text);
}

// === Commands ===
bot.onText(/\/top10/, (msg) => sendTopList(msg, MAIN_BIN_URL, "Main Leaderboard", 10));
bot.onText(/\/eventtop$/, (msg) => sendTopList(msg, EVENT_BIN_URL, "Event Leaderboard", 10));
bot.onText(/\/eventtop50$/, (msg) => sendTopList(msg, EVENT_BIN_URL, "Event Leaderboard (Top 50)", 50));

bot.onText(/\/resetevent/, async (msg) => {
  const user = (msg.from.username || "").toLowerCase();
  if (!ADMIN_USERS.includes(user)) {
    return bot.sendMessage(msg.chat.id, "⛔ You’re not authorized to reset the leaderboard.");
  }

  bot.sendMessage(msg.chat.id, "⚠️ Confirm reset? Type YES RESET to continue.");

  bot.once("message", async (response) => {
    if (response.text.trim().toUpperCase() === "YES RESET") {
      await saveScores(EVENT_BIN_URL, {});
      bot.sendMessage(msg.chat.id, "🧹 Event leaderboard has been reset!");
    } else {
      bot.sendMessage(msg.chat.id, "❎ Reset cancelled.");
    }
  });
});

bot.onText(/\/play/, (msg) => bot.sendGame(msg.chat.id, "US_FUD_Dodge"));
bot.on("callback_query", (query) => {
  if (query.game_short_name === "US_FUD_Dodge") {
    bot.answerCallbackQuery({
      callback_query_id: query.id,
      url: "https://theunstable.io/fuddodge"
    });
  }
});

// === Root page ===
app.get("/", (req, res) => {
  res.send(`
    <h1>🎮 UnStableCoin FUD Dodge Bot</h1>
    <p>Bot is online and connected to JSONBin.</p>
  `);
});

// === Start server ===
const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 UnStableCoinBot running on port ${PORT}`);
});
