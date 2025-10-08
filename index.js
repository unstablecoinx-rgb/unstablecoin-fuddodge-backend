// === UnStableCoin Game Bot ===
// ⚡ Version: Full Stable + Logging + Event Meta + Submit + ResetEvent
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
const EVENT_META_JSONBIN_ID = process.env.EVENT_META_JSONBIN_ID;
const JSONBIN_KEY = process.env.JSONBIN_KEY;

if (!token || !JSONBIN_ID || !EVENT_JSONBIN_ID || !EVENT_META_JSONBIN_ID || !JSONBIN_KEY) {
  console.error("❌ Missing environment variables!");
  process.exit(1);
}

// === SETTINGS ===
const ADMIN_USERS = ["unstablecoinx", "unstablecoinx_bot", "pachenko_14"];
const app = express();
app.use(cors({ origin: "https://theunstable.io" }));
app.use(bodyParser.json());

// === JSONBin URLs ===
const MAIN_BIN_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_ID}`;
const EVENT_BIN_URL = `https://api.jsonbin.io/v3/b/${EVENT_JSONBIN_ID}`;
const META_BIN_URL = `https://api.jsonbin.io/v3/b/${EVENT_META_JSONBIN_ID}`;

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
async function sendSafeMessage(chatId, text) {
  try {
    await bot.sendMessage(chatId, text, { parse_mode: "HTML", disable_web_page_preview: true });
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

async function getEventData() {
  try {
    const res = await axios.get(EVENT_BIN_URL, { headers: { "X-Master-Key": JSONBIN_KEY } });
    const data = res.data.record || {};
    return data.scores ? data : { scores: data };
  } catch (err) {
    console.error("❌ Error fetching event data:", err.message);
    return { scores: {} };
  }
}

// === TELEGRAM COMMANDS ===

// ✅ START
bot.onText(/\/start/, async (msg) => {
  try {
    await bot.sendGame(msg.chat.id, "US_FUD_Dodge", {
      reply_markup: { inline_keyboard: [[{ text: "🎮 Play Now", callback_game: {} }]] },
    });
  } catch (err) {
    console.error("❌ Failed to send start game:", err.message);
    await sendSafeMessage(
      msg.chat.id,
      `🎮 <b>Play FUD Dodge</b>\nIf the button doesn’t work:\n👉 <a href="https://theunstable.io/fuddodge">theunstable.io/fuddodge</a>`
    );
  }
});

// HELP
bot.onText(/\/help/, async (msg) => {
  const text = `
<b>💛 Welcome to the UnStableCoin Game Bot</b>

Available commands:
🎮 <b>/play</b> – Start the game  
🏆 <b>/top10</b> – View top 10  
📈 <b>/top50</b> – View top 50  
⚡ <b>/eventtop10</b> – Event top 10  
🥇 <b>/eventtop50</b> – Event top 50  
📢 <b>/event</b> – View current event  
🧠 <b>/info</b> – Game rules`;
  await sendSafeMessage(msg.chat.id, text);
});

// PLAY
bot.onText(/\/play/, async (msg) => {
  const chatId = msg.chat.id;
  const isPrivate = msg.chat.type === "private";

  if (isPrivate) {
    await bot.sendMessage(chatId, "🎮 <b>Play FUD Dodge</b>", {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[{ text: "⚡ Open Game", web_app: { url: "https://theunstable.io/fuddodge" } }]],
      },
    });
  } else {
    await bot.sendMessage(
      chatId,
      `💨 FUD levels too high here 😅\nPlay safely in DM 👇`,
      {
        parse_mode: "HTML",
        reply_markup: [[{ text: "⚡ Open DM to Play", url: "https://t.me/UnStableCoinBot?start=play" }]],
      }
    );
  }
});

// ABOUT
bot.onText(/\/about/, async (msg) => {
  const text = `
<b>UnStableCoin ($US)</b>  
A cultural experiment on Solana.  
Born without presale. Built by chaos, memes and belief.

🌐 <a href="https://theunstable.io">Website</a>  
🐦 <a href="https://x.com/UnStableCoinX">X</a>  
💬 <a href="https://t.me/UnStableCoin_US">Telegram</a>`;
  await sendSafeMessage(msg.chat.id, text);
});

// INFO / HOWTOPLAY
bot.onText(/\/info|\/howtoplay/, async (msg) => {
  const text = `
🎮 <b>How to Play FUD Dodge</b>

🪙 <b>Goal:</b> Dodge FUD and scams. Collect coins and candles to grow your MCap.  
⚡ <b>Power-ups:</b> Lightning, Coin, Green Candle, Meme  
💀 <b>Threats:</b> FUD Skull, Red Candle, The Scammer (-50%)  
📊 <b>Compete:</b> /top10  / /eventtop10  

Stay unstable. 💛⚡`;
  await sendSafeMessage(msg.chat.id, text);
});

