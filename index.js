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
const JSONBIN_ID = process.env.JSONBIN_ID;
const JSONBIN_KEY = process.env.JSONBIN_KEY;

if (!token || !JSONBIN_ID || !JSONBIN_KEY) {
  console.error("❌ Missing environment variables (TOKEN / JSONBIN_ID / JSONBIN_KEY)");
  process.exit(1);
}

// === Telegram bot + webserver ===
const bot = new TelegramBot(token, { polling: true });
const app = express();
app.use(cors({ origin: "*" }));
app.use(bodyParser.json());

// === JSONBin config ===
const BIN_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_ID}`;

// === Helper functions ===
async function getScores() {
  try {
    const res = await axios.get(BIN_URL, {
      headers: { "X-Master-Key": JSONBIN_KEY }
    });
    return res.data.record || {};
  } catch (err) {
    console.error("⚠️ Failed to fetch scores:", err.message);
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
    console.error("⚠️ Failed to save scores:", err.message);
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

app.post("/submit", async (req, res) => {
  const { username, score } = req.body;
  if (!username || typeof score !== "number") {
    return res.status(400).json({ error: "Missing username or score" });
  }

  const scores = await getScores();
  if (!scores[username] || score > scores[username]) {
    scores[username] = score;
    await saveScores(scores);
  }

  res.json({ success: true, message: "Score saved", username, score });
});

// === Telegram commands ===
bot.onText(/\/start/, (msg) => {
  const user = msg.from.username ? `@${msg.from.username}` : msg.from.first_name || "player";
  const text = [
    `💛 Welcome, ${user}!`,
    ``,
    `This is the *UnStableCoin FUD Dodge* bot.`,
    ``,
    `🚀 Commands:`,
    `/play – Launch the FUD Dodge mini-game`,
    `/top10 – See the top 10 players`,
    `/rules – Learn how to play and score`,
    `/help – Show available commands`
  ].join("\n");

  bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
});

bot.onText(/\/help/, (msg) => {
  const text = [
    `🧭 Available commands:`,
    `/play – Launch the FUD Dodge mini-game`,
    `/top10 – See the top 10 players`,
    `/rules – Learn how to play and score`,
    `/help – Show available commands`
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
  const sorted = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  if (!sorted.length) {
    bot.sendMessage(msg.chat.id, "No scores yet. Be the first one to dodge FUD!");
    return;
  }

  let text = "🏆 *Top 10 FUD Dodgers*\n\n";
  sorted.forEach(([user, score], i) => {
    const rank = i + 1;
    const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : " ";
    text += `${medal} ${rank}. ${user}: ${score}\n`;
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
      <li>GET /leaderboard - View top 10 scores</li>
      <li>POST /submit - Submit a score (JSON: {username, score})</li>
    </ul>
  `);
});

// === Start server ===
const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 UnStableCoinBot running on port ${PORT}`);
});
