// === UnStableCoin Game Bot ===
// ⚡ Version: HTML-safe + All Commands Restored
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
const ADMIN_USERS = ["unstablecoinx", "unstablecoinx_bot"];
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
  res.send("💛 UnStableCoin Game Bot is online and unstable as ever.");
});

// === HELPERS ===
async function sendSafeMessage(chatId, message) {
  try {
    await bot.sendMessage(chatId, message, { parse_mode: "HTML", disable_web_page_preview: true });
  } catch (err) {
    console.error("❌ Telegram send failed:", err.message);
  }
}

async function getLeaderboard() {
  try {
    const res = await axios.get(MAIN_BIN_URL, { headers: { "X-Master-Key": JSONBIN_KEY } });
    return res.data.record || {};
  } catch (err) {
    console.error("❌ Error loading leaderboard:", err.message);
    return {};
  }
}

async function updateLeaderboard(username, score) {
  try {
    const data = await getLeaderboard();
    data[username] = score;
    await axios.put(MAIN_BIN_URL, data, {
      headers: { "Content-Type": "application/json", "X-Master-Key": JSONBIN_KEY },
    });
    console.log(`✅ Updated score for ${username}: ${score}`);
  } catch (err) {
    console.error("❌ Error updating leaderboard:", err.message);
  }
}

async function getEventData() {
  try {
    const res = await axios.get(EVENT_BIN_URL, { headers: { "X-Master-Key": JSONBIN_KEY } });
    return res.data.record || {};
  } catch (err) {
    console.error("❌ Error fetching event data:", err.message);
    return {};
  }
}

// === COMMANDS ===

// START / HELP
bot.onText(/\/start|\/help/, async (msg) => {
  const chatId = msg.chat.id;
  const text = `
<b>💛 Welcome to the UnStableCoin Game Bot</b>

Use the commands below to explore:
🎮 <b>/play</b> – Start the game
🏆 <b>/rank</b> or <b>/top10</b> – View leaderboard
📈 <b>/top50</b> – View top 50 players
🎯 <b>/event</b> – Check current event
🥇 <b>/eventtop</b> or <b>/eventtop50</b> – Event rankings
🧩 <b>/submit [score]</b> – Submit your score
ℹ️ <b>/about</b> – Learn more
`;
  await sendSafeMessage(chatId, text);
});

// PLAY
bot.onText(/\/play/, async (msg) => {
  const chatId = msg.chat.id;
  const text = `
🎮 <b>Play FUD Dodge</b>  
Tap below to launch the game:  
👉 <a href="https://theunstable.io/fuddodge">theunstable.io/fuddodge</a>
`;
  await sendSafeMessage(chatId, text);
});

// ABOUT
bot.onText(/\/about/, async (msg) => {
  const chatId = msg.chat.id;
  const text = `
<b>UnStableCoin ($US)</b>  
A cultural experiment on Solana.  
Born without presale. Built by chaos, memes, and belief.

🌐 <a href="https://theunstable.io">Website</a>  
🐦 <a href="https://x.com/UnStableCoinX">X</a>  
💬 <a href="https://t.me/UnStableCoin_US">Telegram</a>
`;
  await sendSafeMessage(chatId, text);
});

// LEADERBOARD
bot.onText(/\/rank|\/top10/, async (msg) => {
  const chatId = msg.chat.id;
  const data = await getLeaderboard();
  const sorted = Object.entries(data).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return sendSafeMessage(chatId, "No scores yet. Be the first to play!");

  let message = "<b>🏆 Top 10 Players</b>\n\n";
  sorted.slice(0, 10).forEach(([user, score], i) => {
    message += `${i + 1}. <b>${user}</b> – ${score} pts\n`;
  });
  await sendSafeMessage(chatId, message);
});

bot.onText(/\/top50/, async (msg) => {
  const chatId = msg.chat.id;
  const data = await getLeaderboard();
  const sorted = Object.entries(data).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return sendSafeMessage(chatId, "No scores yet.");

  let message = "<b>🏅 Top 50 Players</b>\n\n";
  sorted.slice(0, 50).forEach(([user, score], i) => {
    message += `${i + 1}. <b>${user}</b> – ${score} pts\n`;
  });
  await sendSafeMessage(chatId, message);
});

// SUBMIT SCORE
bot.onText(/\/submit (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const user = msg.from.username?.toLowerCase() || msg.from.first_name || "anonymous";
  const score = parseInt(match[1]);
  if (isNaN(score)) return sendSafeMessage(chatId, "❌ Please use: /submit 42");

  await updateLeaderboard(user, score);
  await sendSafeMessage(chatId, `✅ <b>${user}</b>'s score updated: ${score} pts`);
});

// EVENT
bot.onText(/\/event/, async (msg) => {
  const chatId = msg.chat.id;
  const eventData = await getEventData();
  const text = eventData.event
    ? `<b>🎯 Current Event</b>\n\n${eventData.event}`
    : "🎯 No active event right now.\nStay tuned for the next drop. ⚡";
  await sendSafeMessage(chatId, text);
});

// EVENT LEADERBOARDS
bot.onText(/\/eventtop/, async (msg) => {
  const chatId = msg.chat.id;
  const eventData = await getEventData();
  const scores = eventData.scores || {};
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return sendSafeMessage(chatId, "No event scores yet.");

  let message = "<b>🥇 Event Top 10</b>\n\n";
  sorted.slice(0, 10).forEach(([user, score], i) => {
    message += `${i + 1}. <b>${user}</b> – ${score} pts\n`;
  });
  await sendSafeMessage(chatId, message);
});

bot.onText(/\/eventtop50/, async (msg) => {
  const chatId = msg.chat.id;
  const eventData = await getEventData();
  const scores = eventData.scores || {};
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return sendSafeMessage(chatId, "No event scores yet.");

  let message = "<b>🥇 Event Top 50</b>\n\n";
  sorted.slice(0, 50).forEach(([user, score], i) => {
    message += `${i + 1}. <b>${user}</b> – ${score} pts\n`;
  });
  await sendSafeMessage(chatId, message);
});

// === SERVER START ===
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 UnStableCoinBot running on port ${PORT}`);
});
