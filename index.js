/*
==========================================================
🧩 UnStableCoin Bot v3.2 — Full Wallet Flow + Events + ATH
Build: 2025-10-17  |  TEST MODE: ON
==========================================================
📑 TABLE OF CONTENTS (search these headers quickly on phone)
1)  Imports & Config Defaults
2)  Environment & Constants
3)  Express + Telegram Webhook Setup
4)  Small Utilities (sleep, escape, normalize, validators)
5)  JSONBin Helpers (readBin, writeBin)
6)  Config & Holders (get/save helpers & maps)
7)  Solana Checks (isLikelySolanaAddress, on-chain balance)
8)  Image Composition (share image + ATH banner)
9)  Leaderboards & Event Data (main + event + meta)
10) Telegram: Safe send helpers (sendSafeMessage, sendChunked)
11) Telegram: Main Menu UI (keyboard) + /start /menu
12) Telegram: Core Commands
    • /help /play /info /event
    • /top10 /top50
    • /eventtop10 /eventtop50
13) Telegram: Wallet Flows (Add / Change / Remove / Verify)
    • /addwallet — register wallet
    • /changewallet — update with YES confirm
    • /removewallet — remove with YES confirm
    • /verifyholder — manual trigger (backend verify)
14) Telegram: Button Text Router (works with white buttons)
15) HTTP: Frontend Endpoints
    • GET /event, /eventtop10, /eventtop50
    • POST /verifyHolder, GET /holderStatus
    • POST /submit
    • POST /share, POST /athbannerpreview
    • GET  /athleaders, /athrecords
16) Server Start (logs config on boot)
==========================================================
*/

//
// 1) IMPORTS & CONFIG DEFAULTS
//
const express = require("express");
const bodyParser = require("body-parser");
const TelegramBot = require("node-telegram-bot-api");
const cors = require("cors");
const axios = require("axios");
require("dotenv").config();

const { DateTime } = require("luxon");
const sharp = require("sharp");
const { Connection, PublicKey, clusterApiUrl } = require("@solana/web3.js");

const CONFIG_DEFAULTS = {
  tokenMint: "6zzHz3X3s53zhEqyBMmokZLh6Ba5EfC5nP3XURzYpump",
  minHoldAmount: 500000,
  network: "mainnet-beta",
};

// 🧪 TEST toggles (keep ON while testing)
const ATH_TEST_MODE = true;                   // allow share even if not new ATH
const TEST_ATH_CHAT_ID = "8067310645";       // where images are posted in test

//
// 2) ENVIRONMENT & CONSTANTS
//
const TELEGRAM_BOT_TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const JSONBIN_ID           = process.env.JSONBIN_ID;
const EVENT_JSONBIN_ID     = process.env.EVENT_JSONBIN_ID;
const JSONBIN_KEY          = process.env.JSONBIN_KEY;
const EVENT_META_JSONBIN_ID= process.env.EVENT_META_JSONBIN_ID;
const RESET_KEY            = process.env.RESET_KEY;
const CONFIG_JSONBIN_ID    = process.env.CONFIG_JSONBIN_ID;
const HOLDER_JSONBIN_ID    = process.env.HOLDER_JSONBIN_ID;
const ATH_JSONBIN_ID       = process.env.ATH_JSONBIN_ID;
const RENDER_EXTERNAL_HOSTNAME = process.env.RENDER_EXTERNAL_HOSTNAME || null;
const PORT = process.env.PORT || 10000;

if (
  !TELEGRAM_BOT_TOKEN || !JSONBIN_ID || !EVENT_JSONBIN_ID || !JSONBIN_KEY ||
  !EVENT_META_JSONBIN_ID || !RESET_KEY || !CONFIG_JSONBIN_ID || !HOLDER_JSONBIN_ID ||
  !ATH_JSONBIN_ID
) {
  console.error("❌ Missing env vars. Required: TELEGRAM_BOT_TOKEN, JSONBIN_ID, EVENT_JSONBIN_ID, JSONBIN_KEY, EVENT_META_JSONBIN_ID, RESET_KEY, CONFIG_JSONBIN_ID, HOLDER_JSONBIN_ID, ATH_JSONBIN_ID");
  process.exit(1);
}

const MAIN_BIN_URL  = `https://api.jsonbin.io/v3/b/${JSONBIN_ID}`;
const EVENT_BIN_URL = `https://api.jsonbin.io/v3/b/${EVENT_JSONBIN_ID}`;
const META_BIN_URL  = `https://api.jsonbin.io/v3/b/${EVENT_META_JSONBIN_ID}`;
const CONFIG_BIN_URL= `https://api.jsonbin.io/v3/b/${CONFIG_JSONBIN_ID}`;
const HOLDER_BIN_URL= `https://api.jsonbin.io/v3/b/${HOLDER_JSONBIN_ID}`;
const ATH_BIN_URL   = `https://api.jsonbin.io/v3/b/${ATH_JSONBIN_ID}`;

const ADMIN_USERS = ["unstablecoinx", "unstablecoinx_bot", "pachenko_14"]; // lowercase usernames

// ==========================================================
// 3) EXPRESS + TELEGRAM POLLING SETUP (replaces webhook mode)
// ==========================================================
const app = express();
app.use(cors({ origin: "*" }));
app.use(bodyParser.json({ limit: "15mb" }));
app.use(bodyParser.urlencoded({ extended: true }));

// ✅ Use polling instead of webhook — makes commands respond instantly (no Render timeout)
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// Log any Telegram polling issues
bot.on("polling_error", (err) => {
  console.error("⚠️ Polling error:", err?.message || err);
});

// Health check endpoint for uptime monitor or manual visits
app.get("/", (_req, res) => {
  res.send("💛 UnStableCoin Bot v3.2 running (polling mode active).");
});

// Telegram webhook endpoint
app.post(`/bot${TELEGRAM_BOT_TOKEN}`, (req, res) => {
  try { bot.processUpdate(req.body); } catch (e) { console.error("❌ processUpdate:", e?.message || e); }
  res.sendStatus(200);
});

app.get("/", (_req, res) => res.send("💛 UnStableCoin Bot v3.2 running."));

