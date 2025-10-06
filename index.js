// === UnStableCoin Leaderboard + Game API ===
// by UnStableCoin community ⚡

const express = require("express");
const bodyParser = require("body-parser");
const TelegramBot = require("node-telegram-bot-api");
const cors = require("cors");
const axios = require("axios");
require("dotenv").config();

// === Environment ===
const token = process.env.TELEGRAM_BOT_TOKEN;
const JSONBIN_ID = process.env.JSONBIN_ID;               // Main leaderboard
const JSONBIN_KEY = process.env.JSONBIN_KEY;
const EVENT_BIN_ID = "68e3f30f43b1c97be95c96f7";         // Event leaderboard (ny)
const BIN_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_ID}`;
const EVENT_BIN_URL = `https://api.jsonbin.io/v3/b/${EVENT_BIN_ID}`;

if (!token || !JSONBIN_ID || !JSONBIN_KEY) {
  console.error("❌ Missing environment variables (TOKEN / JSONBIN_ID / JSONBIN_KEY)");
  process.exit(1);
}

// === Express setup ===
const app = express();
app.use(cors({ origin: "*" }));
app.use(bodyParser.json());

// === Helper functions ===
async function getScores() {
  try {
    const res = await axios.get(BIN_URL, {
      headers: { "X-Master-Key": JSONBIN_KEY }
    });
    return res.data.record || {};
  } catch (err) {
    console.error("⚠️ Failed to fetch main scores:", err.message);
    return {};
  }
}

async function getEventScores() {
  try {
    const res = await axios.get(EVENT_BIN_URL, {
      headers: { "X-Master-Key": JSONBIN_KEY }
    });
    return res.data.record || {};
  } catch (err) {
    console.error("⚠️ Failed to fetch event scores:", err.message);
    return {};
  }
}

async function saveScores(scores) {
  try {
    await axios.put(BIN_URL, scores, {
      headers: {
        "Content-Type": "application/json",
        "X-Master-Key": JSONBIN_KEY
      }
    });
  } catch (err) {
    console.error("⚠️ Failed to save main scores:", err.message);
  }
}

async function saveEventScores(scores) {
  try {
    await axios.put(EVENT_BIN_URL, scores, {
      headers: {
        "Content-Type": "application/json",
        "X-Master-Key": JSONBIN_KEY
      }
    });
  } catch (err) {
    console.error("⚠️ Failed to save event scores:", err.message);
  }
}

// === REST endpoints ===
app.get("/leaderboard", async (req, res) => {
  const scores = await getScores();
  const sorted = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  res.json(sorted.map(([username, score]) => ({ username, score })));
});

app.get("/top10", async (req, res) => {
  const scores = await getScores();
  const sorted = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([username, score]) => ({ username, score }));
  res.json(sorted);
});

// === Event leaderboard endpoints ===
app.get("/event/top10", async (req, res) => {
  const scores = await getEventScores();
  const sorted = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([username, score]) => ({ username, score }));
  res.json(sorted);
});

app.get("/event/top100", async (req, res) => {
  const scores = await getEventScores();
  const sorted = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 100)
    .map(([username, score]) => ({ username, score }));
  res.json(sorted);
});

// === Submit score ===
app.post("/submit", async (req, res) => {
  let { username, score } = req.body;
  if (!username || typeof score !== "number") {
    return res.status(400).json({ error: "Missing username or score" });
  }

  // Normalize username (remove duplicate @)
  username = username.trim().replace(/^@+/, "@");

  const [mainScores, eventScores] = await Promise.all([
    getScores(),
    getEventScores()
  ]);

  // Main leaderboard update
  if (!mainScores[username] || score > mainScores[username]) {
    mainScores[username] = score;
    await saveScores(mainScores);
  }

  // Event leaderboard update (always records even if smaller)
  if (!eventScores[username] || score > eventScores[username]) {
    eventScores[username] = score;
    await saveEventScores(eventScores);
  }

  res.json({ success: true, message: "Score saved", username, score });
});

