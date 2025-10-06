// === UnStableCoin Leaderboard + Game API ===
// by UnStableCoin community ⚡
// Stable build – webhook-safe + verified env setup (v2025-10-07)

const express = require("express");
const bodyParser = require("body-parser");
const TelegramBot = require("node-telegram-bot-api");
const cors = require("cors");
const axios = require("axios");
require("dotenv").config();

// === Environment Variables ===
const token = process.env.TELEGRAM_BOT_TOKEN;
const JSONBIN_ID = process.env.JSONBIN_ID;             // Permanent leaderboard
const EVENT_JSONBIN_ID = process.env.EVENT_JSONBIN_ID; // Event leaderboard
const JSONBIN_KEY = process.env.JSONBIN_KEY;
const RESET_KEY = process.env.RESET_KEY;               // Admin reset protection
const HOSTNAME = process.env.RENDER_EXTERNAL_HOSTNAME; // Required for webhook

if (!token || !JSONBIN_ID || !EVENT_JSONBIN_ID || !JSONBIN_KEY) {
  console.error("❌ Missing environment variables: check TELEGRAM_BOT_TOKEN, JSONBIN_ID, EVENT_JSONBIN_ID, JSONBIN_KEY.");
  process.exit(1);
}

if (!HOSTNAME) {
  console.warn("⚠️  RENDER_EXTERNAL_HOSTNAME is not set — Telegram webhooks may fail. Add it in Render env vars!");
}

// === Express App ===
const app = express();
app.use(cors({ origin: "*" }));
app.use(bodyParser.json());

// === JSONBin URLs ===
const MAIN_BIN_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_ID}`;
const EVENT_BIN_URL = `https://api.jsonbin.io/v3/b/${EVENT_JSONBIN_ID}`;

// === Telegram Bot Setup (Webhook mode) ===
const bot = new TelegramBot(token, { webHook: true });

// Construct webhook URL
const webhookUrl = `https://${HOSTNAME}/bot${token}`;
bot.setWebHook(webhookUrl)
  .then(() => console.log(`✅ Telegram webhook set to ${webhookUrl}`))
  .catch((err) => console.error("❌ Failed to set webhook:", err.message));

// Webhook endpoint for Telegram
app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Log status on startup
console.log("🚀 UnStableCoinBot starting...");
console.log(`   Main Bin:  ${MAIN_BIN_URL}`);
console.log(`   Event Bin: ${EVENT_BIN_URL}`);
console.log(`   Webhook:   ${webhookUrl}`);
console.log(`   Mode:      Render Webhook`);
