// === UnStableCoin Game Bot ===
// ⚡ Version: Stable Leaderboard + EventFix + Sorted Splash Endpoint + Admin Tools
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
const EVENT_META_JSONBIN_ID = process.env.EVENT_META_JSONBIN_ID;
const RESET_KEY = process.env.RESET_KEY;

if (!token || !JSONBIN_ID || !EVENT_JSONBIN_ID || !JSONBIN_KEY || !EVENT_META_JSONBIN_ID || !RESET_KEY) {
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
async function sendSafeMessage(chatId, message) {
  try {
    await bot.sendMessage(chatId, message, {
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
  } catch (err) {
    console.error("❌ Telegram send failed:", err.message);
  }
}

// === CLEANED LEADERBOARD LOADERS ===
async function getLeaderboard() {
  try {
    const res = await axios.get(MAIN_BIN_URL, { headers: { "X-Master-Key": JSONBIN_KEY } });
    let data = res.data.record || {};
    if (data.scores && typeof data.scores === "object") data = data.scores;
    const clean = {};
    for (const [u, v] of Object.entries(data)) {
      const n = parseFloat(v);
      if (!isNaN(n)) clean[u] = n;
    }
    return clean;
  } catch (err) {
    console.error("❌ Error loading leaderboard:", err.message);
    return {};
  }
}

async function getEventData() {
  try {
    const res = await axios.get(EVENT_BIN_URL, { headers: { "X-Master-Key": JSONBIN_KEY } });
    let data = res.data.record || {};
    if (data.scores?.scores) data = data.scores.scores;
    else if (data.scores) data = data.scores;
    const clean = {};
    for (const [u, v] of Object.entries(data)) {
      const n = parseFloat(v);
      if (!isNaN(n)) clean[u] = n;
    }
    return { scores: clean };
  } catch (err) {
    console.error("❌ Error fetching event data:", err.message);
    return { scores: {} };
  }
}

// === TELEGRAM COMMANDS ===

// /START
bot.onText(/\/start/, async (msg) => {
  try {
    await bot.sendGame(msg.chat.id, "US_FUD_Dodge", {
      reply_markup: { inline_keyboard: [[{ text: "🎮 Play Now", callback_game: {} }]] },
    });
  } catch (err) {
    await sendSafeMessage(
      msg.chat.id,
      `🎮 <b>Play FUD Dodge</b>\nIf the button doesn’t work:\n👉 <a href="https://theunstable.io/fuddodge">theunstable.io/fuddodge</a>`
    );
  }
});

// /HELP
bot.onText(/\/help/, async (msg) => {
  const text = `
<b>💛 Welcome to the UnStableCoin Game Bot</b>

Available commands:
🎮 /play – Start the game  
🏆 /top10 – View Top 10  
📈 /top50 – View Top 50  
⚡ /eventtop10 – Event Top 10  
🥇 /eventtop50 – Event Top 50  
📢 /event – View current event  
🧠 /info – Game rules  
🔧 /resetevent – Admin only  
🚀 /setevent – Admin only`;
  await sendSafeMessage(msg.chat.id, text);
});

// /PLAY
bot.onText(/\/play/, async (msg) => {
  const isPrivate = msg.chat.type === "private";
  if (isPrivate) {
    await bot.sendMessage(msg.chat.id, "🎮 <b>Play FUD Dodge</b>", {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "⚡ Open Game", web_app: { url: "https://theunstable.io/fuddodge" } }]] },
    });
  } else {
    await bot.sendMessage(msg.chat.id, "💨 FUD levels too high here 😅\nPlay safely in DM 👇", {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "⚡ Open DM to Play", url: "https://t.me/UnStableCoinBot?start=play" }]] },
    });
  }
});

// /INFO
bot.onText(/\/info|\/howtoplay/, async (msg) => {
  const text = `
🎮 <b>How to Play FUD Dodge</b>

🪙 Dodge FUD and scams. Collect coins and memes to grow your MCap.  
⚡ Power-ups: Lightning, Coin, Green Candle, Meme  
💀 Threats: FUD Skull, Red Candle, The Scammer (-50%)  
📊 Compete: /top10  /eventtop10

Stay unstable. 💛⚡`;
  await sendSafeMessage(msg.chat.id, text);
});

