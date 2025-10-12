// === UnStableCoin Game Bot ===
// ⚡ Version: EventTimeStrict + EventCloseOnEnd + Protected Submits + Admin Tools
// Author: UnStableCoin Community
// ------------------------------------

const express = require("express");
const bodyParser = require("body-parser");
const TelegramBot = require("node-telegram-bot-api");
const cors = require("cors");
const axios = require("axios");
require("dotenv").config();

const { DateTime } = require("luxon");

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
async function sendSafeMessage(chatId, message, opts = {}) {
  try {
    await bot.sendMessage(chatId, message, Object.assign({ parse_mode: "HTML", disable_web_page_preview: true }, opts));
  } catch (err) {
    console.error("❌ Telegram send failed:", err?.message || err);
  }
}

// Load main leaderboard from JSONBin and normalize {username: score}
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
    console.error("❌ Error loading leaderboard:", err.message || err);
    return {};
  }
}

// Load event leaderboard (scores) as { scores: {username:score} }
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
    console.error("❌ Error fetching event data:", err.message || err);
    return { scores: {} };
  }
}

// Load event metadata (title, info, endDate, timezone, etc.)
async function getEventMeta() {
  try {
    // fetch latest version
    const res = await axios.get(`${META_BIN_URL}/latest`, { headers: { "X-Master-Key": JSONBIN_KEY } });
    const payload = res.data.record || res.data || {};
    // ensure shape
    return {
      title: payload.title || payload.name || "Current Event",
      info: payload.info || payload.description || "",
      endDate: payload.endDate || null,
      timezone: payload.timezone || "Europe/Stockholm",
      updatedAt: payload.updatedAt || res.data?.metadata?.modifiedAt || new Date().toISOString(),
      raw: payload
    };
  } catch (err) {
    console.error("❌ Error fetching event meta:", err?.message || err);
    return {
      title: "No active event",
      info: "No description available.",
      endDate: null,
      timezone: "Europe/Stockholm",
      updatedAt: new Date().toISOString(),
      raw: {}
    };
  }
}

// Check whether event is currently open (true if endDate in future or endDate null)
function isEventOpen(meta) {
  if (!meta || !meta.endDate) return false;
  const now = DateTime.utc();
  const end = DateTime.fromISO(meta.endDate, { zone: "utc" });
  return end > now;
}

// Format remaining time string
function remainingTimeString(endIso, tz = "UTC") {
  if (!endIso) return null;
  const now = DateTime.now().toUTC();
  const end = DateTime.fromISO(endIso, { zone: "utc" });
  if (!end.isValid) return null;
  const diff = end.diff(now, ["days", "hours", "minutes"]).toObject();
  const days = Math.floor(diff.days || 0);
  const hours = Math.floor(diff.hours || 0);
  const minutes = Math.floor(diff.minutes || 0);
  if (end <= now) return "Ended";
  return `${days ? days + "d " : ""}${hours ? hours + "h " : ""}${minutes ? minutes + "m" : ""}`.trim();
}

// === TELEGRAM COMMANDS ===

// /start
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

// /help
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

// /play
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

// /info
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
    const res = await axios.get(META_BIN_URL, {
      headers: { "X-Master-Key": JSONBIN_KEY },
    });
    let meta = res.data.record || {};

    if (!meta.title) {
      meta = {
        title: "⚡️ Unstable Challenge",
        info: "Stay tuned for the next event!",
        endDate: null,
        updatedAt: new Date().toISOString(),
      };
    }

    // 🕓 Format remaining time or status
    let timeInfo = "";
    if (meta.endDate) {
      const now = DateTime.now().toUTC();
      const end = DateTime.fromISO(meta.endDate);
      const diff = end.diff(now, ["days", "hours", "minutes"]).toObject();

      if (diff.days > 0 || diff.hours > 0 || diff.minutes > 0) {
        const d = Math.floor(diff.days || 0);
        const h = Math.floor(diff.hours || 0);
        const m = Math.floor(diff.minutes || 0);
        const remaining =
          (d ? `${d}d ` : "") + (h ? `${h}h ` : "") + (m ? `${m}m` : "");
        timeInfo = `\n\n⏳ <b>Ends in ${remaining.trim()}</b>\n🗓 ${DateTime.fromISO(meta.endDate)
          .setZone(meta.timezone || "Europe/Stockholm")
          .toFormat("yyyy-MM-dd HH:mm ZZZZ")}`;
      } else {
        timeInfo = `\n\n⚠️ <b>The event has ended.</b>\n⚡️ Stay tuned for the next Unstable Challenge!`;
      }
    }

    const updated = meta.updatedAt
      ? `\n\n<i>Updated: ${DateTime.fromISO(meta.updatedAt)
          .toUTC()
          .toFormat("yyyy-MM-dd HH:mm 'UTC'")}</i>`
      : "";

    await sendSafeMessage(
      msg.chat.id,
      `<b>${meta.title}</b>\n\n${meta.info}${timeInfo}${updated}`,
      { parse_mode: "HTML" }
    );
  } catch (err) {
    console.error("❌ /event error:", err.message);
    await sendSafeMessage(msg.chat.id, "⚠️ Could not load event info.");
  }
});