//
// 4) SMALL UTILITIES
//
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function escapeXml(unsafe) {
  return String(unsafe)
    .replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&apos;")
    .replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function normalizeUsername(u) {
  if (!u) return null;
  const base = u.toString().trim().replace(/^@+/, "");
  return "@" + base;
}
function normalizeName(n) {
  if (!n) return "";
  return String(n).trim().replace(/^@+/, "").toLowerCase();
}

// simple in-memory cache for short periods
const _cache = {};

// ==========================================================
// 5) JSONBin Helpers (readBin + writeBin)
// ==========================================================
async function readBin(url, tries = 3) {
  // Return cached version if <30s old
  const c = _cache[url];
  if (c && Date.now() - c.t < 30_000) return c.data;

  for (let i = 0; i < tries; i++) {
    try {
      const resp = await axios.get(url, {
        headers: { "X-Master-Key": JSONBIN_KEY },
      });

      // 🧩 Normalize all possible response shapes
      let data = resp.data?.record ?? resp.data ?? {};
      if (data.record) data = data.record;          // unwrap nested record
      if (Array.isArray(data.record)) data = data.record; // double nested
      if (data?.scores) data = data.scores;          // handle old score format

      _cache[url] = { t: Date.now(), data };
      return data;
    } catch (err) {
      const code = err?.response?.status;
      if (code === 429 && i < tries - 1) {
        const delay = 1000 * (i + 1);
        console.warn(`⏳ 429 rate-limit hit — waiting ${delay} ms`);
        await sleep(delay);
        continue;
      }
      console.error("❌ readBin:", err?.message || err);
      return null;
    }
  }
  return null;
}

async function writeBin(url, payload, tries = 3) {
  // 🧹 Flatten any nested 'record' layers before saving
  let flat = payload;
  while (flat && flat.record && typeof flat.record === "object") {
    flat = flat.record;
  }

  for (let i = 0; i < tries; i++) {
    try {
      const resp = await axios.put(url, flat, {
        headers: {
          "Content-Type": "application/json",
          "X-Master-Key": JSONBIN_KEY,
        },
      });
      return resp.data;
    } catch (err) {
      const code = err?.response?.status;
      if (code === 429 && i < tries - 1) {
        await sleep(250 * (i + 1));
        continue;
      }
      console.error("❌ writeBin:", err?.message || err);
      throw err;
    }
  }
}

//
// 6) CONFIG & HOLDERS
//
async function getConfig() {
  const cfg = (await readBin(CONFIG_BIN_URL)) || {};
  return Object.assign(
    {
      tokenMint: CONFIG_DEFAULTS.tokenMint,
      minHoldAmount: CONFIG_DEFAULTS.minHoldAmount,
      network: CONFIG_DEFAULTS.network,
      checkIntervalHours: 24,
      holderVerificationEnabled: true,
      allowPostingWithoutHold: false,
      lastUpdated: new Date().toISOString(),
    },
    cfg
  );
}
async function updateConfig(patch) {
  const cur = (await readBin(CONFIG_BIN_URL)) || {};
  const merged = Object.assign({}, cur, patch, { lastUpdated: new Date().toISOString() });
  await writeBin(CONFIG_BIN_URL, merged);
  return merged;
}
async function getHoldersArray() {
  const arr = (await readBin(HOLDER_BIN_URL)) || [];
  return Array.isArray(arr) ? arr : [];
}
async function saveHoldersArray(arr) {
  try {
    // 🧩 Always ensure array format for JSONBin
    if (!Array.isArray(arr)) arr = [];
    await writeBin(HOLDER_BIN_URL, [...arr]); // clone to avoid ref issues
    delete _cache[HOLDER_BIN_URL];
    return true;
  } catch (err) {
    console.error("❌ saveHoldersArray:", err?.message || err);
    return false;
  }
}
// --- Add this back ---
async function getHoldersMapFromArray() {
  try {
    const arr = await getHoldersArray();
    const map = {};
    for (const h of arr) {
      if (h?.username) map[h.username] = h;
    }
    return map;
  } catch (err) {
    console.error("⚠️ getHoldersMapFromArray failed:", err?.message || err);
    return {};
  }
}

//
// 7) SOLANA CHECKS
//
function isLikelySolanaAddress(s) {
  try { const pk = new PublicKey(s); return PublicKey.isOnCurve(pk.toBytes()); }
  catch (_) { return false; }
}
async function checkSolanaHolding(walletAddress, requiredWholeTokens) {
  try {
    const config = await getConfig();
    const rpc = process.env.SOLANA_RPC_URL || clusterApiUrl(config.network || "mainnet-beta");
    const conn = new Connection(rpc, "confirmed");

    const ownerPub = new PublicKey(walletAddress);
    const mintPub  = new PublicKey(config.tokenMint);

    const parsed = await conn.getParsedTokenAccountsByOwner(ownerPub, { mint: mintPub });
    if (!parsed.value || parsed.value.length === 0) return { ok: false, amount: 0, decimals: 0 };

    let total = 0, decimals = 0;
    for (const acc of parsed.value) {
      const info = acc.account?.data?.parsed?.info?.tokenAmount;
      if (!info) continue;
      decimals = info.decimals || 0;
      total += (parseFloat(info.amount || 0) / Math.pow(10, decimals));
    }
    const whole = Math.floor(total);
    return { ok: whole >= requiredWholeTokens, amount: total, whole, decimals };
  } catch (err) {
    console.error("❌ checkSolanaHolding:", err?.message || err);
    return { ok: false, amount: 0, whole: 0, decimals: 0, error: err?.message || String(err) };
  }
}

//
// 8) IMAGE COMPOSITION
//
async function composeShareImage(graphBase64, username, score) {
  const W = 1200, H = 628;
  let base64 = graphBase64 || "";
  const m = base64.match(/^data:image\/(png|jpeg);base64,(.*)$/);
  if (m) base64 = m[2];

  let graphBuffer = null;
  try { if (base64) graphBuffer = Buffer.from(base64, "base64"); } catch (_) {}

  const bgSvg = `<svg width="${W}" height="${H}">
    <defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#070707"/><stop offset="100%" stop-color="#0b0b10"/>
    </linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
  </svg>`;

  const title = "UnStableCoin – FUD Dodge";
  const sub   = `@${String(username).replace(/^@+/, "")}  •  MCap: ${score}`;
  const textSvg = `<svg width="${W}" height="${H}">
    <style>
      .title{fill:#ffd400;font-family:'Press Start 2P',monospace;font-size:34px;font-weight:bold}
      .sub{fill:#fff;font-family:'Press Start 2P',monospace;font-size:22px;opacity:.95}
      .badge{fill:rgba(255,212,0,.06);stroke:rgba(255,212,0,.18);stroke-width:1;rx:8}
    </style>
    <rect x="40" y="36" width="${W-80}" height="100" rx="10" class="badge" />
    <text x="80" y="80" class="title">${escapeXml(title)}</text>
    <text x="80" y="110" class="sub">${escapeXml(sub)}</text>
  </svg>`;

  let img = sharp(Buffer.from(bgSvg)).resize(W, H);
  if (graphBuffer) {
    const graphW = Math.floor(W * 0.86);
    const graphH = Math.floor(H * 0.62);
    const graphImg = await sharp(graphBuffer).resize(graphW, graphH, { fit: "contain", background: { r:0,g:0,b:0,alpha:0 } }).toBuffer();
    img = img.composite([{ input: graphImg, left: Math.floor((W-graphW)/2), top: Math.floor(H*0.18) }, { input: Buffer.from(textSvg), left: 0, top: 0 }]);
  } else {
    img = img.composite([{ input: Buffer.from(textSvg), left: 0, top: 0 }]);
  }
  return await img.png().toBuffer();
}

async function composeAthBanner(curveBase64, username, score) {
  const rocketPath = "./assets/ath_banner_square.png";
  const W = 1200, H = 628, leftW = Math.floor(W*0.55), rightW = W-leftW;
  const square = Math.min(leftW, H);

  let chartBuf = null;
  try {
    if (curveBase64) {
      const m = curveBase64.match(/^data:image\/(png|jpeg);base64,(.*)$/);
      const b = m ? m[2] : curveBase64;
      chartBuf = Buffer.from(b, "base64");
    }
  } catch (_) {}

  const leftImg = await sharp(rocketPath).resize(square, square, { fit:"contain", background: { r:0,g:0,b:0,alpha:1 } }).toBuffer();
  let rightImg = null;
  if (chartBuf) rightImg = await sharp(chartBuf).resize(square, square, { fit:"contain", background:{ r:0,g:0,b:0,alpha:1 } }).toBuffer();

  const base = sharp({ create: { width: W, height: H, channels: 4, background: { r:0,g:0,b:0,alpha:1 } }});
  const comps = [
    { input: leftImg,  top: Math.floor((H-square)/2), left: Math.floor((leftW-square)/2) },
    { input: await sharp({ create:{ width:3,height:H,channels:4, background:{ r:0,g:255,b:200,alpha:.5 }}}).png().toBuffer(), top:0, left:leftW-2 },
  ];
  if (rightImg) comps.push({ input: rightImg, top: Math.floor((H-square)/2), left: leftW + Math.floor((rightW-square)/2) });
  return await base.composite(comps).png().toBuffer();
}

// ==========================================================
// 9) LEADERBOARDS & EVENT DATA (Unified & Debugged Version)
// ==========================================================

/** Normalize usernames and keep only numeric scores */
function _normalizeScoreMap(obj) {
  const out = {};
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj)) {
    const n = Number(v);
    if (!Number.isNaN(n)) {
      const name = k.startsWith("@") ? k : "@" + k;
      out[name] = n;
    }
  }
  return out;
}