// /EVENT
bot.onText(/\/event$/, async (msg) => {
  try {
    const res = await axios.get(META_BIN_URL, { headers: { "X-Master-Key": JSONBIN_KEY } });
    let meta = res.data.record || {};
    if (!meta.title) {
      meta = { title: "🚀 Default Event", info: "Score big, stay unstable!", updatedAt: new Date().toISOString() };
      await axios.put(META_BIN_URL, meta, { headers: { "Content-Type": "application/json", "X-Master-Key": JSONBIN_KEY } });
    }
    await sendSafeMessage(msg.chat.id, `<b>${meta.title}</b>\n\n${meta.info}`);
  } catch {
    await sendSafeMessage(msg.chat.id, "⚠️ Could not load event info.");
  }
});

// /SETEVENT (Admin)
bot.onText(/\/setevent(.*)/, async (msg, match) => {
  const username = msg.from.username?.toLowerCase() || "";
  if (!ADMIN_USERS.includes(username)) return sendSafeMessage(msg.chat.id, "🚫 You are not authorized.");
  const args = match[1]?.trim();
  if (!args) return sendSafeMessage(msg.chat.id, "📝 Use:\n<code>/setevent Title | Description</code>");
  const [title, info] = args.split("|").map((s) => s.trim());
  const newData = { title: title || "🚀 Default Event", info: info || "Score big, stay unstable!", updatedAt: new Date().toISOString() };
  await axios.put(META_BIN_URL, newData, { headers: { "Content-Type": "application/json", "X-Master-Key": JSONBIN_KEY } });
  await sendSafeMessage(msg.chat.id, `✅ Event updated:\n<b>${newData.title}</b>\n${newData.info}`);
});

// /RESETEVENT (Admin)
bot.onText(/\/resetevent/, async (msg) => {
  const username = msg.from.username?.toLowerCase() || "";
  if (!ADMIN_USERS.includes(username)) return sendSafeMessage(msg.chat.id, "🚫 Not authorized.");
  const chatId = msg.chat.id;
  await sendSafeMessage(chatId, "⚠️ Confirm reset? Reply <b>YES</b> within 30s.");
  const listener = async (reply) => {
    if (reply.chat.id !== chatId) return;
    if (reply.from.username?.toLowerCase() !== username) return;
    if (reply.text.trim().toUpperCase() === "YES") {
      await axios.put(EVENT_BIN_URL, { scores: {} }, { headers: { "Content-Type": "application/json", "X-Master-Key": JSONBIN_KEY } });
      await sendSafeMessage(chatId, "✅ Event leaderboard cleared.");
    } else await sendSafeMessage(chatId, "❌ Cancelled.");
    bot.removeListener("message", listener);
  };
  bot.on("message", listener);
  setTimeout(() => bot.removeListener("message", listener), 30000);
});

// === CHUNK HELPER ===
function sendChunked(chatId, header, lines, maxLen = 3500) {
  let buf = header;
  for (const line of lines) {
    if ((buf + line + "\n").length > maxLen) {
      sendSafeMessage(chatId, buf.trim());
      buf = header + line + "\n";
    } else buf += line + "\n";
  }
  if (buf.trim()) sendSafeMessage(chatId, buf.trim());
}

// === LEADERBOARD COMMANDS ===
bot.onText(/\/top10/, async (msg) => {
  const data = await getLeaderboard();
  const sorted = Object.entries(data).sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return sendSafeMessage(msg.chat.id, "No scores yet!");
  const lines = sorted.slice(0, 10).map(([u, s], i) => `${i + 1}. <b>${u}</b> – ${s} pts`);
  sendChunked(msg.chat.id, "<b>🏆 Top 10 Players</b>\n\n", lines);
});

bot.onText(/\/top50/, async (msg) => {
  const data = await getLeaderboard();
  const sorted = Object.entries(data).sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return sendSafeMessage(msg.chat.id, "No scores yet!");
  const lines = sorted.slice(0, 50).map(([u, s], i) => `${i + 1}. <b>${u}</b> – ${s} pts`);
  sendChunked(msg.chat.id, "<b>📈 Top 50 Players</b>\n\n", lines);
});

bot.onText(/\/eventtop10/, async (msg) => {
  const { scores } = await getEventData();
  const sorted = Object.entries(scores).filter(([u]) => !u.startsWith("_")).sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return sendSafeMessage(msg.chat.id, "No event scores yet.");
  const lines = sorted.slice(0, 10).map(([u, s], i) => `${i + 1}. <b>${u}</b> – ${s} pts`);
  sendChunked(msg.chat.id, "<b>🥇 Event Top 10</b>\n\n", lines);
});

