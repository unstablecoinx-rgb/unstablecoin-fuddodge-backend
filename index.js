// === UnStableCoin Leaderboard + Game API ===
// by UnStableCoin community ⚡
// Version: dual-leaderboard + reset event + Markdown fix

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
const RESET_KEY = process.env.RESET_KEY;               // For protection

if (!token || !JSONBIN_ID || !EVENT_JSONBIN_ID || !JSONBIN_KEY) {
  console.error("❌ Missing environment variables (TOKEN / JSONBIN_ID / EVENT_JSONBIN_ID / JSONBIN_KEY)");
  process.exit(1);
}

// === Admin usernames ===
const ADMIN_USERS = ["UnstablecoinX", "unstablecoinx"]; // no @ — case-insensitive

// === Express setup ===
const app = express();
app.use(cors({ origin: "*" }));
app.use(bodyParser.json());

// === JSONBin config ===
const MAIN_BIN_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_ID}`;
const EVENT_BIN_URL = `https://api.jsonbin.io/v3/b/${EVENT_JSONBIN_ID}`;

// === Helper functions ===
async function getScores(binUrl) {
  try {
    const res = await axios.get(binUrl, {
      headers: { "X-Master-Key": JSONBIN_KEY }
    });
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
        "X-Master-Key": JSONBIN_KEY
      }
    });
  } catch (err) {
    console.error("⚠️ Failed to save scores:", err.message);
  }
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

  // Normalize username — remove extra @ and lowercase check
  username = username.replace(/^@+/, "@");

  const mainScores = await getScores(MAIN_BIN_URL);
  const eventScores = await getScores(EVENT_BIN_URL);

  if (!mainScores[username] || score > mainScores[username]) mainScores[username] = score;
  if (!eventScores[username] || score > eventScores[username]) eventScores[username] = score;

  await saveScores(MAIN_BIN_URL, mainScores);
  await saveScores(EVENT_BIN_URL, eventScores);

  res.json({ success: true, message: "Score saved to both leaderboards", username, score });
});

// === Reset event leaderboard (admin + confirm) ===
app.post("/resetevent", async (req, res) => {
  const key = req.query.key || req.body.key;
  if (key !== RESET_KEY) return res.status(403).json({ error: "Invalid RESET_KEY" });

  await saveScores(EVENT_BIN_URL, {});
  console.log("🧹 Event leaderboard reset!");
  res.json({ success: true, message: "Event leaderboard reset" });
});

// === Telegram Bot Setup ===
const bot = new TelegramBot(token, { webHook: true });
const url = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`;
bot.setWebHook(`${url}/bot${token}`);

app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// === Helper for top lists ===
async function sendTopList(msg, binUrl, title, limit = 10) {
  const scores = await getScores(binUrl);
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, limit);
  if (!sorted.length) return bot.sendMessage(msg.chat.id, "No scores yet.");

  let text = `🏆 ${title}\n\n`;
  sorted.forEach(([user, score], i) => {
    const rank = i + 1;
    const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : " ";
    text += `${medal} ${rank}. ${user}: ${score}\n`;
  });
  bot.sendMessage(msg.chat.id, text);
}

// === Telegram commands ===
bot.onText(/\/start/, (msg) => {
  const user = msg.from.username ? `@${msg.from.username}` : msg.from.first_name || "player";
  const text = [
    `💛 Welcome, ${user}!`,
    ``,
    `This is the UnStableCoin *FUD Dodge* bot.`,
    ``,
    `🚀 Commands:`,
    `/play – Launch the game`,
    `/top10 – Main leaderboard`,
    `/eventtop – Event leaderboard (Top 10)`,
    `/eventtop50 – Event leaderboard (Top 50)`,
    `/resetevent – (Admins only) Reset event leaderboard`,
    `/rules – How to play`,
    `/help – Show this list again`
  ].join("\n");

  bot.sendMessage(msg.chat.id, text);
});

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id, [
    `🧭 Available commands:`,
    `/play – Launch the game`,
    `/top10 – Main leaderboard`,
    `/eventtop – Event leaderboard (Top 10)`,
    `/eventtop50 – Event leaderboard (Top 50)`,
    `/rules – How to play`
  ].join("\n"));
});

bot.onText(/\/rules/, (msg) => {
  bot.sendMessage(msg.chat.id, [
    `🎮 How to Play`,
    `Dodge FUD and scams.`,
    `Collect coins, memes and green candles.`,
    `Avoid rugs and skulls.`,
    ``,
    `Scoring:`,
    `🪙 Coin +200`,
    `⚡ Lightning +500 (clears screen)`,
    `📈 Candle +200 + Shield`,
    `💀 Skull = Game Over`,
    ``,
    `Stay unstable. 💛⚡`
  ].join("\n"));
});

// === Leaderboard commands ===
bot.onText(/\/top10/, (msg) => sendTopList(msg, MAIN_BIN_URL, "Top 10 FUD Dodgers", 10));
bot.onText(/\/eventtop$/, (msg) => sendTopList(msg, EVENT_BIN_URL, "Event Leaderboard (Top 10)", 10));
bot.onText(/\/eventtop50$/, (msg) => sendTopList(msg, EVENT_BIN_URL, "Event Leaderboard (Top 50)", 50));

// === Reset command (admin only) ===
bot.onText(/\/resetevent/, async (msg) => {
  const user = msg.from.username?.toLowerCase() || "";
  if (!ADMIN_USERS.includes(user)) {
    return bot.sendMessage(msg.chat.id, "⛔ You’re not authorized to reset the leaderboard.");
  }

  bot.sendMessage(msg.chat.id, "⚠️ Are you sure you want to reset the Event Leaderboard?\nReply with YES RESET to confirm.");

  bot.once("message", async (response) => {
    if (response.text.trim().toUpperCase() === "YES RESET") {
      await saveScores(EVENT_BIN_URL, {});
      bot.sendMessage(msg.chat.id, "🧹 Event leaderboard has been reset successfully!");
    } else {
      bot.sendMessage(msg.chat.id, "❎ Reset cancelled.");
    }
  });
});

// === Play game ===
bot.onText(/\/play/, (msg) => bot.sendGame(msg.chat.id, "US_FUD_Dodge"));

// === Inline game callback ===
bot.on("callback_query", (query) => {
  if (query.game_short_name === "US_FUD_Dodge") {
    bot.answerCallbackQuery({
      callback_query_id: query.id,
      url: "https://theunstable.io/fuddodge"
    });
  }
});

// === Root info page ===
app.get("/", (req, res) => {
  res.send(`
    <h1>🎮 UnStableCoin FUD Dodge - Leaderboard Bot</h1>
    <p>Bot is running and connected to JSONBin storage.</p>
    <ul>
      <li>GET /leaderboard - Main leaderboard</li>
      <li>GET /eventtop - Event leaderboard</li>
      <li>POST /submit - Submit score</li>
      <li>POST /resetevent?key=RESET_KEY - Reset event leaderboard</li>
    </ul>
  `);
});

// === Start server ===
const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 UnStableCoinBot running on port ${PORT}`);
});