/** Safely unwrap and normalize any JSONBin leaderboard structure */
function _extractScoresFromBin(raw) {
  let data = raw;

  if (data && data.record && typeof data.record === "object") data = data.record;
  while (data && typeof data === "object" && data.record && typeof data.record === "object") {
    const siblings = {};
    for (const [k, v] of Object.entries(data)) {
      if (k !== "record") siblings[k] = v;
    }
    data = Object.assign({}, siblings, data.record);
  }
  if (data && data.scores && typeof data.scores === "object") data = data.scores;

  return _normalizeScoreMap(data);
}

/** 🔍 Read and log main leaderboard bin */
async function getLeaderboard() {
  try {
    const res = await axios.get(`${MAIN_BIN_URL}/latest`, {
      headers: { "X-Master-Key": JSONBIN_KEY },
    });

    console.log("🟡 RAW FROM BIN:", JSON.stringify(res.data, null, 2));

    const data = _extractScoresFromBin(res.data);
    console.log("🏁 FINAL CLEAN LEADERBOARD:", data);
    return data;
  } catch (err) {
    console.error("❌ getLeaderboard:", err?.message || err);
    return {};
  }
}

/** 🔍 Read and log event leaderboard bin */
async function getEventData() {
  try {
    const res = await axios.get(`${EVENT_BIN_URL}/latest`, {
      headers: { "X-Master-Key": JSONBIN_KEY },
    });

    console.log("🟣 RAW EVENT BIN:", JSON.stringify(res.data, null, 2));

    const data = _extractScoresFromBin(res.data);
    console.log("🏁 FINAL CLEAN EVENT SCORES:", data);

    return { scores: data };
  } catch (err) {
    console.error("❌ getEventData:", err?.message || err);
    return { scores: {} };
  }
}

/** Retrieve event metadata */
async function getEventMeta() {
  try {
    const res = await axios.get(`${META_BIN_URL}/latest`, {
      headers: { "X-Master-Key": JSONBIN_KEY },
    });
    const p = res.data.record || res.data || {};
    return {
      title: p.title || p.name || "Current Event",
      info: p.info || p.description || "",
      startDate: p.startDate || null,
      endDate: p.endDate || null,
      timezone: p.timezone || "Europe/Stockholm",
      updatedAt: p.updatedAt || res.data?.metadata?.modifiedAt || new Date().toISOString(),
      raw: p,
    };
  } catch (err) {
    console.error("❌ getEventMeta:", err?.message || err);
    return {
      title: "No active event",
      info: "",
      startDate: null,
      endDate: null,
      timezone: "Europe/Stockholm",
      updatedAt: new Date().toISOString(),
      raw: {},
    };
  }
}

/** Filter top verified holders */
async function getVerifiedEventTop(n = 10) {
  const { scores } = await getEventData();
  const holdersMap = await getHoldersMapFromArray();
  const cfg = await getConfig();
  const minHold = cfg.minHoldAmount || 0;

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const out = [];
  for (const [uname, score] of sorted) {
    const rec = holdersMap[uname];
    if (!rec?.wallet) continue;
    const check = await checkSolanaHolding(rec.wallet, minHold);
    if (check.ok) out.push({ username: uname, score });
    if (out.length >= n) break;
  }
  return out;
}

// ==========================================================
// 🌐 EXPRESS ENDPOINTS
// ==========================================================
app.get("/leaderboard", async (_req, res) => {
  try {
    const data = await getLeaderboard();
    const arr = Object.entries(data)
      .map(([username, score]) => ({ username, score }))
      .sort((a, b) => b.score - a.score);
    res.json(arr);
  } catch (err) {
    console.error("❌ /leaderboard:", err?.message || err);
    res.status(500).json({ ok: false, message: "Failed to load leaderboard" });
  }
});

// ==========================================================
// 🏆 LEADERBOARD COMMANDS — CLEAN SINGLE-VERSION
// ==========================================================

// --- FIXED CHUNKED SEND HELPER (no duplicates, only chunks if needed) ---
async function sendChunked(chatId, header, lines, maxLen = 3500) {
  const full = header + lines.join("\n");
  if (full.length <= maxLen) {
    await sendSafeMessage(chatId, full.trim());
    return;
  }
  let buf = header;
  for (const line of lines) {
    if ((buf + line + "\n").length > maxLen) {
      await sendSafeMessage(chatId, buf.trim());
      buf = header + line + "\n";
    } else buf += line + "\n";
  }
  if (buf.trim()) await sendSafeMessage(chatId, buf.trim());
}

// --- MAIN TOP 10 ---
bot.onText(/^\/top10$/, async (msg) => {
  try {
    const data = await getLeaderboard();
    const sorted = Object.entries(data || {}).sort((a, b) => b[1] - a[1]);

    if (!sorted.length) {
      await sendSafeMessage(msg.chat.id, "⚠️ No scores yet!");
      return;
    }

    const lines = sorted
      .slice(0, 10)
      .map(([u, s], i) => `${i + 1}. <b>${u}</b> – ${s}`);

    await sendChunked(msg.chat.id, "<b>🏆 Top 10</b>\n\n", lines);
  } catch (err) {
    console.error("❌ /top10:", err?.message || err);
    await sendSafeMessage(msg.chat.id, "⚠️ Failed to load Top 10 leaderboard.");
  }
});

// --- MAIN TOP 50 ---
bot.onText(/^\/top50$/, async (msg) => {
  try {
    const data = await getLeaderboard();
    const sorted = Object.entries(data || {}).sort((a, b) => b[1] - a[1]);

    if (!sorted.length) {
      await sendSafeMessage(msg.chat.id, "⚠️ No scores yet!");
      return;
    }

    const lines = sorted
      .slice(0, 50)
      .map(([u, s], i) => `${i + 1}. <b>${u}</b> – ${s}`);

    await sendChunked(msg.chat.id, "<b>📈 Top 50 Players</b>\n\n", lines);
  } catch (err) {
    console.error("❌ /top50:", err?.message || err);
    await sendSafeMessage(msg.chat.id, "⚠️ Failed to load Top 50 leaderboard.");
  }
});
//
// 10) TELEGRAM SAFE SEND HELPERS
//
async function sendSafeMessage(chatId, message, opts = {}) {
  try {
    await bot.sendMessage(chatId, message, Object.assign({ parse_mode: "HTML", disable_web_page_preview: true }, opts));
  } catch (err) { console.error("❌ sendMessage:", err?.message || err); }
}
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