bot.onText(/\/eventtop50/, async (msg) => {
  const { scores } = await getEventData();
  const sorted = Object.entries(scores).filter(([u]) => !u.startsWith("_")).sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return sendSafeMessage(msg.chat.id, "No event scores yet.");
  const lines = sorted.slice(0, 50).map(([u, s], i) => `${i + 1}. <b>${u}</b> – ${s} pts`);
  sendChunked(msg.chat.id, "<b>🥇 Event Top 50</b>\n\n", lines);
});

// === 🪩 Public event info for frontend & game ===
app.get("/event", async (req, res) => {
  try {
    // use the same meta-bin that Telegram uses
    const url = `https://api.jsonbin.io/v3/b/${process.env.EVENT_META_JSONBIN_ID}/latest`;

    const resp = await fetch(url, {
      headers: {
        "X-Master-Key": process.env.JSONBIN_KEY,
      },
    });

    if (!resp.ok) {
      console.error("❌ JSONBin fetch failed:", resp.status, await resp.text());
      return res
        .status(resp.status)
        .json({ error: "Failed to fetch event info" });
    }

    const json = await resp.json();
    const data = json.record || json;

    // normalize output for the frontend
    res.json({
      title: data.title || data.name || "Current Event",
      info: data.info || data.description || "No description available.",
      endDate: data.endDate || data.expiry || null,
      updatedAt:
        data.updatedAt ||
        json.metadata?.modifiedAt ||
        new Date().toISOString(),
      source: "EVENT_META_JSONBIN_ID",
    });
  } catch (err) {
    console.error("❌ /event route error:", err);
    res.status(500).json({ error: "Internal event fetch error" });
  }
});

// === EXPRESS API ENDPOINTS ===
// ✅ FIX: sorted output for splash leaderboard
app.get("/leaderboard", async (req, res) => {
  try {
    const data = await getLeaderboard();
    const sorted = Object.entries(data)
      .sort((a, b) => b[1] - a[1])
      .map(([username, score]) => ({ username, score }));
    res.json(sorted);
  } catch (err) {
    console.error("❌ Failed /leaderboard:", err.message);
    res.status(500).json({ error: "Failed to load leaderboard" });
  }
});

app.get("/eventtop10", async (req, res) => {
  const { scores } = await getEventData();
  const sorted = Object.entries(scores)
    .filter(([u]) => !u.startsWith("_"))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([username, score]) => ({ username, score }));
  res.json(sorted);
});

app.get("/eventtop50", async (req, res) => {
  const { scores } = await getEventData();
  const sorted = Object.entries(scores)
    .filter(([u]) => !u.startsWith("_"))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([username, score]) => ({ username, score }));
  res.json(sorted);
});

// === SUBMIT ===
app.post("/submit", async (req, res) => {
  try {
    const { username, score, target } = req.body;
    const adminKey = req.headers["x-admin-key"];
    const isAdmin = adminKey && adminKey === RESET_KEY;
    if (!username || typeof score !== "number") return res.status(400).json({ error: "Invalid data" });

    console.log(`📥 Submit: ${username} → ${score} (${target || "both"})`);

    // MAIN
    if (target !== "event") {
      const main = await getLeaderboard();
      const prev = main[username] || 0;
      if (score > prev || isAdmin) {
        main[username] = score;
        await axios.put(MAIN_BIN_URL, main, { headers: { "Content-Type": "application/json", "X-Master-Key": JSONBIN_KEY } });
        console.log(`🔥 Main updated for ${username}: ${score}`);
      }
    }

    // EVENT
    if (target !== "main") {
      const { scores } = await getEventData();
      const prev = scores[username] || 0;
      if (score > prev || isAdmin) {
        scores[username] = score;
        await axios.put(EVENT_BIN_URL, { scores }, { headers: { "Content-Type": "application/json", "X-Master-Key": JSONBIN_KEY } });
        console.log(`⚡ Event updated for ${username}: ${score}`);
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Submit failed:", err.message);
    res.status(500).json({ error: "Failed to submit score" });
  }
});

// === CALLBACK ===
bot.on("callback_query", async (q) => {
  try {
    if (q.game_short_name === "US_FUD_Dodge") {
      await bot.answerCallbackQuery(q.id, { url: "https://theunstable.io/fuddodge" });
    }
  } catch (err) {
    console.error("❌ Callback error:", err.message);
  }
});

// === START SERVER ===
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 UnStableCoinBot running on port ${PORT}`));