// /SETEVENT (Admin)
bot.onText(/\/setevent(.*)/, async (msg, match) => {
  const username = msg.from.username?.toLowerCase() || "";
  if (!ADMIN_USERS.includes(username))
    return sendSafeMessage(msg.chat.id, "🚫 You are not authorized.");

  const args = match[1]?.trim();
  if (!args) {
    return sendSafeMessage(
      msg.chat.id,
`🛠 <b>How to create or update an event</b>

Use:
<code>/setevent &lt;Title&gt; | &lt;Description&gt; | &lt;Date&gt; | &lt;Time&gt; | [Timezone]</code>

<b>Parameters:</b>
• Title – name of the event  
• Description – short text shown in the game  
• Date – format: YYYY-MM-DD  
• Time – format: HH:mm (24-hour)  
• [Timezone] – optional, defaults to Europe/Stockholm (CET/CEST)

<b>Examples:</b>
<code>/setevent Halloween FUD Dodge | Survive until midnight to win! | 2025-10-31 | 23:59 | CET</code>

<code>/setevent Meme Rally | Keep your MCap above FUD! | 2025-11-10 | 18:00</code>

🧠 Notes:
- Use the "|" (pipe) between sections.
- Timezone defaults to Stockholm.
- Date/time are automatically converted to UTC for saving.`,
      { parse_mode: "HTML" }
    );
  }

  try {
    const parts = args.split("|").map((s) => s.trim());
    const [title, info, dateStr, timeStr, tzStrRaw] = parts;

    // Normalize timezone names
    const tzMap = {
      CET: "Europe/Stockholm",
      CEST: "Europe/Stockholm",
      UTC: "UTC",
      GMT: "UTC",
    };
    const zone = tzMap[tzStrRaw?.toUpperCase()] || tzStrRaw || "Europe/Stockholm";

    // Clean up weird dash characters
    const cleanDate = (dateStr || "").replace(/[–—]/g, "-");

    // Require valid date and time
    if (!cleanDate || !timeStr) {
      return sendSafeMessage(
        msg.chat.id,
        "❌ Missing date or time.\nExample: /setevent Title | Info | 2025-10-31 | 23:59 | CET"
      );
    }

    // Parse datetime
    const dt = DateTime.fromFormat(`${cleanDate} ${timeStr}`, "yyyy-MM-dd HH:mm", { zone });
    if (!dt.isValid) {
      return sendSafeMessage(
        msg.chat.id,
        "❌ Invalid date/time format.\nUse format: YYYY-MM-DD | HH:mm | [TZ]\nExample: 2025-10-31 | 23:59 | CET"
      );
    }

    // Build event object
    const newData = {
      title: title || "⚡️ Unstable Challenge",
      info: info || "Score big, stay unstable!",
      endDate: dt.toUTC().toISO(),
      endLocal: dt.setZone(zone).toFormat("yyyy-MM-dd HH:mm ZZZZ"),
      timezone: zone,
      updatedAt: new Date().toISOString(),
    };

    await axios.put(META_BIN_URL, newData, {
      headers: {
        "Content-Type": "application/json",
        "X-Master-Key": JSONBIN_KEY,
      },
    });

    await sendSafeMessage(
      msg.chat.id,
      `✅ <b>Event updated!</b>\n⚡️ <b>${newData.title}</b>\n${newData.info}\n⏳ Ends: ${newData.endLocal} (${zone})`,
      { parse_mode: "HTML" }
    );
  } catch (err) {
    console.error("❌ /setevent error:", err);
    sendSafeMessage(msg.chat.id, "⚠️ Failed to update event (internal error).");
  }
});
// /resetevent (Admin) — clears event leaderboard only
bot.onText(/\/resetevent/, async (msg) => {
  const username = msg.from.username?.toLowerCase() || "";
  if (!ADMIN_USERS.includes(username)) return sendSafeMessage(msg.chat.id, "🚫 Not authorized.");
  const chatId = msg.chat.id;
  await sendSafeMessage(chatId, "⚠️ Confirm reset of event leaderboard? Reply <b>YES</b> within 30s.");
  const listener = async (reply) => {
    if (reply.chat.id !== chatId) return;
    if (reply.from.username?.toLowerCase() !== username) return;
    if (String(reply.text || "").trim().toUpperCase() === "YES") {
      await axios.put(EVENT_BIN_URL, { scores: {} }, { headers: { "Content-Type": "application/json", "X-Master-Key": JSONBIN_KEY } });
      await sendSafeMessage(chatId, "✅ Event leaderboard cleared.");
    } else {
      await sendSafeMessage(chatId, "❌ Cancelled.");
    }
    bot.removeListener("message", listener);
  };
  bot.on("message", listener);
  setTimeout(() => bot.removeListener("message", listener), 30000);
});