//
// 11) TELEGRAM MAIN MENU UI (+ /start /menu)
//
const mainMenu = {
  reply_markup: {
    keyboard: [
      [{ text: "🪙 Add Wallet" }, { text: "⚡ Verify Holder" }],
      [{ text: "🔁 Change Wallet" }, { text: "❌ Remove Wallet" }],
      [{ text: "🏆 Leaderboard" }, { text: "🚀 Current Event" }],
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
  },
};

bot.onText(/\/start|\/menu/i, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(
    chatId,
    `💛 Welcome to <b>UnStableCoin</b>\nUse the buttons to manage wallet or join the event.`,
    { ...mainMenu, parse_mode: "HTML" }
  );
});

//
// 12) TELEGRAM CORE COMMANDS
//
bot.onText(/\/help/, async (msg) => {
  const isAdmin = ADMIN_USERS.includes((msg.from.username || "").toLowerCase());
  const lines = [
    "🎮 <b>FUD Dodge — Bot Commands</b>",
    "🎮 /play — Game link",
    "🏆 /top10 — Top 10",
    "📈 /top50 — Top 50",
    "⚡ /eventtop10 — Event top 10 (holders)",
    "🥇 /eventtop50 — Event top 50 (holders)",
    "📢 /event — Current event info",
    "",
  ];
  if (isAdmin) {
    lines.push("🔧 Admin:");
    lines.push("/winners [n] — Check top event holders now");
    lines.push("/resetevent — Reset event leaderboard");
    lines.push("/setevent Title | Info | start-YYYY-MM-DD | start-HH:mm | end-YYYY-MM-DD | end-HH:mm | [TZ]");
  }
  await sendSafeMessage(msg.chat.id, lines.join("\n"));
});

bot.onText(/\/play/, async (msg) => {
  const isPrivate = msg.chat.type === "private";
  if (isPrivate) {
    await bot.sendMessage(msg.chat.id, "🎮 <b>Play FUD Dodge</b>", {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "⚡ Open Game", web_app: { url: "https://theunstable.io/fuddodge" } }]] },
    });
  } else {
    const me = await bot.getMe();
    await bot.sendMessage(msg.chat.id, "Play safely in DM 👇", {
      reply_markup: { inline_keyboard: [[{ text: "⚡ Open DM", url: `https://t.me/${me.username}?start=play` }]] },
    });
  }
});

bot.onText(/\/info|\/howtoplay/, (msg) => {
  const text = `
🎮 <b>How to Play FUD Dodge</b>

🪙 Dodge FUD & scams. Collect coins/memes to grow MCap.
⚡ Power-ups: Lightning, Coin, Green Candle, Meme
💀 Threats: FUD Skull, Red Candle, The Scammer (-50%)
📊 Compete: /top10 • /eventtop10

Stay unstable. 💛⚡`;
  sendSafeMessage(msg.chat.id, text);
});

// --- /event command (clean version with start + end timer) ---
bot.onText(/\/event$/, async (msg) => {
  try {
    const meta = await getEventMeta();
    const tz = meta.timezone || "Europe/Stockholm";
    const now = DateTime.now().setZone(tz);

    let body = `<b>${escapeXml(meta.title || "Current Event")}</b>\n\n${escapeXml(meta.info || "")}`;

    if (meta.startDate) {
      const start = DateTime.fromISO(meta.startDate).setZone(tz);
      const end = meta.endDate ? DateTime.fromISO(meta.endDate).setZone(tz) : null;

      if (now < start) {
        const diff = start.diff(now, ["days", "hours", "minutes"]).toObject();
        const remain = `${diff.days ? Math.floor(diff.days) + "d " : ""}${diff.hours ? Math.floor(diff.hours) + "h " : ""}${diff.minutes ? Math.floor(diff.minutes) + "m" : ""}`.trim();
        body += `\n🟡 Starts in ${remain}`;
      } else if (end && now < end) {
        const diff = end.diff(now, ["days", "hours", "minutes"]).toObject();
        const remain = `${diff.days ? Math.floor(diff.days) + "d " : ""}${diff.hours ? Math.floor(diff.hours) + "h " : ""}${diff.minutes ? Math.floor(diff.minutes) + "m" : ""}`.trim();
        body += `\n⏳ Ends in ${remain}`;
      } else if (end && now >= end) {
        body += `\n🔴 Event ended ${end.toFormat("yyyy-MM-dd HH:mm ZZZZ")}`;
        body += `\n📜 Stay tuned for next event.`;
      }

      body += `\n🕓 ${start.toFormat("yyyy-MM-dd HH:mm ZZZZ")}`;
      if (end) body += ` → ${end.toFormat("yyyy-MM-dd HH:mm ZZZZ")}`;
    } else {
      body += `\n⚠️ No active event found.`;
    }

    await sendSafeMessage(msg.chat.id, body);
  } catch (err) {
    console.error("❌ /event:", err?.message || err);
    await sendSafeMessage(msg.chat.id, "⚠️ Could not load event info.");
  }
});
// ==========================================================
// 🥇 VERIFIED EVENT LEADERBOARDS (auto structure support)
// ==========================================================

// --- EVENT TOP 10 (live verification + holding requirement shown) ---
bot.onText(/^\/eventtop10$/, async (msg) => {
  try {
    const { scores } = await getEventData();
    if (!scores || !Object.keys(scores).length)
      return sendSafeMessage(msg.chat.id, "⚠️ No event scores recorded yet.");

    const holdersMap = await getHoldersMapFromArray();
    const cfg = await getConfig();
    const minHold = cfg.minHoldAmount || 0;
    const now = Date.now();

    const sorted = Object.entries(scores)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    const lines = [];
    for (const [uname, score] of sorted) {
      const rec = holdersMap[uname];
      let mark = "⚪";
      if (rec?.wallet) {
        const lastCheck = rec.verifiedAt ? new Date(rec.verifiedAt).getTime() : 0;
        const expired = !lastCheck || now - lastCheck > 6 * 60 * 60 * 1000; // 6h
        if (expired) {
          const check = await checkSolanaHolding(rec.wallet, minHold);
          if (check.ok) {
            mark = "✅";
            rec.verifiedAt = new Date().toISOString();
          }
        } else {
          mark = "✅";
        }
      }
      lines.push(`${lines.length + 1}. ${mark} <b>${uname}</b> – ${score}`);
    }

    lines.push(
      `\n✅ = verified holder | ⚪ = unverified (live check every 6h)`,
      `Minimum holding requirement: <b>${minHold.toLocaleString()}</b> $US`
    );

    await sendChunked(msg.chat.id, "<b>🥇 Event Top 10</b>\n\n", lines);
  } catch (err) {
    console.error("❌ /eventtop10:", err?.message || err);
    await sendSafeMessage(msg.chat.id, "⚠️ Failed to load event top10.");
  }
});

