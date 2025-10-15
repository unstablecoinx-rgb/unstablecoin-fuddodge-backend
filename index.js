// === UnStableCoin Game Bot ===
// ⚡ Version: Full integration: EventTimeStrict + EventCloseOnEnd + Protected Submits + Admin Tools + Holder Verification + Share Image + Help + Holders
// Author: UnStableCoin Community
// ------------------------------------

/*
  Required environment variables:
  - TELEGRAM_BOT_TOKEN
  - JSONBIN_ID           (main leaderboard bin)
  - EVENT_JSONBIN_ID     (event scores bin)
  - JSONBIN_KEY          (jsonbin master key)
  - EVENT_META_JSONBIN_ID (event meta bin)
  - RESET_KEY            (admin/reset key)
  - CONFIG_JSONBIN_ID    (config bin)
  - HOLDER_JSONBIN_ID    (holders bin)
  - RENDER_EXTERNAL_HOSTNAME (optional; used for webhook URL construction)
  - SOLANA_RPC_URL       (optional; otherwise uses clusterApiUrl from @solana/web3.js)
*/
// === CONFIG ===
const CONFIG = {
  tokenMint: '6zzHz3X3s53zhEqyBMmokZLh6Ba5EfC5nP3XURzYpump',
  minHoldAmount: 500000,
  network: 'mainnet-beta'
};

const express = require("express");
const bodyParser = require("body-parser");
const TelegramBot = require("node-telegram-bot-api");
const cors = require("cors");
const axios = require("axios");
require("dotenv").config();

const { DateTime } = require("luxon");
const sharp = require("sharp");
const { Connection, PublicKey, clusterApiUrl } = require("@solana/web3.js");
const { TOKEN_PROGRAM_ID } = require("@solana/spl-token");

// === ENVIRONMENT VALIDATION ===
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const JSONBIN_ID = process.env.JSONBIN_ID;
const EVENT_JSONBIN_ID = process.env.EVENT_JSONBIN_ID;
const JSONBIN_KEY = process.env.JSONBIN_KEY;
const EVENT_META_JSONBIN_ID = process.env.EVENT_META_JSONBIN_ID;
const RESET_KEY = process.env.RESET_KEY;
const CONFIG_JSONBIN_ID = process.env.CONFIG_JSONBIN_ID;
const HOLDER_JSONBIN_ID = process.env.HOLDER_JSONBIN_ID;
const RENDER_EXTERNAL_HOSTNAME = process.env.RENDER_EXTERNAL_HOSTNAME || null;

if (
  !TELEGRAM_BOT_TOKEN ||
  !JSONBIN_ID ||
  !EVENT_JSONBIN_ID ||
  !JSONBIN_KEY ||
  !EVENT_META_JSONBIN_ID ||
  !RESET_KEY ||
  !CONFIG_JSONBIN_ID ||
  !HOLDER_JSONBIN_ID
) {
  console.error("❌ Missing required environment variables. Set TELEGRAM_BOT_TOKEN, JSONBIN_ID, EVENT_JSONBIN_ID, JSONBIN_KEY, EVENT_META_JSONBIN_ID, RESET_KEY, CONFIG_JSONBIN_ID, HOLDER_JSONBIN_ID");
  process.exit(1);
}

// === CONSTANTS & URLS ===
const MAIN_BIN_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_ID}`;
const EVENT_BIN_URL = `https://api.jsonbin.io/v3/b/${EVENT_JSONBIN_ID}`;
const META_BIN_URL = `https://api.jsonbin.io/v3/b/${EVENT_META_JSONBIN_ID}`;
const CONFIG_BIN_URL = `https://api.jsonbin.io/v3/b/${CONFIG_JSONBIN_ID}`;
const HOLDER_BIN_URL = `https://api.jsonbin.io/v3/b/${HOLDER_JSONBIN_ID}`;

const ADMIN_USERS = ["unstablecoinx", "unstablecoinx_bot", "pachenko_14"]; // lowercase usernames
const PORT = process.env.PORT || 10000;

// === EXPRESS SETUP ===
const app = express();
app.use(cors({ origin: "https://theunstable.io" }));
app.use(bodyParser.json({ limit: "8mb" })); // allow base64 images
app.use(bodyParser.urlencoded({ extended: true }));

// === TELEGRAM BOT (webhook) ===
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });

(async () => {
  try {
    const host = RENDER_EXTERNAL_HOSTNAME || `https://unstablecoin-fuddodge-backend.onrender.com`;
    const webhookUrl = `${host.replace(/\/$/, "")}/bot${TELEGRAM_BOT_TOKEN}`;
    await bot.setWebHook(webhookUrl);
    console.log(`✅ Webhook set to: ${webhookUrl}`);
  } catch (err) {
    console.warn("⚠️ setWebHook warning (may already be set or URL invalid):", err?.message || err);
    // continue — webhook might already be set elsewhere
  }
})();

// endpoint for telegram webhook
app.post(`/bot${TELEGRAM_BOT_TOKEN}`, (req, res) => {
  try {
    bot.processUpdate(req.body);
  } catch (err) {
    console.error("❌ processUpdate failed:", err?.message || err);
  }
  res.sendStatus(200);
});

app.get("/", (req, res) => {
  res.send("💛 UnStableCoin Game Bot with holder checks & sharing ready.");
});

/* ============================
   JSONBin helpers (read + write)
   ============================ */
async function readBin(url) {
  try {
    const resp = await axios.get(url, { headers: { "X-Master-Key": JSONBIN_KEY } });
    return resp.data.record || resp.data || {};
  } catch (err) {
    console.error("❌ readBin failed:", err?.message || err);
    return null;
  }
}

async function writeBin(url, payload) {
  try {
    const resp = await axios.put(url, payload, {
      headers: {
        "Content-Type": "application/json",
        "X-Master-Key": JSONBIN_KEY,
      },
    });
    return resp.data;
  } catch (err) {
    console.error("❌ writeBin failed:", err?.message || err);
    throw err;
  }
}

/* ============================
   Config / holder helpers
   ============================ */
async function getConfig() {
  const cfg = (await readBin(CONFIG_BIN_URL)) || {};
  return Object.assign(
    {
      tokenMint: null,
      minHoldAmount: 500000,
      network: "mainnet-beta",
      checkIntervalHours: 24,
      holderVerificationEnabled: true,
      allowPostingWithoutHold: false,
      lastUpdated: new Date().toISOString(),
    },
    cfg
  );
}

async function updateConfig(newPartial) {
  const cur = (await readBin(CONFIG_BIN_URL)) || {};
  const merged = Object.assign({}, cur, newPartial, { lastUpdated: new Date().toISOString() });
  await writeBin(CONFIG_BIN_URL, merged);
  return merged;
}

async function getHoldersMap() {
  const raw = (await readBin(HOLDER_BIN_URL)) || {};
  return raw;
}

async function saveHolder(username, record) {
  const all = (await readBin(HOLDER_BIN_URL)) || {};
  all[username] = record;
  await writeBin(HOLDER_BIN_URL, all);
  return all[username];
}

/* ============================
   Solana on-chain holder check
   ============================ */
async function checkSolanaHolding(walletAddress, requiredWholeTokens) {
  try {
    const config = await getConfig();
    if (!config.tokenMint) throw new Error("tokenMint not set in config JSONBin.");
    const network = config.network || "mainnet-beta";
    const rpc = process.env.SOLANA_RPC_URL || clusterApiUrl(network);
    const conn = new Connection(rpc, "confirmed");

    const ownerPub = new PublicKey(walletAddress);
    const mintPub = new PublicKey(config.tokenMint);

    const parsed = await conn.getParsedTokenAccountsByOwner(ownerPub, { mint: mintPub });

    if (!parsed.value || parsed.value.length === 0) return { ok: false, amount: 0, decimals: 0 };

    let total = 0;
    let decimals = null;
    for (const acc of parsed.value) {
      const parsedInfo = acc.account?.data?.parsed?.info;
      if (parsedInfo && parsedInfo.tokenAmount) {
        const amt = parseFloat(parsedInfo.tokenAmount.amount || 0);
        const dec = parsedInfo.tokenAmount.decimals || 0;
        decimals = dec;
        const ui = amt / Math.pow(10, dec);
        total += ui;
      }
    }

    const whole = Math.floor(total);
    const ok = whole >= requiredWholeTokens;
    return { ok, amount: total, whole, decimals };
  } catch (err) {
    console.error("❌ checkSolanaHolding error:", err?.message || err);
    return { ok: false, amount: 0, whole: 0, decimals: 0, error: err?.message || String(err) };
  }
}

/* ============================
   Image composition with sharp
   ============================ */