// === Helper: sendChunked for long leaderboard messages
function sendChunked(chatId, header, lines, maxLen = 3500) {
  let buf = header;
  for (const line of lines) {
    if ((buf + line + "\n").length > maxLen) {
      sendSafeMessage(chatId, buf.trim());
      buf = header + line + "\n";
    } else {
      buf += line + "\n";
    }
  }
  if (buf.trim()) sendSafeMessage(chatId, buf.trim());
}

// === Leaderboard commands
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

// === Public /event endpoint for frontend (normalized)
app.get("/event", async (req, res) => {
  try {
    const meta = await getEventMeta();
    res.json({
      title: meta.title,
      info: meta.info,
      endDate: meta.endDate,
      timezone: meta.timezone,
      updatedAt: meta.updatedAt,
      open: isEventOpen(meta)
    });
  } catch (err) {
    console.error("❌ /event route error:", err?.message || err);
    res.status(500).json({ error: "Internal event fetch error" });
  }
});

// === Sorted leaderboard endpoints for frontend
app.get("/leaderboard", async (req, res) => {
  try {
    const data = await getLeaderboard();
    const sorted = Object.entries(data)
      .sort((a, b) => b[1] - a[1])
      .map(([username, score]) => ({ username, score }));
    res.json(sorted);
  } catch (err) {
    console.error("❌ Failed /leaderboard:", err?.message || err);
    res.status(500).json({ error: "Failed to load leaderboard" });
  }
});

app.get("/eventtop10", async (req, res) => {
  try {
    const { scores } = await getEventData();
    const sorted = Object.entries(scores)
      .filter(([u]) => !u.startsWith("_"))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([username, score]) => ({ username, score }));
    res.json(sorted);
  } catch (err) {
    console.error("❌ Failed /eventtop10:", err?.message || err);
    res.status(500).json({ error: "Failed to load event top10" });
  }
});

app.get("/eventtop50", async (req, res) => {
  try {
    const { scores } = await getEventData();
    const sorted = Object.entries(scores)
      .filter(([u]) => !u.startsWith("_"))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([username, score]) => ({ username, score }));
    res.json(sorted);
  } catch (err) {
    console.error("❌ Failed /eventtop50:", err?.message || err);
    res.status(500).json({ error: "Failed to load event top50" });
  }
});

// === SUBMIT ===
// POST body: { username, score, target } target = "event" | "main" | undefined (both)
// If event has ended, server will NOT write to event leaderboard.
app.post("/submit", async (req, res) => {
  try {
    const { username, score, target } = req.body;
    const adminKey = req.headers["x-admin-key"];
    const isAdmin = adminKey && adminKey === RESET_KEY;
    if (!username || typeof score !== "number") return res.status(400).json({ error: "Invalid data" });

    console.log(`📥 Submit: ${username} → ${score} (${target || "both"})`);

    // MAIN leaderboard update
    if (target !== "event") {
      const main = await getLeaderboard();
      const prev = main[username] || 0;
      if (score > prev || isAdmin) {
        main[username] = score;
        // Save as simple map to MAIN_BIN_URL
        await axios.put(MAIN_BIN_URL, main, { headers: { "Content-Type": "application/json", "X-Master-Key": JSONBIN_KEY } });
        console.log(`🔥 Main updated for ${username}: ${score}`);
      }
    }

    // EVENT update: only if event is open OR admin override
    if (target !== "main") {
      const meta = await getEventMeta();
      const eventOpen = isEventOpen(meta);
      if (!eventOpen && !isAdmin) {
        // Event closed — do not record to event leaderboard
        console.log(`⚠️ Event closed — not saving event score for ${username}.`);
        return res.json({ success: true, eventSaved: false, reason: "Event closed" });
      }

      const { scores } = await getEventData();
      const prev = scores[username] || 0;
      if (score > prev || isAdmin) {
        scores[username] = score;
        // Save wrapper object { scores: { ... } } to EVENT_BIN_URL
        await axios.put(EVENT_BIN_URL, { scores }, { headers: { "Content-Type": "application/json", "X-Master-Key": JSONBIN_KEY } });
        console.log(`⚡ Event updated for ${username}: ${score}`);
      }
    }

    res.json({ success: true, eventSaved: true });
  } catch (err) {
    console.error("❌ Submit failed:", err?.message || err);
    res.status(500).json({ error: "Failed to submit score" });
  }
});

// === CALLBACK (games button) ===
bot.on("callback_query", async (q) => {
  try {
    if (q.game_short_name === "US_FUD_Dodge") {
      await bot.answerCallbackQuery(q.id, { url: "https://theunstable.io/fuddodge" });
    }
  } catch (err) {
    console.error("❌ Callback error:", err?.message || err);
  }
});

// === START SERVER ===
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 UnStableCoinBot running on port ${PORT}`));
