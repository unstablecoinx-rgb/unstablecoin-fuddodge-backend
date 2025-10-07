// === UnStableCoin Leaderboard Bot ===
// ⚡ Version: Production Ready (Render + Telegram + JSONBin)
// Author: UnStableCoin Community
// ------------------------------------

const express = require("express");
const bodyParser = require("body-parser");
const TelegramBot = require("node-telegram-bot-api");
const cors = require("cors");
const axios = require("axios");
require("dotenv").config();

// === ENVIRONMENT SETUP ===
const token = process.env.TELEGRAM_BOT_TOKEN;
const JSONBIN_ID = process.env.JSONBIN_ID;
const EVENT_JSONBIN_ID = process.env.EVENT_JSONBIN_ID;
const JSONBIN_KEY = process.env.JSONBIN_KEY;
const RESET_KEY = process.env.RESET_KEY;

if (!token || !JSONBIN_ID || !EVENT_JSONBIN_ID || !JSONBIN_KEY) {
  console.error("❌ Missing environment variables!");
  process.exit(1);
}

// Authorized Telegram usernames (lowercase, no @)
const ADMIN_USERS = ["unstablecoinx", "unstablecoinx_bot"];

// === EXPRESS CONFIG ===
const app = express();
app.use(cors({ origin: "*" }));
app.use(bodyParser.json());

// === JSONBin URLs ===
const MAIN_BIN_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_ID}`;
const EVENT_BIN_URL = `https://api.jsonbin.io/v3/b/${EVENT_JSONBIN_ID}`;

// === JSONBin Helper Functions ===
async function getScores(binUrl) {
  try {
    const res = await axios.get(`${binUrl}/latest`, {
      headers: { "X-Master-Key": JSONBIN_KEY },
    });
    return res.data.record || {};
  } catch (err) {
    console.error("⚠️ Failed to fetch scores:", err.response?.data || err.message);
    return {};
  }
}

async function saveScores(binUrl, scores) {
  try {
    const safeData = Object.keys(scores).length ? scores : { _reset: true };
    await axios.put(binUrl, safeData, {
      headers: {
        "Content-Type": "application/json",
        "X-Master-Key": JSONBIN_KEY,
      },
    });
  } catch (err) {
    console.error("⚠️ Failed to save scores:", err.response?.data || err.message);
  }
}

// === REST ENDPOINTS ===
app.get("/leaderboard", async (req, res) => {
  const scores = await getScores(MAIN_BIN_URL);
  const sorted = Object.entries(scores)
    .filter(([u, s]) => typeof s === "number" && !u.startsWith("_"))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  res.json(sorted.map(([username, score]) => ({ username, score })));
});

app.get("/eventtop", async (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const scores = await getScores(EVENT_BIN_URL);
  const sorted = Object.entries(scores)
    .filter(([u, s]) => typeof s === "number" && !u.startsWith("_"))
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
  res.json(sorted.map(([username, score]) => ({ username, score })));
});

app.post("/submit", async (req, res) => {
  let { username, score } = req.body;
  if (!username || typeof score !== "number") {
    return res.status(400).json({ error: "Missing username or score" });
  }

  username = "@" + username.replace(/^@+/, ""); // normalize @

  const mainScores = await getScores(MAIN_BIN_URL);
  const eventScores = await getScores(EVENT_BIN_URL);

  if (!mainScores[username] || score > mainScores[username])
    mainScores[username] = score;
  if (!eventScores[username] || score > eventScores[username])
    eventScores[username] = score;

  await saveScores(MAIN_BIN_URL, mainScores);
  await saveScores(EVENT_BIN_URL, eventScores);

  res.json({ success: true, message: "Score saved", username, score });
});

// === RESET EVENT LEADERBOARD ===
app.post("/resetevent", async (req, res) => {
  const key = req.query.key || req.body.key;
  const user = req.body.username || "unknown";

  if (key !== RESET_KEY) {
    console.warn(`🚫 Unauthorized reset attempt by ${user}`);
    return res.status(403).json({ error: "Invalid or missing RESET_KEY" });
  }

  try {
    await saveScores(EVENT_BIN_URL, {});
    console.log("🧹 Event leaderboard reset successfully!");
    res.json({ success: true, message: "Event leaderboard has been reset" });
  } catch (err) {
    console.error("⚠️ Failed to reset leaderboard:", err.message);
    res.status(500).json({ error: "Failed to reset leaderboard" });
  }
});