// --- EVENT TOP 50 (cached verification + holding requirement shown) ---
bot.onText(/^\/eventtop50$/, async (msg) => {
  try {
    const { scores } = await getEventData();
    if (!scores || !Object.keys(scores).length)
      return sendSafeMessage(msg.chat.id, "⚠️ No event scores recorded yet.");

    const holdersMap = await getHoldersMapFromArray();
    const cfg = await getConfig();
    const minHold = cfg.minHoldAmount || 0;
    const now = Date.now();

    const sorted = Object.entries(scores)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50);

    const lines = [];
    for (const [uname, score] of sorted) {
      const rec = holdersMap[uname];
      let mark = "⚪";

      if (rec?.wallet && rec?.verifiedAt) {
        const lastCheck = new Date(rec.verifiedAt).getTime();
        const expired = now - lastCheck > 6 * 60 * 60 * 1000;
        if (expired) {
          // silent background refresh (non-blocking)
          checkSolanaHolding(rec.wallet, minHold).then((check) => {
            if (check.ok) rec.verifiedAt = new Date().toISOString();
          });
        }
        mark = "✅";
      }
      lines.push(`${lines.length + 1}. ${mark} <b>${uname}</b> – ${score}`);
    }

    lines.push(
      `\n✅ = verified (cached, rechecked every 6h) | ⚪ = not yet verified`,
      `Minimum holding requirement: <b>${minHold.toLocaleString()}</b> $US`
    );

    await sendChunked(msg.chat.id, "<b>📈 Event Top 50</b>\n\n", lines);
  } catch (err) {
    console.error("❌ /eventtop50:", err?.message || err);
    await sendSafeMessage(msg.chat.id, "⚠️ Failed to load event top50.");
  }
});
// ==========================================================
// 🏁 ADMIN COMMAND — /winners
// ==========================================================
bot.onText(/^\/winners(?:\s+(\d+))?/, async (msg, match) => {
  const username = (msg.from?.username || "").toLowerCase();
  if (!ADMIN_USERS.includes(username)) {
    return sendSafeMessage(msg.chat.id, "⚠️ Only admins can run this command.");
  }

  try {
    const limit = parseInt(match[1], 10) || 10;
    const winners = await getVerifiedEventTop(limit);

    if (!winners.length) {
      await sendSafeMessage(msg.chat.id, "📭 No verified event winners yet.");
      return;
    }

    const lines = winners.map((w, i) => `${i + 1}. <b>${w.username}</b> – ${w.score}`);
    sendChunked(
      msg.chat.id,
      `<b>🏁 Current Verified Winners (Top ${limit})</b>\n\n`,
      lines
    );
  } catch (err) {
    console.error("❌ /winners:", err?.message || err);
    await sendSafeMessage(msg.chat.id, "⚠️ Failed to load winners.");
  }
});

// === 🧠 Admin-only: Set event with | separated values ===
// Example:
// /setevent Meme Cup | Prepare your best memes | 2025-10-22 | 18:00 | 2025-10-25 | 23:59 | CET
bot.onText(/^\/setevent (.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const username = (msg.from.username || "").toLowerCase();

  if (!ADMIN_USERS.includes(username)) {
    return bot.sendMessage(chatId, "⛔ You’re not authorized to use this command.");
  }

  try {
    const parts = match[1].split("|").map((p) => p.trim());
    const [title, info, startDate, startTime, endDate, endTime, tz] = parts;

    if (!title || !startDate || !endDate) {
      return bot.sendMessage(
        chatId,
        "❌ Invalid format.\n\nUse:\n/setevent Title | Info | StartDate | StartTime | EndDate | EndTime | TZ\n\nExample:\n/setevent Meme Cup | Prepare your best memes | 2025-10-22 | 18:00 | 2025-10-25 | 23:59 | CET"
      );
    }

    // --- Handle missing times or timezone defaults ---
    const timezone = tz || "Europe/Stockholm";
    const startISO = DateTime.fromISO(`${startDate}T${startTime || "00:00"}`, { zone: timezone }).toUTC().toISO();
    const endISO = DateTime.fromISO(`${endDate}T${endTime || "23:59"}`, { zone: timezone }).toUTC().toISO();

    // --- Build object and save to JSONBin ---
    const payload = {
      title,
      info: info || "",
      startDate: startISO,
      endDate: endISO,
      timezone,
      updatedAt: new Date().toISOString(),
    };

    await axios.put(
      `https://api.jsonbin.io/v3/b/${EVENT_META_JSONBIN_ID}`,
      payload,
      { headers: { "Content-Type": "application/json", "X-Master-Key": JSONBIN_KEY } }
    );

    // --- Confirmation message ---
    const start = DateTime.fromISO(startISO).setZone(timezone);
    const end = DateTime.fromISO(endISO).setZone(timezone);
    const now = DateTime.now().setZone(timezone);
    let note = "";

    if (now < start) {
      const diff = start.diff(now, ["days", "hours", "minutes"]).toObject();
      const remain = `${diff.days ? Math.floor(diff.days) + "d " : ""}${diff.hours ? Math.floor(diff.hours) + "h " : ""}${diff.minutes ? Math.floor(diff.minutes) + "m" : ""}`.trim();
      note = `🟡 Starts in ${remain}`;
    } else if (now < end) {
      const diff = end.diff(now, ["days", "hours", "minutes"]).toObject();
      const remain = `${diff.days ? Math.floor(diff.days) + "d " : ""}${diff.hours ? Math.floor(diff.hours) + "h " : ""}${diff.minutes ? Math.floor(diff.minutes) + "m" : ""}`.trim();
      note = `⏳ Ends in ${remain}`;
    } else {
      note = "🔴 Event already ended.";
    }

    await bot.sendMessage(
      chatId,
      `✅ Event updated!\n\n<b>${title}</b>\n${info || ""}\n\n🕓 ${start.toFormat("yyyy-MM-dd HH:mm ZZZZ")} → ${end.toFormat("yyyy-MM-dd HH:mm ZZZZ")}\n${note}`,
      { parse_mode: "HTML" }
    );
  } catch (err) {
    console.error("SetEvent error:", err.response?.data || err.message);
    bot.sendMessage(chatId, "⚠️ Failed to update event. Check syntax or keys.");
  }
});