// === Telegram Bot Setup (Webhook mode for Render) ===
const bot = new TelegramBot(token);
const url = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`;
bot.setWebHook(`${url}/bot${token}`);

app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// === Telegram Commands ===
bot.onText(/\/start/, (msg) => {
  const user = msg.from.username ? `@${msg.from.username}` : msg.from.first_name || "player";
  const text = [
    `💛 Welcome, ${user}!`,
    ``,
    `This is the *UnStableCoin FUD Dodge* bot.`,
    ``,
    `🚀 Commands:`,
    `/play – Launch the FUD Dodge mini-game`,
    `/top10 – See the top 10 (Main)`,
    `/eventtop10 – Event Top 10`,
    `/eventtop100 – Event Top 100`,
    `/rules – Learn how to play`,
    `/help – Show commands`
  ].join("\n");

  bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
});

bot.onText(/\/help/, (msg) => {
  const text = [
    `🧭 Commands:`,
    `/play – Launch the FUD Dodge mini-game`,
    `/top10 – Main Top 10`,
    `/eventtop10 – Event Top 10`,
    `/eventtop100 – Event Top 100`,
    `/rules – How to play`,
    `/help – Show commands`
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
    `Scoring:`,
    `🪙 Coin: +200`,
    `⚡ Lightning: +500 (clears screen)`,
    `📈 Green candle: +200 + Shield`,
    `💀 FUD Skull: Game Over`,
    ``,
    `Play at your own risk. Stay unstable. 💛⚡`
  ].join("\n");
  bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
});

bot.onText(/\/top10/, async (msg) => {
  const scores = await getScores();
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 10);

  if (!sorted.length) return bot.sendMessage(msg.chat.id, "No scores yet. Be the first!");

  let text = "🏆 *Top 10 – Legends Leaderboard*\n\n";
  sorted.forEach(([user, score], i) => {
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : " ";
    text += `${medal} ${i + 1}. ${user}: ${score}\n`;
  });
  bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
});

bot.onText(/\/eventtop10/, async (msg) => {
  const scores = await getEventScores();
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 10);

  if (!sorted.length) return bot.sendMessage(msg.chat.id, "No event scores yet.");

  let text = "⚡ *Event Top 10*\n\n";
  sorted.forEach(([user, score], i) => {
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : " ";
    text += `${medal} ${i + 1}. ${user}: ${score}\n`;
  });
  bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
});

bot.onText(/\/eventtop100/, async (msg) => {
  const scores = await getEventScores();
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 100);

  if (!sorted.length) return bot.sendMessage(msg.chat.id, "No event scores yet.");

  let text = "💥 *Event Top 100*\n\n";
  sorted.forEach(([user, score], i) => {
    text += `${i + 1}. ${user}: ${score}\n`;
  });
  bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
});

bot.onText(/\/play/, (msg) => {
  bot.sendGame(msg.chat.id, "US_FUD_Dodge");
});

// === Inline game callback ===
bot.on("callback_query", (query) => {
  if (query.game_short_name === "US_FUD_Dodge") {
    bot.answerCallbackQuery({
      callback_query_id: query.id,
      url: "https://theunstable.io/fuddodge"
    });
  }
});

// === Web root ===
app.get("/", (req, res) => {
  res.send(`
    <h1>🎮 UnStableCoin FUD Dodge - Leaderboard Bot</h1>
    <p>Bot is running and connected to JSONBin storage.</p>
    <h3>API Endpoints:</h3>
    <ul>
      <li>GET /leaderboard - Main Top 10</li>
      <li>GET /event/top10 - Event Top 10</li>
      <li>GET /event/top100 - Event Top 100</li>
      <li>POST /submit - Submit a score (JSON: {username, score})</li>
    </ul>
  `);
});

// === Start server ===
const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 UnStableCoinBot webhook listening on port ${PORT}`);
});