function escapeXml(unsafe) {
  return String(unsafe).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&apos;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function composeShareImage(graphBase64, username, score) {
  const W = 1200, H = 628;

  // normalize base64
  let base64 = graphBase64 || "";
  const m = base64.match(/^data:image\/(png|jpeg);base64,(.*)$/);
  if (m) base64 = m[2];

  let graphBuffer = null;
  try {
    if (base64) graphBuffer = Buffer.from(base64, "base64");
  } catch (err) {
    graphBuffer = null;
  }

  const bgSvg = `<svg width="${W}" height="${H}">
    <defs>
      <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0%" stop-color="#070707"/>
        <stop offset="100%" stop-color="#0b0b10"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
  </svg>`;

  const title = "UnStableCoin — FUD Dodge";
  const sub = `@${String(username).replace(/^@+/, "")}  •  MCap: ${score}`;

  const textSvg = `<svg width="${W}" height="${H}">
    <style>
      .title { fill: #ffd400; font-family: 'Press Start 2P', monospace; font-size:34px; font-weight:bold; }
      .sub { fill: #ffffff; font-family: 'Press Start 2P', monospace; font-size:22px; opacity:0.95; }
      .badge { fill: rgba(255,212,0,0.06); stroke: rgba(255,212,0,0.18); stroke-width:1; rx:8; }
    </style>
    <rect x="40" y="36" width="${W - 80}" height="100" rx="10" class="badge" />
    <text x="80" y="80" class="title">${escapeXml(title)}</text>
    <text x="80" y="110" class="sub">${escapeXml(sub)}</text>
  </svg>`;

  try {
    let img = sharp(Buffer.from(bgSvg)).resize(W, H);

    if (graphBuffer) {
      const graphW = Math.floor(W * 0.86);
      const graphH = Math.floor(H * 0.62);
      const graphImg = await sharp(graphBuffer).resize(graphW, graphH, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();

      img = img.composite([
        { input: graphImg, left: Math.floor((W - graphW) / 2), top: Math.floor(H * 0.18) },
        { input: Buffer.from(textSvg), left: 0, top: 0 }
      ]);
    } else {
      img = img.composite([{ input: Buffer.from(textSvg), left: 0, top: 0 }]);
    }

    const out = await img.png().toBuffer();
    return out;
  } catch (err) {
    console.error("❌ composeShareImage failed:", err?.message || err);
    throw err;
  }
}

/* ============================
   Leaderboard helpers
   ============================ */
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

async function getEventMeta() {
  try {
    const res = await axios.get(`${META_BIN_URL}/latest`, { headers: { "X-Master-Key": JSONBIN_KEY } });
    const payload = res.data.record || res.data || {};
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

/* ============================
   sendSafeMessage helper
   ============================ */
async function sendSafeMessage(chatId, message, opts = {}) {
  try {
    await bot.sendMessage(chatId, message, Object.assign({ parse_mode: "HTML", disable_web_page_preview: true }, opts));
  } catch (err) {
    console.error("❌ Telegram send failed:", err?.message || err);
  }
}

/* ============================
   sendChunked for long lists
   ============================ */
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

/* ============================
   Telegram Commands: core & admin
   ============================ */

// /help (shows admin commands only to admin usernames)
bot.onText(/\/help/, async (msg) => {
  try {
    const isAdmin = ADMIN_USERS.includes((msg.from.username || "").toLowerCase());
    const lines = [
      "🎮 <b>FUD Dodge — Bot Commands</b>",
      "🎮 /play — Get link to the game",
      "🏆 /top10 — Top 10 players (global)",
      "📈 /top50 — Top 50 players (global)",
      "⚡ /eventtop10 — Event top 10 (verified if enabled)",
      "🥇 /eventtop50 — Event top 50 (verified if enabled)",
      "📢 /event — Show current event info",
      "📋 /holders — (admins) list stored holder records",
      ""
    ];

    if (isAdmin) {
      lines.push("🔧 Admin commands:");
      lines.push("/setholdingreq &lt;whole_tokens&gt; — Set required whole tokens to qualify");
      lines.push("/winners [n] — Show confirmed winners (verified during event)");
      lines.push("/validatewinners — Re-check top event holders on-chain");
      lines.push("/resetevent — Reset event leaderboard (confirm step)");
      lines.push("/setevent Title | Info | YYYY-MM-DD | HH:mm | [TZ] — Set event");
    }

    await sendSafeMessage(msg.chat.id, lines.join("\n"), { parse_mode: "HTML" });
  } catch (err) {
    console.error("❌ /help error:", err?.message || err);
  }
});

// /play
bot.onText(/\/play/, async (msg) => {
  try {
    const isPrivate = msg.chat.type === "private";
    if (isPrivate) {
      await bot.sendMessage(msg.chat.id, "🎮 <b>Play FUD Dodge</b>", {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "⚡ Open Game", web_app: { url: "https://theunstable.io/fuddodge" } }]] },
      });
    } else {
      await bot.sendMessage(msg.chat.id, "💨 FUD levels too high here 😅\nPlay safely in DM 👇", {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "⚡ Open DM to Play", url: `https://t.me/${(await bot.getMe()).username}?start=play` }]] },
      });
    }
  } catch (err) {
    console.error("❌ /play error:", err?.message || err);
  }
});