// ==========================================================
// 13) TELEGRAM: WALLET FLOWS (FOOL-PROOF VERSION)
// ==========================================================
bot.onText(/\/addwallet|\/changewallet|\/removewallet|\/verifyholder/i, async (msg) => {
  const chatId = msg.chat.id;
  const realUser = msg.from?.username;
  if (!realUser)
    return bot.sendMessage(chatId, "❌ You need a Telegram username (Settings → Username).");

  const holders = await getHoldersArray();
  const existing = holders.find((h) => normalizeName(h.username) === normalizeName(realUser));

  try {
    const lower = msg.text.toLowerCase();

    // === ADD WALLET ===
    if (lower.includes("addwallet")) {
      if (existing) {
        await bot.sendMessage(
          chatId,
          `⚠️ You already have a wallet saved, @${realUser}.\nUse /changewallet instead.`,
          mainMenu
        );
        return;
      }

      await bot.sendMessage(chatId, "🪙 Add wallet – please paste your Solana wallet address:");
      bot.once("message", async (m2) => {
        const wallet = (m2.text || "").trim();
        if (!isLikelySolanaAddress(wallet)) {
          await bot.sendMessage(chatId, "❌ Invalid wallet address. Try again with /addwallet.", mainMenu);
          return;
        }
        holders.push({ username: "@" + realUser, wallet, verifiedAt: null });
        await saveHoldersArray(holders);
        delete _cache[HOLDER_BIN_URL];
        await bot.sendMessage(chatId, `✅ Wallet added for @${realUser}! Use /verifyholder to confirm holdings.`, mainMenu);
      });
      return;
    }

    // === CHANGE WALLET ===
    if (lower.includes("changewallet")) {
      if (!existing) {
        await bot.sendMessage(
          chatId,
          `⚠️ You don’t have any wallet saved yet, @${realUser}.\nUse /addwallet first.`,
          mainMenu
        );
        return;
      }

      await bot.sendMessage(chatId, "Do you really want to change your wallet?", {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ Yes, change it", callback_data: "confirm_change_yes" },
              { text: "❌ Cancel", callback_data: "confirm_change_no" },
            ],
          ],
        },
      });
      return;
    }

    // === REMOVE WALLET ===
    if (lower.includes("removewallet")) {
      if (!existing) {
        await bot.sendMessage(
          chatId,
          `⚠️ You don’t have any wallet saved yet, @${realUser}.`,
          mainMenu
        );
        return;
      }
      await bot.sendMessage(chatId, "Are you sure you want to remove your wallet?", {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ Yes, remove", callback_data: "confirm_remove_yes" },
              { text: "❌ Cancel", callback_data: "confirm_remove_no" },
            ],
          ],
        },
      });
      return;
    }

    // === VERIFY HOLDER ===
    if (lower.includes("verifyholder")) {
      if (!existing?.wallet) {
        await bot.sendMessage(chatId, "⚠️ No wallet on file. Use /addwallet first.", mainMenu);
        return;
      }

      await bot.sendMessage(chatId, "🔍 Checking on-chain balance...");
      const res = await axios.post(
        `https://unstablecoin-fuddodge-backend.onrender.com/verifyHolder`,
        { username: "@" + realUser, wallet: existing.wallet }
      );

      if (res.data.ok)
        await bot.sendMessage(chatId, `✅ Verified successfully for @${realUser}!`, mainMenu);
      else
        await bot.sendMessage(
          chatId,
          `⚠️ Verification failed: ${res.data.message || "Not enough tokens."}`,
          mainMenu
        );
      return;
    }
  } catch (err) {
    console.error("⚠️ Wallet flow error:", err?.message || err);
    await bot.sendMessage(chatId, "⚠️ Something went wrong. Try again later.", mainMenu);
  }
});

// === CALLBACK CONFIRMATIONS (Change / Remove) ===
bot.on("callback_query", async (cb) => {
  const chatId = cb.message.chat.id;
  const realUser = cb.from.username;

  try {
    const holders = await getHoldersArray();
    const existing = holders.find((h) => normalizeName(h.username) === normalizeName(realUser));

    // === CHANGE CONFIRM ===
    if (cb.data === "confirm_change_yes") {
      await bot.answerCallbackQuery(cb.id, { text: "Proceeding..." });
      await bot.sendMessage(chatId, "Paste your new Solana wallet address:");
      bot.once("message", async (m2) => {
        const wallet = (m2.text || "").trim();
        if (!isLikelySolanaAddress(wallet)) {
          await bot.sendMessage(chatId, "❌ Invalid wallet address. Try again with /changewallet.", mainMenu);
          return;
        }
        const cfg = await getConfig();
        const check = await checkSolanaHolding(wallet, cfg.minHoldAmount || 0);
        if (!check.ok) {
          await bot.sendMessage(chatId, `❌ Wallet doesn’t meet minimum ${cfg.minHoldAmount} token requirement.`, mainMenu);
          return;
        }
        existing.prevWallet = existing.wallet || null;
        existing.wallet = wallet;
        existing.verifiedAt = new Date().toISOString();
        existing.changedAt = new Date().toISOString();
        await saveHoldersArray(holders);
        delete _cache[HOLDER_BIN_URL];
        await bot.sendMessage(
          chatId,
          `✅ Wallet updated for @${realUser}.\n<code>${wallet}</code>`,
          { parse_mode: "HTML", ...mainMenu }
        );
      });
      return;
    }

    if (cb.data === "confirm_change_no") {
      await bot.answerCallbackQuery(cb.id, { text: "Cancelled." });
      await bot.sendMessage(chatId, "❌ Wallet change cancelled.", mainMenu);
      return;
    }

    // === REMOVE CONFIRM ===
    if (cb.data === "confirm_remove_yes") {
      await bot.answerCallbackQuery(cb.id, { text: "Removing..." });
      if (!existing) {
        await bot.sendMessage(chatId, "⚠️ No wallet to remove.", mainMenu);
        return;
      }
      const updated = holders.filter((h) => normalizeName(h.username) !== normalizeName(realUser));
      await saveHoldersArray(updated);
      delete _cache[HOLDER_BIN_URL];
      console.log(`🧹 Removed wallet for @${realUser}`);
      await bot.sendMessage(chatId, `🧹 Wallet removed for @${realUser}.`, mainMenu);
      return;
    }

    if (cb.data === "confirm_remove_no") {
      await bot.answerCallbackQuery(cb.id, { text: "Cancelled." });
      await bot.sendMessage(chatId, "❌ Wallet removal cancelled.", mainMenu);
      return;
    }

  } catch (err) {
    console.error("callback_query:", err?.message || err);
    await bot.answerCallbackQuery(cb.id, { text: "Error. Try again later." });
  }
});
// ==========================================================
// 14) TELEGRAM: BUTTON TEXT ROUTER (FINAL NO-LOOP VERSION)
// ==========================================================
bot.on("message", async (msg) => {
  try {
    if (!msg.text || msg.text.startsWith("/")) return; // skip commands

    const t = msg.text.toLowerCase();
    let command = null;

    if (t.includes("add wallet")) command = "/addwallet";
    else if (t.includes("verify")) command = "/verifyholder";
    else if (t.includes("change")) command = "/changewallet";
    else if (t.includes("remove")) command = "/removewallet";
    else if (t.includes("leader")) command = "/top10";
    else if (t.includes("event")) command = "/event";
    else return;

    // 🔹 Instead of re-emitting to Telegram’s message system,
    // just trigger the corresponding command handler directly.
    bot.emit("manual_command", { ...msg, text: command });
  } catch (err) {
    console.error("⚠️ Router error:", err?.message || err);
  }
});

// ==========================================================
// 15) INTERNAL MANUAL COMMAND HANDLER (no recursion ever)
// ==========================================================
bot.on("manual_command", async (msg) => {
  try {
    const text = msg.text?.trim();
    if (!text) return;

    // Map to each existing command
    if (text === "/addwallet") return bot.emitTextCommand("/addwallet", msg);
    if (text === "/verifyholder") return bot.emitTextCommand("/verifyholder", msg);
    if (text === "/changewallet") return bot.emitTextCommand("/changewallet", msg);
    if (text === "/removewallet") return bot.emitTextCommand("/removewallet", msg);
    if (text === "/top10") return bot.emitTextCommand("/top10", msg);
    if (text === "/event") return bot.emitTextCommand("/event", msg);
  } catch (err) {
    console.error("⚠️ Manual command handler error:", err?.message || err);
  }
});