// === TELEGRAM BOT SETUP ===
const bot = new TelegramBot(token, { webHook: true });

// ✅ Explicit webhook URL (Render sometimes omits hostname)
const url = "https://unstablecoin-fuddodge-backend.onrender.com";
bot.setWebHook(`${url}/bot${token}`);
console.log(`✅ Webhook set to: ${url}/bot${token}`);

// === Webhook handler ===
app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// === TELEGRAM COMMAND HELPERS ===
async function sendTopList(msg, binUrl, title, limit = 10) {
  const scores = await getScores(binUrl);
  const sorted = Object.entries(scores)
    .filter(([u, s]) => typeof s === "number" && !u.startsWith("_"))
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  if (!sorted.length)
    return bot.sendMessage(msg.chat.id, "No scores yet. Play the game to appear here!");

  let text = `🏆 *${title}*\n\n`;
  sorted.forEach(([user, score], i) => {
    const rank = i + 1;
    const medal =
      rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `${rank}.`;
    text += `${medal} ${user} — ${score}\n`;
  });

  bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
}

// === TELEGRAM COMMANDS ===
bot.onText(/\/start/, (msg) => {
  const text = `
💛 *Welcome to UnStableCoin FUD Dodge!*

🚀 Commands:
/play – Launch the FUD Dodge mini-game
/top10 – Main leaderboard
/eventtop – Event leaderboard (Top 10)
/eventtop50 – Event leaderboard (Top 50)
/resetevent – Admin only (reset event list)
/help – Show this menu
  `;
  bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
});

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "🧭 Available commands:\n/play\n/top10\n/eventtop\n/eventtop50\n/resetevent (admin only)"
  );
});

bot.onText(/\/top10$/, (msg) =>
  sendTopList(msg, MAIN_BIN_URL, "Main Leaderboard", 10)
);
bot.onText(/\/eventtop$/, (msg) =>
  sendTopList(msg, EVENT_BIN_URL, "Event Leaderboard", 10)
);
bot.onText(/\/eventtop50$/, (msg) =>
  sendTopList(msg, EVENT_BIN_URL, "Event Leaderboard (Top 50)", 50)
);

// === RESET EVENT VIA TELEGRAM ===
bot.onText(/\/resetevent$/, async (msg) => {
  const user = (msg.from.username || "").toLowerCase();
  if (!ADMIN_USERS.includes(user)) {
    return bot.sendMessage(msg.chat.id, "⛔ You’re not authorized to reset the leaderboard.");
  }

  bot.sendMessage(msg.chat.id, "⚠️ Confirm reset? Type *YES RESET* to continue.", {
    parse_mode: "Markdown",
  });

  bot.once("message", async (response) => {
    if (response.text.trim().toUpperCase() === "YES RESET") {
      await saveScores(EVENT_BIN_URL, {});
      bot.sendMessage(msg.chat.id, "🧹 Event leaderboard has been reset!");
    } else {
      bot.sendMessage(msg.chat.id, "❎ Reset cancelled.");
    }
  });
});

// === TELEGRAM GAME CALLBACK ===
bot.onText(/\/play/, (msg) => bot.sendGame(msg.chat.id, "US_FUD_Dodge"));
bot.on("callback_query", (query) => {
  if (query.game_short_name === "US_FUD_Dodge") {
    bot.answerCallbackQuery({
      callback_query_id: query.id,
      url: "https://theunstable.io/fuddodge",
    });
  }
});

// === ROOT PAGE ===
app.get("/", (req, res) => {
  res.send(`
    <h1>🎮 UnStableCoin FUD Dodge Bot</h1>
    <p>Status: Online ✅</p>
    <p>Connected to JSONBin and Telegram webhook.</p>
    <ul>
      <li>GET /leaderboard</li>
      <li>GET /eventtop</li>
      <li>POST /submit</li>
      <li>POST /resetevent?key=RESET_KEY</li>
    </ul>
  `);
});

// === START SERVER ===
const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 UnStableCoinBot running on port ${PORT}`);
});