// /info & /howtoplay
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

// /event (shows event meta)
bot.onText(/\/event$/, async (msg) => {
  try {
    const meta = await getEventMeta();
    let body = `<b>${escapeXml(meta.title)}</b>\n\n${escapeXml(meta.info)}`;
    if (meta.endDate) {
      const end = DateTime.fromISO(meta.endDate).setZone(meta.timezone || "Europe/Stockholm");
      const remaining = remainingTimeString(meta.endDate, meta.timezone);
      body += `\n\n⏳ <b>Ends in ${remaining}</b>\n🗓 ${end.toFormat("yyyy-MM-dd HH:mm ZZZZ")}`;
    }
    await sendSafeMessage(msg.chat.id, body);
  } catch (err) {
    console.error("❌ /event error:", err?.message || err);
    await sendSafeMessage(msg.chat.id, "⚠️ Could not load event info.");
  }
});

// /top10 /top50
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

// /eventtop10 /eventtop50 (prefers verified lists when enabled)
bot.onText(/\/eventtop10/, async (msg) => {
  try {
    const cfg = await getConfig();
    if (cfg.holderVerificationEnabled) {
      const host = RENDER_EXTERNAL_HOSTNAME || `https://unstablecoin-fuddodge-backend.onrender.com`;
      try {
        const arr = await axios.get(`${host}/eventverifiedtop10`).then(r => r.data);
        if (Array.isArray(arr) && arr.length) {
          const lines = arr.map((p, i) => `${i + 1}. <b>${p.username}</b> – ${p.score}`);
          return sendChunked(msg.chat.id, "<b>🥇 Event Top 10 (Verified holders)</b>\n\n", lines);
        }
      } catch (_) { /* fallback */ }
    }
    const { scores } = await getEventData();
    const sorted = Object.entries(scores).filter(([u]) => !u.startsWith("_")).sort((a, b) => b[1] - a[1]);
    if (!sorted.length) return sendSafeMessage(msg.chat.id, "No event scores yet.");
    const lines = sorted.slice(0, 10).map(([u, s], i) => `${i + 1}. <b>${u}</b> – ${s} pts`);
    sendChunked(msg.chat.id, "<b>🥇 Event Top 10</b>\n\n", lines);
  } catch (err) {
    console.error("❌ /eventtop10 error:", err?.message || err);
    sendSafeMessage(msg.chat.id, "⚠️ Failed to load event top10.");
  }
});
bot.onText(/\/eventtop50/, async (msg) => {
  try {
    const cfg = await getConfig();
    if (cfg.holderVerificationEnabled) {
      const host = RENDER_EXTERNAL_HOSTNAME || `https://unstablecoin-fuddodge-backend.onrender.com`;
      try {
        const arr = await axios.get(`${host}/eventverifiedtop50`).then(r => r.data);
        if (Array.isArray(arr) && arr.length) {
          const lines = arr.map((p, i) => `${i + 1}. <b>${p.username}</b> – ${p.score}`);
          return sendChunked(msg.chat.id, "<b>🥇 Event Top 50 (Verified holders)</b>\n\n", lines);
        }
      } catch (_) { /* fallback */ }
    }
    const { scores } = await getEventData();
    const sorted = Object.entries(scores).filter(([u]) => !u.startsWith("_")).sort((a, b) => b[1] - a[1]);
    if (!sorted.length) return sendSafeMessage(msg.chat.id, "No event scores yet.");
    const lines = sorted.slice(0, 50).map(([u, s], i) => `${i + 1}. <b>${u}</b> – ${s} pts`);
    sendChunked(msg.chat.id, "<b>🥇 Event Top 50</b>\n\n", lines);
  } catch (err) {
    console.error("❌ /eventtop50 error:", err?.message || err);
    sendSafeMessage(msg.chat.id, "⚠️ Failed to load event top50.");
  }
});

