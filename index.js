// === UnStableCoin Leaderboard Bot ===
// ⚡ Version: HTML-safe + Production Ready
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
const RESET_KEY = process.env.RESET_KEY;

if (!token || !JSONBIN_ID || !EVENT_JSONBIN_ID || !JSONBIN_KEY) {
  console.error("❌ Missing environment variables!");
  process.exit(1);
}

// === SETTINGS ===
const ADMIN_USERS = ["unstablecoinx", "unstablecoinx_bot"]; // lowercase usernames
const app = express();
app.use(cors({ origin: "*" }));
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
  res.send("💛 UnStableCoinBot is online and unstable as ever.");
});

// === HELPER FUNCTIONS ===

// Use HTML-safe mode (no Markdown escaping needed)
async function sendSafeMessage(chatId, message) {
  try {
    await bot.sendMessage(chatId, message, { parse_mode: "HTML" });
  } catch (err) {
    console.error("❌ Telegram send failed:", err.message);
  }
}

// Load leaderboard data
async function getLeaderboard() {
  try {
    const response = await axios.get(MAIN_BIN_URL, {
      headers: { "X-Master-Key": JSONBIN_KEY },
    });
    return response.data.record || {};
  } catch (err) {
    console.error("❌ Error loading leaderboard:", err.message);
    return {};
  }
}

// Update leaderboard entry
async function updateLeaderboard(username, score) {
  try {
    const data = await getLeaderboard();
    data[username] = score;
    await axios.put(
      MAIN_BIN_URL,
      { ...data },
      { headers: { "Content-Type": "application/json", "X-Master-Key": JSONBIN_KEY } }
    );
    console.log(`✅ Updated score for ${username}: ${score}`);
  } catch (err) {
    console.error("❌ Error updating leaderboard:", err.message);
  }
}

// === TELEGRAM COMMANDS ===

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const user = msg.from.username || msg.from.first_name || "anonymous";
  const welcome = `
💛 <b>Welcome to the UnStableCoin Leaderboard Bot</b>  
You can check your rank, submit scores, and see event updates.

Commands:
• /rank – Show leaderboard
• /event – Current community challenge
• /submit [score] – Submit your latest score
• /about – Learn what this chaos is about
`;
  await sendSafeMessage(chatId, welcome);
});

bot.onText(/\/about/, async (msg) => {
  const chatId = msg.chat.id;
  const about = `
<b>UnStableCoin ($US)</b>  
A cultural experiment on Solana.  
Born without presale. Built by chaos, memes, and belief.  

Learn more:  
🌐 <a href="https://theunstable.io">theunstable.io</a>  
🐦 <a href="https://x.com/UnStableCoinX">@UnStableCoinX</a>  
💬 <a href="https://t.me/UnStableCoin_US">Telegram Community</a>  
`;
  await sendSafeMessage(chatId, about);
});

bot.onText(/\/rank/, async (msg) => {
  const chatId = msg.chat.id;
  const data = await getLeaderboard();
  const sorted = Object.entries(data).sort((a, b) => b[1] - a[1]);
  let message = "<b>🏆 Current Leaderboard</b>\n\n";
  sorted.slice(0, 10).forEach(([user, score], i) => {
    message += `${i + 1}. <b>${user}</b> – ${score} pts\n`;
  });
  await sendSafeMessage(chatId, message);
});

bot.onText(/\/submit (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const user = msg.from.username?.toLowerCase() || msg.from.first_name || "anonymous";
  const score = parseInt(match[1]);
  if (isNaN(score)) {
    return sendSafeMessage(chatId, "❌ Please submit a valid score, e.g. /submit 42");
  }
  await updateLeaderboard(user, score);
  await sendSafeMessage(chatId, `✅ Score updated for <b>${user}</b>: ${score} pts`);
});

bot.onText(/\/event/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const response = await axios.get(EVENT_BIN_URL, {
      headers: { "X-Master-Key": JSONBIN_KEY },
    });
    const event = response.data.record?.event || "No active event right now.";
    await sendSafeMessage(chatId, `<b>🎯 Current Event</b>\n\n${event}`);
  } catch (err) {
    await sendSafeMessage(chatId, "⚠️ Could not fetch current event info.");
  }
});

// === SERVER START ===
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 UnStableCoinBot running on port ${PORT}`);
});
