// === UnStableCoin Leaderboard + Game API ===
// by UnStableCoin community ⚡

const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const TelegramBot = require("node-telegram-bot-api");
const cors = require("cors");
require("dotenv").config();

// --- Telegram Bot Token ---
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("❌ TELEGRAM_BOT_TOKEN missing in Secrets!");
  process.exit(1);
}

// --- Start bot + webserver ---
const bot = new TelegramBot(token, { polling: true });
const app = express();
app.use(cors({ origin: "*" }));
app.use(bodyParser.json());

// --- Local score storage ---
let scores = {};
if (fs.existsSync("scores.json")) {
  scores = JSON.parse(fs.readFileSync("scores.json"));
}
function saveScores() {
  fs.writeFileSync("scores.json", JSON.stringify(scores, null, 2));
}

// --- REST endpoints ---
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

app.post("/submit", (req, res) => {
  const { username, score } = req.body;
  if (!username || typeof score !== "number") {
    return res.status(400).json({ error: "Missing username or score" });
  }

  if (!scores[username] || score > scores[username]) {
    scores[username] = score;
    saveScores();
  }

  res.json({ success: true, message: "Score saved", username, score });
});

// --- Telegram Commands ---
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

// --- Inline Game Callback ---
bot.on("callback_query", (query) => {
  if (query.game_short_name === "US_FUD_Dodge") {
    bot.answerCallbackQuery({
      callback_query_id: query.id,
      url: "https://theunstable.io/fuddodge"
    });
  }
});

// --- Web root ---
app.get("/", (req, res) => {
  res.send(`
    <h1>🎮 UnStableCoin FUD Dodge - Leaderboard Bot</h1>
    <p>Bot is running and connected.</p>
    <h3>API Endpoints:</h3>
    <ul>
      <li>GET /leaderboard - View top 10 scores</li>
      <li>POST /submit - Submit a score (JSON: {username, score})</li>
    </ul>
  `);
});

// --- Start server ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 UnStableCoinBot running on port ${PORT}`);
});