/* ============================
   Admin: setholdingreq, winners, validatewinners, resetevent, setevent
   ============================ */

// /setholdingreq <amount>
bot.onText(/\/setholdingreq ?(.+)?/, async (msg, match) => {
  try {
    const from = (msg.from.username || "").toLowerCase();
    if (!ADMIN_USERS.includes(from)) return sendSafeMessage(msg.chat.id, "🚫 Not authorized.");

    const param = (match && match[1]) ? match[1].trim() : null;
    if (!param || isNaN(parseInt(param))) {
      return sendSafeMessage(msg.chat.id, `Usage: /setholdingreq <whole_tokens>\nExample: /setholdingreq 500000`);
    }
    const amount = parseInt(param, 10);
    const updated = await updateConfig({ minHoldAmount: amount });
    await sendSafeMessage(msg.chat.id, `✅ Holding requirement updated to ${amount} whole tokens.\nConfig saved.`);
  } catch (err) {
    console.error("❌ /setholdingreq error:", err?.message || err);
    sendSafeMessage(msg.chat.id, "⚠️ Failed to update config.");
  }
});

// /winners [n]
bot.onText(/\/winners ?(.*)?/, async (msg, match) => {
  try {
    const from = (msg.from.username || "").toLowerCase();
    if (!ADMIN_USERS.includes(from)) return sendSafeMessage(msg.chat.id, "🚫 Not authorized.");

    const nParam = (match && match[1]) ? parseInt(match[1].trim()) : 10;
    const n = isNaN(nParam) ? 10 : nParam;

    const meta = await getEventMeta();
    const { scores } = await getEventData();
    const holders = await getHoldersMap();

    if (!meta.endDate) return sendSafeMessage(msg.chat.id, "⚠️ Event has no endDate set in meta.");

    const end = DateTime.fromISO(meta.endDate, { zone: "utc" });
    const eligible = Object.entries(scores)
      .filter(([u, s]) => {
        if (!holders[u] || !holders[u].verifiedAt) return false;
        const verifiedAt = DateTime.fromISO(holders[u].verifiedAt);
        return verifiedAt <= end;
      })
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([username, score], idx) => `${idx + 1}. ${username} — ${score}`);

    if (!eligible.length) return sendSafeMessage(msg.chat.id, "No confirmed winners (no verified holders during event).");

    let header = `<b>🏁 Confirmed Winners (verified during event)</b>\nEvent: ${escapeXml(meta.title || "UnStable Challenge")}\nEnds: ${DateTime.fromISO(meta.endDate).setZone(meta.timezone || "Europe/Stockholm").toFormat("yyyy-MM-dd HH:mm ZZZZ")}\n\n`;
    sendChunked(msg.chat.id, header, eligible);
  } catch (err) {
    console.error("❌ /winners error:", err?.message || err);
    sendSafeMessage(msg.chat.id, "⚠️ Failed to compute winners.");
  }
});

// /validatewinners
bot.onText(/\/validatewinners ?(.*)?/, async (msg, match) => {
  try {
    const from = (msg.from.username || "").toLowerCase();
    if (!ADMIN_USERS.includes(from)) return sendSafeMessage(msg.chat.id, "🚫 Not authorized.");

    const meta = await getEventMeta();
    if (!meta.endDate) return sendSafeMessage(msg.chat.id, "⚠️ Event has no endDate set in meta.");

    const { scores } = await getEventData();
    const holders = await getHoldersMap();
    const cfg = await getConfig();
    const required = cfg.minHoldAmount || 0;

    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 50);
    const results = [];
    for (const [uname, sc] of sorted) {
      const rec = holders[uname];
      if (!rec || !rec.wallet) {
        results.push({ username: uname, ok: false, reason: "no holder record" });
        continue;
      }
      const check = await checkSolanaHolding(rec.wallet, required);
      results.push({ username: uname, ok: check.ok, amount: check.amount, reason: check.ok ? "ok" : "insufficient" });
    }

    const lines = results.map((r, i) => `${i + 1}. ${r.username} — ${r.ok ? "✅" : "❌"} ${r.amount ? "(" + r.amount + ")" : ""} ${r.reason || ""}`);
    sendChunked(msg.chat.id, `<b>🔎 Revalidation results (top 50)</b>\n`, lines);
  } catch (err) {
    console.error("❌ /validatewinners error:", err?.message || err);
    sendSafeMessage(msg.chat.id, "⚠️ Validation failed.");
  }
});

