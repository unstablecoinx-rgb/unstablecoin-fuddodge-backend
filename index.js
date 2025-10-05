// === UnStableCoin Leaderboard + Game API ===
// by UnStableCoin community ⚡
// Now using JSONBin.io for persistent storage

const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const fetch = require("node-fetch");
const TelegramBot = require("node-telegram-bot-api");
const cors = require("cors");
require("dotenv").config();

// --- ENV VARS ---
const token = process.env.TELEGRAM_BOT_TOKEN;
const BIN_ID = process.env.JSONBIN_ID;
const BIN_KEY = process.env.JSONBIN_KEY;

if (!token || !BIN_ID || !BIN_KEY) {
  console.error("❌ Missing TELEGRAM_BOT_TOKEN or JSONBIN credentials!");
  process.exit(1);
}

// --- Start bot + webserver ---
const bot = new TelegramBot(token, { polling: true });
const app = express();
app.use(cors({ origin: "*" }));
app.use(bodyParser.json());

// === Local cache ===
let scores = {};
const LOCAL_FILE = "scores.json";

// Try to load from local cache
if (fs.existsSync(LOCAL_FILE)) {
  try {
    scores = JSON.parse(fs.readFileSync(LOCAL_FILE));
  } catch (err) {
    console.error("⚠️ Failed to parse local scores.json:", err);
  }
}

// === JSONBin helper functions ===
async function loadFromJSONBin() {
  try {
    const res = await fetch(`https://api.jsonbin.io/v3/b/${BIN_ID}/latest`, {
      headers: {
        "X-Master-Key": BIN_KEY,
      },
    });
    const data = await res.json();
    if (data?.record) {
      scores = data.record;
      console.log("✅ Scores loaded from JSONBin:", Object.keys(scores).length, "entries");
      return true;
    }
  } catch (err) {
    console.error("⚠️ Could not load from JSONBin:", err.message);
  }
  return false;
}

async function saveToJSONBin() {
  try {
    const res = await fetch(`https://api.jsonbin.io/v3/b/${BIN_ID}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Master-Key": BIN_KEY,
      },
      body: JSON.stringify(scores, null, 2),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.log("✅ Scores saved to JSONBin");
  } catch (err) {
    console.error("⚠️ JSONBin save failed, writing local backup:", err.message);
    fs.writeFileSync(LOCAL_FILE, JSON.stringify(scores, null, 2));
  }
}

// === Initialize from JSONBin ===
loadFromJSONBin();

// === REST endpoints ===
app.get("/leaderboard", (req, res) => {
  const sorted = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([username, score]) => ({ username, score }));
  res.json(sorted);
});

app.get("/top10", (req, res) => {
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

  // Save only if higher
  if (!scores[username] || score > scores[username]) {
    scores[username] = score;
    await saveToJSONBin();
  }

  res.json({ success: true, message: "Score saved", username, score });
});

// === Telegram Bot Commands ===
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
    `/help – Show available commands`,
  ].join("\n");

  bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
});

bot.onText(/\/help/, (msg) => {
  const text = [
    `🧭 Available commands:`,
    `/play – Launch the FUD Dodge mini-game`,
    `/top10 – See the top 10 players`,
    `/rules – Learn how to play and score`,
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
    `Scoring:`,
    `🪙 Coin: +200`,
    `⚡ Lightning: +500 (clears screen)`,
    `📈 Green candle: +200 + Shield`,
    `💀 FUD Skull: Game Over`,
    ``,
    `Play at your own risk. Stay unstable. 💛⚡`,
  ].join("\n");
  bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
});

bot.onText(/\/top10/, (msg) => {
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

// === Inline Game Handler ===
bot.on("callback_query", (query) => {
  if (query.game_short_name === "US_FUD_Dodge") {
    bot.answerCallbackQuery({
      callback_query_id: query.id,
      url: "https://theunstable.io/fuddodge",
    });
  }
});

// === Root route ===
app.get("/", (req, res) => {
  res.send(`
    <h1>🎮 UnStableCoin FUD Dodge - Leaderboard API</h1>
    <p>Bot and server are running.</p>
    <h3>API:</h3>
    <ul>
      <li>GET /leaderboard – top 10 scores</li>
      <li>POST /submit – submit {username, score}</li>
    </ul>
  `);
});

// === Start server ===
const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 UnStableCoinBot running on port ${PORT}`);
});