// 🆕 EVENT INFO
bot.onText(/\/event$/, async (msg) => {
  try {
    const res = await axios.get(META_BIN_URL, { headers: { "X-Master-Key": JSONBIN_KEY } });
    let meta = res.data.record || {};

    if (!meta.title) {
      meta = {
        title: "🚀 Default Event",
        info: "Score big, stay unstable!",
        updatedAt: new Date().toISOString(),
      };
      await axios.put(META_BIN_URL, meta, {
        headers: { "Content-Type": "application/json", "X-Master-Key": JSONBIN_KEY },
      });
    }

    await sendSafeMessage(msg.chat.id, `<b>${meta.title}</b>\n\n${meta.info}`);
  } catch (err) {
    console.error("❌ Failed to load event meta:", err.message);
    await sendSafeMessage(msg.chat.id, "⚠️ Could not load event info.");
  }
});

// 🆕 SETEVENT (admins)
bot.onText(/\/setevent(.*)/, async (msg, match) => {
  const username = msg.from.username?.toLowerCase() || "";
  if (!ADMIN_USERS.includes(username)) return sendSafeMessage(msg.chat.id, "🚫 You are not authorized.");

  const args = match[1]?.trim();
  if (!args) {
    return sendSafeMessage(
      msg.chat.id,
      "📝 To set an event, use:\n<code>/setevent Title | Description</code>\n\nExample:\n<code>/setevent 🚀 Moon Run | Survive the FUD and double your MCap!</code>"
    );
  }

  const [title, info] = args.split("|").map((s) => s.trim());
  const newData = {
    title: title || "🚀 Default Event",
    info: info || "Score big, stay unstable!",
    updatedAt: new Date().toISOString(),
  };

  try {
    await axios.put(META_BIN_URL, newData, {
      headers: { "Content-Type": "application/json", "X-Master-Key": JSONBIN_KEY },
    });
    await sendSafeMessage(msg.chat.id, `✅ Event updated:\n<b>${newData.title}</b>\n${newData.info}`);
  } catch (err) {
    console.error("❌ SetEvent failed:", err.message);
    await sendSafeMessage(msg.chat.id, "⚠️ Failed to update event.");
  }
});

// === SUBMIT SCORE ===
app.post("/submit", async (req, res) => {
  try {
    const { username, score } = req.body;
    if (!username || typeof score !== "number") {
      console.warn("⚠️ Invalid submit:", req.body);
      return res.status(400).json({ error: "Invalid data" });
    }

    console.log(`🏁 ${username} submitted ${score} points`);

    // MAIN
    const mainRes = await axios.get(MAIN_BIN_URL, { headers: { "X-Master-Key": JSONBIN_KEY } });
    const mainData = mainRes.data.record || {};
    const prev = mainData[username] || 0;

    if (score > prev) {
      mainData[username] = score;
      await axios.put(MAIN_BIN_URL, mainData, {
        headers: { "Content-Type": "application/json", "X-Master-Key": JSONBIN_KEY },
      });
      console.log(`🔥 Main updated for ${username}: ${score}`);
    } else {
      console.log(`ℹ️ Lower score ignored for ${username}`);
    }

    // EVENT mirror
    try {
      const eventRes = await axios.get(EVENT_BIN_URL, { headers: { "X-Master-Key": JSONBIN_KEY } });
      const eventData = eventRes.data.record || {};
      const scores = eventData.scores || {};
      const current = scores[username] || 0;

      if (score > current) {
        scores[username] = score;
        await axios.put(EVENT_BIN_URL, { ...eventData, scores }, {
          headers: { "Content-Type": "application/json", "X-Master-Key": JSONBIN_KEY },
        });
        console.log(`⚡ Event updated for ${username}: ${score}`);
      }
    } catch (err) {
      console.error("❌ Event mirror failed:", err.message);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Submit failed:", err.message);
    res.status(500).json({ error: "Failed to submit score" });
  }
});

// === RESET EVENT (admins) ===
bot.onText(/\/resetevent/, async (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username?.toLowerCase() || "";
  if (!ADMIN_USERS.includes(username)) return sendSafeMessage(chatId, "🚫 You are not authorized.");

  await sendSafeMessage(chatId, "⚠️ Confirm reset? Type <b>YES</b> within 30 seconds.");

  const listener = async (reply) => {
    if (reply.chat.id !== chatId) return;
    const user = reply.from.username?.toLowerCase() || "";
    if (user !== username) return;

    if (reply.text.trim().toUpperCase() === "YES") {
      try {
        const eventData = await getEventData();
        const updated = { ...eventData, scores: {} };
        await axios.put(EVENT_BIN_URL, updated, {
          headers: { "Content-Type": "application/json", "X-Master-Key": JSONBIN_KEY },
        });
        console.log(`⚡ Event reset by ${username}`);
        await sendSafeMessage(chatId, "✅ Event leaderboard cleared.");
      } catch (err) {
        console.error("❌ Reset failed:", err.message);
        await sendSafeMessage(chatId, "⚠️ Failed to reset event.");
      }
    } else {
      await sendSafeMessage(chatId, "❌ Reset cancelled.");
    }

    bot.removeListener("message", listener);
  };

  bot.on("message", listener);
  setTimeout(() => bot.removeListener("message", listener), 30000);
});

// === CALLBACK FIX ===
bot.on("callback_query", async (query) => {
  try {
    if (query.game_short_name === "US_FUD_Dodge") {
      await bot.answerCallbackQuery(query.id, { url: "https://theunstable.io/fuddodge" });
    }
  } catch (err) {
    console.error("❌ Game callback error:", err.message);
  }
});

// === SERVER START ===
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 UnStableCoinBot running on port ${PORT}`));