// /resetevent (admin) - clears event scores after confirmation
bot.onText(/\/resetevent/, async (msg) => {
  try {
    const from = (msg.from.username || "").toLowerCase();
    if (!ADMIN_USERS.includes(from)) return sendSafeMessage(msg.chat.id, "🚫 Not authorized.");

    const chatId = msg.chat.id;
    await sendSafeMessage(chatId, "⚠️ Confirm reset of event leaderboard? Reply <b>YES</b> within 30s.");
    const listener = async (reply) => {
      if (reply.chat.id !== chatId) return;
      if ((reply.from.username || "").toLowerCase() !== from) return;
      if (String(reply.text || "").trim().toUpperCase() === "YES") {
        await writeBin(EVENT_BIN_URL, { scores: {} });
        await sendSafeMessage(chatId, "✅ Event leaderboard cleared.");
      } else {
        await sendSafeMessage(chatId, "❌ Cancelled.");
      }
      bot.removeListener("message", listener);
    };
    bot.on("message", listener);
    setTimeout(() => bot.removeListener("message", listener), 30000);
  } catch (err) {
    console.error("❌ /resetevent error:", err?.message || err);
    sendSafeMessage(msg.chat.id, "⚠️ Failed to reset event.");
  }
});

// /setevent (admin) - handled previously in user's original file, but include here too:
bot.onText(/\/setevent(.*)/, async (msg, match) => {
  try {
    const username = msg.from.username?.toLowerCase() || "";
    if (!ADMIN_USERS.includes(username)) return sendSafeMessage(msg.chat.id, "🚫 You are not authorized.");

    const args = match[1]?.trim();
    if (!args) {
      return sendSafeMessage(msg.chat.id,
`🛠 <b>How to create or update an event</b>

Use:
<code>/setevent &lt;Title&gt; | &lt;Description&gt; | &lt;Date&gt; | &lt;Time&gt; | [Timezone]</code>

Example:
<code>/setevent Meme Rally | Keep your MCap above FUD! | 2025-11-10 | 18:00 | CET</code>`, { parse_mode: "HTML" });
    }

    const parts = args.split("|").map((s) => s.trim());
    const [title, info, dateStr, timeStr, tzStrRaw] = parts;
    const tzMap = { CET: "Europe/Stockholm", CEST: "Europe/Stockholm", UTC: "UTC", GMT: "UTC" };
    const zone = tzMap[tzStrRaw?.toUpperCase()] || tzStrRaw || "Europe/Stockholm";
    const cleanDate = (dateStr || "").replace(/[–—]/g, "-");
    if (!cleanDate || !timeStr) {
      return sendSafeMessage(msg.chat.id, "❌ Missing date or time.\nExample: /setevent Title | Info | 2025-10-31 | 23:59 | CET");
    }
    const dt = DateTime.fromFormat(`${cleanDate} ${timeStr}`, "yyyy-MM-dd HH:mm", { zone });
    if (!dt.isValid) {
      return sendSafeMessage(msg.chat.id, "❌ Invalid date/time format.\nUse: YYYY-MM-DD | HH:mm | [TZ]");
    }
    const newData = {
      title: title || "⚡️ Unstable Challenge",
      info: info || "Score big, stay unstable!",
      endDate: dt.toUTC().toISO(),
      endLocal: dt.setZone(zone).toFormat("yyyy-MM-dd HH:mm ZZZZ"),
      timezone: zone,
      updatedAt: new Date().toISOString(),
    };
    await writeBin(META_BIN_URL, newData);
    await sendSafeMessage(msg.chat.id, `✅ <b>Event updated!</b>\n⚡️ <b>${newData.title}</b>\n${newData.info}\n⏳ Ends: ${newData.endLocal} (${zone})`);
  } catch (err) {
    console.error("❌ /setevent error:", err?.message || err);
    sendSafeMessage(msg.chat.id, "⚠️ Failed to update event (internal error).");
  }
});

/* ============================
   Admin: /holders - list stored holder records (admin only)
   ============================ */
