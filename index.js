// === UnStableCoin Leaderboard + Game API ===
// by UnStableCoin community ⚡

// --- Modules ---
const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const TelegramBot = require("node-telegram-bot-api");
const cors = require("cors");
require("dotenv").config();

// --- Telegram Bot Token ---
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("❌ TELEGRAM_BOT_TOKEN saknas i Secrets!");
  process.exit(1);
}

// --- Start bot + webserver ---
const bot = new TelegramBot(token, { polling: true });
const app = express();
app.use(cors({ origin: "*" }));
app.use(bodyParser.json());

// --- Lokal poänglagring ---
let scores = {};
if (fs.existsSync("scores.json")) {
  scores = JSON.parse(fs.readFileSync("scores.json"));
}
function saveScores() {
  fs.writeFileSync("scores.json", JSON.stringify(scores, null, 2));
}

// --- Visa leaderboard i JSON (kan användas senare) ---
app.get("/leaderboard", (req, res) => {
  const sorted = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  res.json(sorted.map(([username, score]) => ({ username, score })));
});

app.get("/top10", (req, res) => {
  const sorted = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([username, score]) => ({ username, score }));
  res.json(sorted);
});

// --- Telegram-kommandon ---
bot.onText(/\/start/, (msg) => {
  const user = msg.from.username || msg.from.first_name;
  bot.sendMessage(
    msg.chat.id,
    `💛 Welcome, ${user}!\n\nThis is the *UnStableCoin FUD Dodge* leaderboard bot.\n\nCommands:\n/score <number> – submit manually\n/top10 – see the best players\n/daily – see today’s top scorers`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/score (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || msg.from.first_name || "Unknown";
  const score = parseInt(match[1]);

  if (isNaN(score)) {
    bot.sendMessage(chatId, "Please send a valid number. Example: /score 2500");
    return;
  }

  if (!scores[username] || score > scores[username]) {
    scores[username] = score;
    saveScores();
    bot.sendMessage(chatId, `✅ Score saved! ${username}: ${score}`);
  } else {
    bot.sendMessage(chatId, `Your high score is still ${scores[username]}.`);
  }
});

bot.onText(/\/top10/, (msg) => {
  const sorted = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  let text = "🏆 *Top 10 FUD Dodgers*\n\n";
  sorted.forEach(([user, score], i) => {
    text += `${i + 1}. ${user}: ${score}\n`;
  });
  bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
});

bot.onText(/\/daily/, (msg) => {
  const today = new Date().toISOString().slice(0, 10);
  const dailyFile = `daily-${today}.json`;
  let dailyScores = {};
  if (fs.existsSync(dailyFile)) {
    dailyScores = JSON.parse(fs.readFileSync(dailyFile));
  }

  const sorted = Object.entries(dailyScores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  let text = `📅 *Daily Top – ${today}*\n\n`;
  sorted.forEach(([user, score], i) => {
    text += `${i + 1}. ${user}: ${score}\n`;
  });
  bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
});

// --- Spara dagens poäng separat ---
function recordDaily(username, score) {
  const today = new Date().toISOString().slice(0, 10);
  const dailyFile = `daily-${today}.json`;
  let dailyScores = {};
  if (fs.existsSync(dailyFile)) {
    dailyScores = JSON.parse(fs.readFileSync(dailyFile));
  }
  if (!dailyScores[username] || score > dailyScores[username]) {
    dailyScores[username] = score;
    fs.writeFileSync(dailyFile, JSON.stringify(dailyScores, null, 2));
  }
}

// När någon postar via /submit
app.post("/submit", (req, res) => {
  const { username, score } = req.body;
  if (!username || typeof score !== "number") {
    return res.status(400).json({ error: "Missing username or score" });
  }

  if (!scores[username] || score > scores[username]) {
    scores[username] = score;
    saveScores();
    recordDaily(username, score);
  }

  res.json({ success: true, message: "Score saved", username, score });
});

// --- Simple homepage ---
app.get("/", (req, res) => {
  res.send(`
    <h1>🎮 UnStableCoin FUD Dodge - Leaderboard Bot</h1>
    <p>Bot is running!</p>
    <h3>API Endpoints:</h3>
    <ul>
      <li>GET /leaderboard - View top 10 scores</li>
      <li>POST /submit - Submit a score (requires username and score in JSON)</li>
    </ul>
    <h3>Telegram Bot:</h3>
    <p>Chat with the bot on Telegram for commands like /start, /score, /top10, /daily</p>
  `);
});

// === Handle inline game query ===
app.post("/inline", (req, res) => {
  try {
    const { id } = req.body; // Telegram inline query ID
    res.json({
      inline_query_id: id,
      results: [
        {
          type: "game",
          id: "unstable_fud_dodge",
          game_short_name: "US_FUD_Dodge"
        }
      ]
    });
  } catch (err) {
    console.error("Inline query error:", err);
    res.status(500).send("Error handling inline query");
  }
});

// --- Start servern ---
const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 UnStableCoinBot running on port ${PORT}`);
});