// ==========================================================
// 15) Helper to call existing onText() handlers safely
// ==========================================================
bot.emitTextCommand = (pattern, msg) => {
  // Re-use existing registered /command handlers by simulating their regex match
  const handlers = bot._textRegexpCallbacks || [];
  for (const { regexp, callback } of handlers) {
    if (regexp.test(pattern)) return callback(msg, pattern.match(regexp));
  }
};
// ==========================================================
// 15) INTERNAL TEXT → REAL COMMAND DISPATCHER (safe)
// ----------------------------------------------------------
// Handles the synthetic /commands triggered by router above.
// The _internal flag prevents recursive loops.
// ==========================================================
bot.on("text", (msg) => {
  try {
    if (!msg._internal) return; // only handle internal ones
    bot.processUpdate({ message: msg });
  } catch (err) {
    console.error("⚠️ Dispatcher error:", err?.message || err);
  }
});

//
// 15) HTTP: FRONTEND ENDPOINTS
//
// Verify holder (from game)
app.post("/verifyHolder", async (req, res) => {
  try {
    let { username, wallet } = req.body;
    if (!username || !wallet) return res.status(400).json({ ok:false, message:"Missing username or wallet." });
    username = normalizeUsername(username);

    if (!isLikelySolanaAddress(wallet)) return res.status(400).json({ ok:false, message:"Invalid Solana address format." });

    const holders = await getHoldersArray();
    const already = holders.find(h => h.username.toLowerCase() === username.toLowerCase());
    const verified = await checkSolanaHolding(wallet, (await getConfig()).minHoldAmount || 0);

    if (!verified.ok) return res.json({ ok:false, message:"Wallet balance below minimum requirement." });

    if (already) {
      already.prevWallet = already.wallet || null;
      already.wallet = wallet;
      already.verifiedAt = new Date().toISOString();
      already.changedAt  = new Date().toISOString();
    } else {
      holders.push({ username, wallet, verifiedAt: new Date().toISOString() });
    }
    await saveHoldersArray(holders);
    res.json({ ok:true, message:"✅ Holder verified successfully!", username });
  } catch (err) {
    console.error("verifyHolder:", err?.message || err);
    res.status(500).json({ ok:false, message:"Server error verifying holder." });
  }
});

app.get("/holderStatus", async (req, res) => {
  try {
    let username = req.query.username;
    if (!username) return res.status(400).json({ verified:false, message:"Missing username" });
    username = normalizeUsername(username);
    const holders = await getHoldersArray();
    const match = holders.find(h => h.username?.toLowerCase() === username.toLowerCase());
    if (match?.wallet) {
      return res.json({ verified: !!match.verifiedAt, username: match.username, wallet: match.wallet, verifiedAt: match.verifiedAt || null });
    }
    res.json({ verified:false });
  } catch (err) {
    console.error("holderStatus:", err?.message || err);
    res.status(500).json({ verified:false, message:"Server error checking holder status" });
  }
});