bot.onText(/\/holders/, async (msg) => {
  try {
    const from = (msg.from.username || "").toLowerCase();
    if (!ADMIN_USERS.includes(from)) return sendSafeMessage(msg.chat.id, "🚫 Not authorized.");

    const holders = await getHoldersMap();
    const lines = Object.entries(holders || {}).map(([u, rec]) => {
      const when = rec?.verifiedAt || rec?.timestamp || "n/a";
      const wallet = rec?.wallet || "n/a";
      return `<b>${u}</b> — ${wallet} — ${when}`;
    });
    if (!lines.length) return sendSafeMessage(msg.chat.id, "No holder records.");
    sendChunked(msg.chat.id, "<b>📋 Stored Holder Records</b>\n", lines);
  } catch (err) {
    console.error("❌ /holders error:", err?.message || err);
    sendSafeMessage(msg.chat.id, "⚠️ Failed to load holders.");
  }
});

/* ============================
   FRONTEND ENDPOINTS
   - /submit (same logic as earlier, protected by event times)
   - /share (compose image and send to Telegram chatId)
   - /verifyHolder (quick on-chain check + save)
   - eventverifiedtop10 / eventverifiedtop50
   ============================ */

// /submit
app.post("/submit", async (req, res) => {
  try {
    const { username, score, target } = req.body;
    const adminKey = req.headers["x-admin-key"];
    const isAdmin = adminKey && adminKey === RESET_KEY;

    if (!username || typeof score !== "number") {
      return res.status(400).json({ error: "Invalid data" });
    }

    // load event meta
    let eventMeta = {};
    try {
      const resp = await axios.get(`${META_BIN_URL}/latest`, { headers: { "X-Master-Key": JSONBIN_KEY } });
      eventMeta = resp.data.record || {};
    } catch (err) {
      console.warn("⚠️ Failed to load event meta:", err.message);
    }

    const now = DateTime.now().toUTC();
    const end = eventMeta.endDate ? DateTime.fromISO(eventMeta.endDate) : null;
    const eventActive = end ? now < end : false;

    if (!eventActive && !isAdmin && target !== "main") {
      return res.json({
        success: false,
        message: "⚠️ Event has ended. Stay tuned for the next ⚡️ UnStable Challenge!",
        eventActive: false,
        endDate: eventMeta.endDate || null,
      });
    }

    // MAIN
    if (target !== "event") {
      const main = await getLeaderboard();
      const prev = main[username] || 0;
      if (score > prev || isAdmin) {
        main[username] = score;
        await writeBin(MAIN_BIN_URL, main);
      }
    }

    // EVENT
    if (target !== "main") {
      const { scores } = await getEventData();
      const prev = scores[username] || 0;
      if (score > prev || isAdmin) {
        scores[username] = score;
        await writeBin(EVENT_BIN_URL, { scores });
      }
    }

    res.json({ success: true, message: "✅ Score submitted successfully.", eventActive, endDate: eventMeta.endDate || null });
  } catch (err) {
    console.error("❌ Submit failed:", err.message || err);
    res.status(500).json({ error: "Failed to submit score" });
  }
});

// /share (called from frontend): { username, score, chatId, imageBase64 }
app.post("/share", async (req, res) => {
  try {
    const { username, score, chatId, imageBase64 } = req.body;
    if (!username || typeof score === "undefined" || !chatId) {
      return res.status(400).json({ error: "Missing username, score or chatId" });
    }

    const cfg = await getConfig();
    const holders = await getHoldersMap();

    if (!cfg.allowPostingWithoutHold) {
      const rec = holders[username];
      if (!rec) {
        return res.status(403).json({ ok: false, message: "User not a verified holder. Posting blocked." });
      }
    }

    const imgBuf = await composeShareImage(imageBase64, username, score);
    const caption = `<b>${escapeXml(String(username))}</b>\nMCap: ${escapeXml(String(score))}\nShared from UnStableCoin FUD Dodge`;

    // chatId might be a username (@group) or numeric id
    await bot.sendPhoto(chatId.toString(), imgBuf, { caption, parse_mode: "HTML" });

    res.json({ ok: true, message: "Posted to Telegram" });
  } catch (err) {
    console.error("❌ /share error:", err?.message || err);
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// === Holder Verification Logic ===

// 🔹 Check wallet token balance on Solana
async function verifySolanaBalance(wallet) {
  try {
    const { Connection, clusterApiUrl, PublicKey } = require("@solana/web3.js");
    const connection = new Connection(clusterApiUrl(CONFIG.network), "confirmed");

    const publicKey = new PublicKey(wallet);
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
      mint: new PublicKey(CONFIG.tokenMint)
    });

    // Sum all token balances
    let totalBalance = 0;
    tokenAccounts.value.forEach(acc => {
      const amount = acc.account.data.parsed.info.tokenAmount.uiAmount;
      totalBalance += amount;
    });

    console.log(`💰 Wallet ${wallet} holds ${totalBalance} tokens`);
    return totalBalance >= CONFIG.minHoldAmount;
  } catch (err) {
    console.error("❌ verifySolanaBalance error:", err);
    return false;
  }
}

// === Verify Holder Endpoint ===
app.post("/verifyHolder", async (req, res) => {
  try {
    let { username, wallet } = req.body;

    if (!username || !wallet)
      return res.status(400).json({ ok: false, message: "Missing username or wallet." });

    // ✅ Normalize username: ensure one @, keep user’s casing
    username = username.trim();
    if (!username.startsWith("@")) username = "@" + username.replace(/^@+/, "");

    // 🔹 Load current holders from JSONBin
    const holdersRes = await axios.get(
      `https://api.jsonbin.io/v3/b/${process.env.HOLDER_JSONBIN_ID}`,
      { headers: { "X-Master-Key": process.env.JSONBIN_KEY } }
    );

    let holders = holdersRes.data.record;
    if (!Array.isArray(holders)) holders = []; // ✅ Fix for non-array record

    // ✅ Case-insensitive duplicate check
    const alreadyExists = holders.some(
      (h) => h.username.toLowerCase() === username.toLowerCase()
    );
    if (alreadyExists) {
      console.log(`⚠️ Holder ${username} already verified.`);
      return res.json({ ok: true, message: "Already verified.", username });
    }

    // 🔹 Verify wallet on-chain
    const verified = await verifySolanaBalance(wallet);
    if (!verified) {
      return res.json({ ok: false, message: "Wallet balance below minimum requirement." });
    }

    // ✅ Add new verified holder
    holders.push({
      username, // stored exactly as written by user
      wallet,
      verifiedAt: new Date().toISOString()
    });

    // 🔹 Save to JSONBin
    await axios.put(
      `https://api.jsonbin.io/v3/b/${process.env.HOLDER_JSONBIN_ID}`,
      holders,
      {
        headers: {
          "Content-Type": "application/json",
          "X-Master-Key": process.env.JSONBIN_KEY
        }
      }
    );

    console.log(`✅ Added new holder: ${username}`);
    return res.json({ ok: true, message: "✅ Holder verified successfully!", username });

  } catch (err) {
    console.error("❌ verifyHolder error:", err);
    res.status(500).json({ ok: false, message: "Server error verifying holder." });
  }
});

// eventverifiedtop10 / eventverifiedtop50
app.get("/eventverifiedtop10", async (req, res) => {
  try {
    const { scores } = await getEventData();
    const holders = await getHoldersMap();
    const arr = Object.entries(scores)
      .filter(([u, s]) => !u.startsWith("_") && holders[u] && holders[u].verifiedAt)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([username, score]) => ({ username, score }));
    res.json(arr);
  } catch (err) {
    console.error("❌ /eventverifiedtop10 failed:", err?.message || err);
    res.status(500).json({ error: "Failed to load event verified top10" });
  }
});

app.get("/eventverifiedtop50", async (req, res) => {
  try {
    const { scores } = await getEventData();
    const holders = await getHoldersMap();
    const arr = Object.entries(scores)
      .filter(([u, s]) => !u.startsWith("_") && holders[u] && holders[u].verifiedAt)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([username, score]) => ({ username, score }));
    res.json(arr);
  } catch (err) {
    console.error("❌ /eventverifiedtop50 failed:", err?.message || err);
    res.status(500).json({ error: "Failed to load event verified top50" });
  }
});

/* ============================
   START SERVER
   ============================ */
app.listen(PORT, () => {
  console.log(`🚀 UnStableCoinBot running on port ${PORT}`);
  (async () => {
    try {
      const cfg = await getConfig();
      console.log("✅ Config loaded:", {
        tokenMint: cfg.tokenMint,
        minHoldAmount: cfg.minHoldAmount,
        network: cfg.network
      });
    } catch (_) {}
  })();
});