// Event & Leaderboards for frontend
app.get("/event", async (_req, res) => {
  try {
    const meta = await getEventMeta();
    res.json({ title: meta.title, info: meta.info, startDate: meta.startDate, endDate: meta.endDate, timezone: meta.timezone });
  } catch (_) { res.status(500).json({ ok:false, message:"Failed to load event" }); }
});
// === FRONTEND EVENT TOP 10 ===
app.get("/eventtop10", async (req, res) => {
  try {
    const data = await readBin(EVENT_BIN_URL); // ✅ use existing helper
    const sorted = Object.entries(data)
      .map(([username, score]) => ({ username, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    // === Add holder verification like Telegram does ===
    const holdersMap = await getHoldersMapFromArray();
    const cfg = await getConfig();
    const minHold = cfg.minHoldAmount || 0;
    const now = Date.now();

    const verifiedResults = await Promise.all(
      sorted.map(async (p) => {
        const rec = holdersMap[p.username];
        let verified = false;
        if (rec?.wallet) {
          const lastCheck = rec.verifiedAt ? new Date(rec.verifiedAt).getTime() : 0;
          const expired = !lastCheck || now - lastCheck > 6 * 60 * 60 * 1000;
          if (expired) {
            const check = await checkSolanaHolding(rec.wallet, minHold);
            verified = check.ok;
            if (verified) rec.verifiedAt = new Date().toISOString();
          } else verified = true;
        }
        return { ...p, verified };
      })
    );

    res.json(verifiedResults);
  } catch (err) {
    console.error("EventTop10 failed:", err);
    res.status(500).json({ error: "Failed to load event leaderboard" });
  }
});


app.get("/eventtop50", async (_req, res) => {
  try { res.json(await getVerifiedEventTop(50)); }
  catch (_) { res.status(500).json({ ok:false, message:"Failed to load event top50" }); }
});

// === FRONTEND CONFIG ENDPOINT (for minHold + settings) ===
app.get("/config", async (_req, res) => {
  try {
    const cfg = await getConfig();
    console.log("✅ /config served:", {
      tokenMint: cfg.tokenMint,
      minHoldAmount: cfg.minHoldAmount,
      network: cfg.network,
    });
    res.json(cfg);
  } catch (err) {
    console.error("❌ /config:", err?.message || err);
    res.status(500).json({ ok: false, message: "Failed to load config" });
  }
});

// === MAIN LEADERBOARD for frontend (used by splash) ===
app.get("/leaderboard", async (_req, res) => {
  try {
    const data = await getLeaderboard();
    // convert map → array
    const arr = Object.entries(data)
      .map(([username, score]) => ({ username, score }))
      .sort((a, b) => b.score - a.score);
    res.json(arr);
  } catch (err) {
    console.error("leaderboard:", err?.message || err);
    res.status(500).json({ ok: false, message: "Failed to load leaderboard" });
  }
});

// Submit scores (main + event)
app.post("/submit", async (req, res) => {
  try {
    const { username, score, target } = req.body;
    const adminKey = req.headers["x-admin-key"];
    const isAdmin = adminKey && adminKey === RESET_KEY;

    if (!username || typeof score !== "number")
      return res.status(400).json({ error: "Invalid data" });

    // Load event metadata to see if it’s still active
    let eventMeta = {};
    try {
      const r = await axios.get(`${META_BIN_URL}/latest`, {
        headers: { "X-Master-Key": JSONBIN_KEY },
      });
      eventMeta = r.data.record || {};
    } catch (err) {
      console.warn("⚠️ load event meta:", err?.message);
    }

    const now = DateTime.now().toUTC();
    const end = eventMeta.endDate ? DateTime.fromISO(eventMeta.endDate) : null;
    const eventActive = end ? now < end : false;

    // === ✅ Always update main leaderboard with new highs ===
    const main = await getLeaderboard();
    const prev = main[username] || 0;
    if (score > prev || isAdmin) {
      main[username] = score;
      await writeBin(MAIN_BIN_URL, main);
    }

    // === Update event leaderboard only if active or admin ===
    if ((eventActive || isAdmin) && target !== "main") {
      const { scores } = await getEventData();
      const prevEvent = scores[username] || 0;
      if (score > prevEvent || isAdmin) {
        scores[username] = score;
        await writeBin(EVENT_BIN_URL, { scores });
      }
    }

    res.json({
      success: true,
      message: "✅ Score submitted.",
      eventActive,
      endDate: eventMeta.endDate || null,
    });
  } catch (err) {
    console.error("submit:", err?.message || err);
    res.status(500).json({ error: "Failed to submit score" });
  }
});

// ATH storage
async function getAthMap() {
  const raw = (await readBin(ATH_BIN_URL)) || {};
  return typeof raw === "object" && raw ? raw : {};
}
async function saveAthMap(map) { await writeBin(ATH_BIN_URL, map); return true; }

// ==========================================================
// 📤 SHARE ENDPOINT (Unified A.T.H. + Normal Mode)
// ==========================================================
app.post("/share", async (req, res) => {
  try {
    const { username, score, chatId, imageBase64, mode, curveImage } = req.body;
    if (!username) return res.status(400).json({ ok: false, message: "Missing username" });

    const cfg = await getConfig();
    const holders = await getHoldersMapFromArray();
    if (!cfg.allowPostingWithoutHold) {
      const rec = holders[username] || holders[normalizeUsername(username)];
      if (!rec)
        return res.status(403).json({ ok: false, message: "User not a verified holder. Posting blocked." });
    }

    const targetChatId = String(chatId || TEST_ATH_CHAT_ID);
    const isAth = String(mode).toLowerCase() === "ath";

    // ----------------------------------------------------------
    // 🧠 Load the single source of truth (main leaderboard bin)
    // ----------------------------------------------------------
    let data = {};
    try {
      const r = await axios.get(MAIN_BIN_URL, { headers: { "X-Master-Key": JSONBIN_KEY } });
      data = r.data.record || r.data || {};
      if (data.scores && typeof data.scores === "object") data = data.scores;
    } catch (err) {
      console.error("share: failed to read leaderboard bin:", err?.message || err);
    }

    // Helper for tolerant username match
    const lookupUserScore = (map, name) => {
      if (!map || !name) return 0;
      const want = name.replace(/^@/, "").toLowerCase();
      for (const [k, v] of Object.entries(map)) {
        const clean = k.replace(/^@/, "").toLowerCase();
        if (clean === want) return Number(v) || 0;
      }
      return 0;
    };

    // ----------------------------------------------------------
    // 🚀 A.T.H. MODE
    // ----------------------------------------------------------
    if (isAth) {
      try {
        const currentBoardScore = lookupUserScore(data, username);
        const incoming = Number(score) || 0;

        // True A.T.H. comes from whichever is higher
        const athToShow = Math.max(currentBoardScore, incoming);

        // Update the bin if incoming > stored
        if (incoming > currentBoardScore) {
          const updated = Object.assign({}, data, { [normalizeUsername(username)]: incoming });
          await writeBin(MAIN_BIN_URL, updated);
        }

        // Compose banner
        const banner = await composeAthBanner(curveImage || imageBase64 || null, username, athToShow);

        // Find position in leaderboard
        let positionText = "unranked";
        try {
          const sorted = Object.entries(data).sort((a, b) => b[1] - a[1]);
          const idx = sorted.findIndex(
            ([u]) => u.replace(/^@/, "").toLowerCase() === username.replace(/^@/, "").toLowerCase()
          );
          if (idx >= 0) positionText = `#${idx + 1}`;
        } catch (_) {}

        const formatMCap = (v) => {
          const n = Number(v) || 0;
          if (n >= 1_000_000) return (n / 1_000_000).toFixed(2).replace(/\.?0+$/, "") + "M";
          if (n >= 1_000) return (n / 1_000).toFixed(2).replace(/\.?0+$/, "") + "k";
          return n.toFixed(2).replace(/\.?0+$/, "");
        };

        const caption =
          `${escapeXml(normalizeUsername(username))} reached a new All-Time-High. ⚡\n` +
          `A.T.H. MCap: ${formatMCap(athToShow)}\n` +
          `Current rank: ${positionText}\n` +
          `We aim for Win-Win.`;

        await bot.sendPhoto(targetChatId, banner, { caption, parse_mode: "HTML" });
        return res.json({ ok: true, message: "Posted A.T.H. banner", ath: athToShow });
      } catch (err) {
        console.error("share (ATH):", err?.message || err);
        return res.status(500).json({ ok: false, message: "Failed to post A.T.H. banner." });
      }
    }

    // ----------------------------------------------------------
    // 🟡 NORMAL SHARE (non-ATH)
    // ----------------------------------------------------------
    try {
      const buf = await composeShareImage(imageBase64, username, Number(score) || 0);
      const caption =
        `<b>${escapeXml(normalizeUsername(String(username)))}</b>\n` +
        `MCap: ${escapeXml(String(Number(score) || 0))}\n` +
        `Shared from UnStableCoin FUD Dodge`;
      await bot.sendPhoto(targetChatId, buf, { caption, parse_mode: "HTML" });
      return res.json({ ok: true, message: "Posted to Telegram" });
    } catch (err) {
      console.error("share (non-ATH):", err?.message || err);
      return res.status(500).json({ ok: false, message: "Share failed" });
    }
  } catch (err) {
    console.error("share:", err?.message || err);
    return res.status(500).json({ ok: false, message: err?.message || "Share failed" });
  }
});
// ✅ closes /share cleanly
// ATH preview (returns PNG)
app.post("/athbannerpreview", async (req, res) => {
  try {
    const { username, score, curveImage } = req.body;
    if (!username || typeof score === "undefined") return res.status(400).json({ ok:false, message:"Missing username or score" });
    const banner = await composeAthBanner(curveImage || null, username, score);
    res.setHeader("Content-Type", "image/png");
    res.send(banner);
  } catch (err) {
    console.error("athbannerpreview:", err?.message || err);
    res.status(500).json({ ok:false, message:"Failed to compose preview" });
  }
});

// ATH leaders (by milestones)
app.get("/athleaders", async (_req, res) => {
  try {
    const map = await getAthMap();
    const rows = Object.keys(map).map(u => ({
      username: u,
      ath: map[u]?.ath || 0,
      milestones: Array.isArray(map[u]?.milestones) ? map[u].milestones.length : 0,
      lastSentAt: map[u]?.lastSentAt || null,
    }));
    rows.sort((a,b)=> b.milestones - a.milestones || b.ath - a.ath);
    res.json(rows);
  } catch (err) { res.status(500).json({ ok:false, message:"Failed to load A.T.H. leaders" }); }
});
app.get("/athrecords", async (_req, res) => {
  try { res.json(await getAthMap()); }
  catch (err) { res.status(500).json({ ok:false, message:"Failed to load A.T.H. records" }); }
});


//
// 16) SERVER START
//
app.listen(PORT, async () => {
  console.log(`🚀 UnStableCoin Bot v3.2 running on ${PORT}`);
  try {
    const cfg = await getConfig();
    console.log("✅ Config:", { tokenMint: cfg.tokenMint, minHoldAmount: cfg.minHoldAmount, network: cfg.network });
  } catch (_) {}
});
