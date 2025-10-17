// === UnStableCoin Game Bot ===
// ⚡ Version: Full + EventStart/End + WinnersPeriodCheck + ATH Share + Preview + Verified Event Lists + Public Event API
//      + Secure Wallet Change/Remove (challenge-based) + Robust JSONBin retries
// Author: UnStableCoin Community
// ------------------------------------

/*
  Required environment variables:
  - TELEGRAM_BOT_TOKEN
  - JSONBIN_ID
  - EVENT_JSONBIN_ID
  - JSONBIN_KEY
  - EVENT_META_JSONBIN_ID
  - RESET_KEY
  - CONFIG_JSONBIN_ID
  - HOLDER_JSONBIN_ID
  - ATH_JSONBIN_ID
  - RENDER_EXTERNAL_HOSTNAME (optional)
  - SOLANA_RPC_URL         (optional)
*/

const CONFIG_DEFAULTS = {
  tokenMint: '6zzHz3X3s53zhEqyBMmokZLh6Ba5EfC5nP3XURzYpump',
  minHoldAmount: 500000,
  network: 'mainnet-beta'
};

// === TEST MODE TOGGLES ===
const ATH_TEST_MODE = true;                 // keep ON until you say otherwise
const TEST_ATH_CHAT_ID = '8067310645';      // keep until you request change

// === IMPORTS ===
const express = require("express");
const bodyParser = require("body-parser");
const TelegramBot = require("node-telegram-bot-api");
const cors = require("cors");
const axios = require("axios");
require("dotenv").config();

const { DateTime } = require("luxon");
const sharp = require("sharp");
const { Connection, PublicKey, clusterApiUrl } = require("@solana/web3.js");

// === ENVIRONMENT VALIDATION ===
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const JSONBIN_ID = process.env.JSONBIN_ID;
const EVENT_JSONBIN_ID = process.env.EVENT_JSONBIN_ID;
const JSONBIN_KEY = process.env.JSONBIN_KEY;
const EVENT_META_JSONBIN_ID = process.env.EVENT_META_JSONBIN_ID;
const RESET_KEY = process.env.RESET_KEY;
const CONFIG_JSONBIN_ID = process.env.CONFIG_JSONBIN_ID;
const HOLDER_JSONBIN_ID = process.env.HOLDER_JSONBIN_ID;
const ATH_JSONBIN_ID = process.env.Ath_JSONBIN_ID || process.env.ATH_JSONBIN_ID; // tolerate casing
const RENDER_EXTERNAL_HOSTNAME = process.env.RENDER_EXTERNAL_HOSTNAME || null;

if (
  !TELEGRAM_BOT_TOKEN ||
  !JSONBIN_ID ||
  !EVENT_JSONBIN_ID ||
  !JSONBIN_KEY ||
  !EVENT_META_JSONBIN_ID ||
  !RESET_KEY ||
  !CONFIG_JSONBIN_ID ||
  !HOLDER_JSONBIN_ID ||
  !ATH_JSONBIN_ID
) {
  console.error("❌ Missing required env vars. Set TELEGRAM_BOT_TOKEN, JSONBIN_ID, EVENT_JSONBIN_ID, JSONBIN_KEY, EVENT_META_JSONBIN_ID, RESET_KEY, CONFIG_JSONBIN_ID, HOLDER_JSONBIN_ID, ATH_JSONBIN_ID");
  process.exit(1);
}

// === CONSTANTS & URLS ===
const MAIN_BIN_URL   = `https://api.jsonbin.io/v3/b/${JSONBIN_ID}`;
const EVENT_BIN_URL  = `https://api.jsonbin.io/v3/b/${EVENT_JSONBIN_ID}`;
const META_BIN_URL   = `https://api.jsonbin.io/v3/b/${EVENT_META_JSONBIN_ID}`;
const CONFIG_BIN_URL = `https://api.jsonbin.io/v3/b/${CONFIG_JSONBIN_ID}`;
const HOLDER_BIN_URL = `https://api.jsonbin.io/v3/b/${HOLDER_JSONBIN_ID}`;
const ATH_BIN_URL    = `https://api.jsonbin.io/v3/b/${ATH_JSONBIN_ID}`;

const ADMIN_USERS = ["unstablecoinx", "unstablecoinx_bot", "pachenko_14"]; // lowercase usernames
const PORT = process.env.PORT || 10000;

// ======================================
// EXPRESS & TELEGRAM SETUP
// ======================================
const app = express();
app.use(cors({ origin: "*" }));
app.use(bodyParser.json({ limit: "15mb" }));
app.use(bodyParser.urlencoded({ extended: true }));

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });

(async () => {
  try {
    const host = RENDER_EXTERNAL_HOSTNAME || `https://unstablecoin-fuddodge-backend.onrender.com`;
    const webhookUrl = `${host.replace(/\/$/, "")}/bot${TELEGRAM_BOT_TOKEN}`;
    await bot.setWebHook(webhookUrl);
    console.log(`✅ Webhook set to: ${webhookUrl}`);
  } catch (err) {
    console.warn("⚠️ setWebHook warning:", err?.message || err);
  }
})();

app.post(`/bot${TELEGRAM_BOT_TOKEN}`, (req, res) => {
  try {
    bot.processUpdate(req.body);
  } catch (err) {
    console.error("❌ processUpdate failed:", err?.message || err);
  }
  res.sendStatus(200);
});

app.get("/", (req, res) => {
  res.send("💛 UnStableCoin Game Bot with events, holders, and A.T.H. ready.");
});

// ======================================
// JSONBin HELPERS (with light retries)
// ======================================
const BIN_HEADERS = { "X-Master-Key": JSONBIN_KEY };
async function withRetries(fn, label, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (err) {
      lastErr = err;
      const status = err?.response?.status;
      console.warn(`⚠️ ${label} failed (try ${i + 1}/${tries})${status ? ` [${status}]` : ""}`);
      if (status !== 429 && status < 500) break;
      await new Promise(r => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr;
}

async function readBin(url) {
  try {
    const resp = await withRetries(() => axios.get(url, { headers: BIN_HEADERS }), "readBin");
    return resp.data.record || resp.data || {};
  } catch (err) {
    console.error("❌ readBin failed:", err?.message || err);
    return null;
  }
}

async function writeBin(url, payload) {
  try {
    const resp = await withRetries(() => axios.put(url, payload, {
      headers: { "Content-Type": "application/json", ...BIN_HEADERS },
    }), "writeBin");
    return resp.data;
  } catch (err) {
    console.error("❌ writeBin failed:", err?.message || err);
    throw err;
  }
}

// ======================================
// CONFIG / HOLDERS
// ======================================
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

async function updateConfig(newPartial) {
  const cur = (await readBin(CONFIG_BIN_URL)) || {};
  const merged = Object.assign({}, cur, newPartial, { lastUpdated: new Date().toISOString() });
  await writeBin(CONFIG_BIN_URL, merged);
  return merged;
}

async function getHoldersArray() {
  const arr = (await readBin(HOLDER_BIN_URL)) || [];
  return Array.isArray(arr) ? arr : [];
}

async function getHoldersMapFromArray() {
  const arr = await getHoldersArray();
  const map = {};
  for (const h of arr) {
    if (!h?.username) continue;
    map[h.username] = h;
  }
  return map;
}

// ======================================
// SOLANA HOLDER CHECK + VALIDATION
// ======================================
function isValidSolanaAddress(addr) {
  try {
    // Throws if invalid
    new PublicKey(addr);
    return true;
  } catch {
    return false;
  }
}

async function checkSolanaHolding(walletAddress, requiredWholeTokens) {
  try {
    const config = await getConfig();
    if (!config.tokenMint) throw new Error("tokenMint not set in config JSONBin.");
    if (!isValidSolanaAddress(walletAddress)) {
      return { ok: false, amount: 0, whole: 0, decimals: 0, error: "invalid wallet address" };
    }

    const network = config.network || "mainnet-beta";
    const rpc = process.env.SOLANA_RPC_URL || clusterApiUrl(network);
    const conn = new Connection(rpc, "confirmed");

    const ownerPub = new PublicKey(walletAddress);
    const mintPub = new PublicKey(config.tokenMint);

    const parsed = await conn.getParsedTokenAccountsByOwner(ownerPub, { mint: mintPub });
    if (!parsed.value || parsed.value.length === 0) return { ok: false, amount: 0, whole: 0, decimals: 0 };

    let total = 0;
    let decimals = 0;
    for (const acc of parsed.value) {
      const info = acc.account?.data?.parsed?.info?.tokenAmount;
      if (!info) continue;
      const amt = parseFloat(info.amount || 0);
      const dec = info.decimals || 0;
      decimals = dec;
      total += amt / Math.pow(10, dec);
    }
    const whole = Math.floor(total);
    const ok = whole >= (requiredWholeTokens || 0);
    return { ok, amount: total, whole, decimals };
  } catch (err) {
    console.error("❌ checkSolanaHolding error:", err?.message || err);
    return { ok: false, amount: 0, whole: 0, decimals: 0, error: err?.message || String(err) };
  }
}

// ======================================
// IMAGE HELPERS
// ======================================
function escapeXml(unsafe) {
  return String(unsafe)
    .replace(/&/g, "&amp;").replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Classic share image used by /share for generic posts
async function composeShareImage(graphBase64, username, score) {
  const W = 1200, H = 628;

  // normalize base64
  let base64 = graphBase64 || "";
  const m = base64.match(/^data:image\/(png|jpeg);base64,(.*)$/);
  if (m) base64 = m[2];

  let graphBuffer = null;
  try {
    if (base64) graphBuffer = Buffer.from(base64, "base64");
  } catch {
    graphBuffer = null;
  }

  const bgSvg = `<svg width="${W}" height="${H}">
    <defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#070707"/><stop offset="100%" stop-color="#0b0b10"/>
    </linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
  </svg>`;

  const title = "UnStableCoin – FUD Dodge";
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

    return await img.png().toBuffer();
  } catch (err) {
    console.error("❌ composeShareImage failed:", err?.message || err);
    throw err;
  }
}

async function composeAthBanner(curveBase64, username, score) {
  const basePath = "./assets/ath_banner_square.png";  // left square image
  const W = 1200, H = 628;

  // Decode chart image if present
  let graphBuf = null;
  try {
    if (curveBase64) {
      const m = curveBase64.match(/^data:image\/(png|jpeg);base64,(.*)$/);
      const base64 = m ? m[2] : curveBase64;
      graphBuf = Buffer.from(base64, "base64");
    }
  } catch (err) {
    console.warn("⚠️ Could not parse curveBase64:", err?.message || err);
  }

  // Layout sizes
  const bannerW = Math.floor(W * 0.55);
  const chartW = W - bannerW;
  const squareSize = Math.min(bannerW, H);

  // Left: rocket/banner
  const bannerImgBuf = await sharp(basePath)
    .resize(squareSize, squareSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 1 } })
    .toBuffer();

  // Right: chart, if provided
  let chartImgBuf = null;
  if (graphBuf) {
    chartImgBuf = await sharp(graphBuf)
      .resize(squareSize, squareSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 1 } })
      .toBuffer();
  }

  // Compose side-by-side on a black canvas
  const composite = [
    { input: bannerImgBuf, top: Math.floor((H - squareSize) / 2), left: Math.floor((bannerW - squareSize) / 2) },
  ];

  if (chartImgBuf) {
    composite.push({
      input: chartImgBuf,
      top: Math.floor((H - squareSize) / 2),
      left: bannerW + Math.floor((chartW - squareSize) / 2)
    });
  }

  return await sharp({
    create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } }
  }).composite(composite).png().toBuffer();
}

// ======================================
// LEADERBOARD & EVENT HELPERS
// ======================================
async function getLeaderboard() {
  try {
    const res = await axios.get(MAIN_BIN_URL, { headers: BIN_HEADERS });
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
    const res = await axios.get(EVENT_BIN_URL, { headers: BIN_HEADERS });
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
    const res = await axios.get(`${META_BIN_URL}/latest`, { headers: BIN_HEADERS });
    const payload = res.data.record || res.data || {};
    return {
      title: payload.title || payload.name || "Current Event",
      info: payload.info || payload.description || "",
      startDate: payload.startDate || null,
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
      startDate: null,
      endDate: null,
      timezone: "Europe/Stockholm",
      updatedAt: new Date().toISOString(),
      raw: {}
    };
  }
}

// ======================================
// TELEGRAM SEND HELPERS
// ======================================
async function sendSafeMessage(chatId, message, opts = {}) {
  try {
    await bot.sendMessage(chatId, message, Object.assign({ parse_mode: "HTML", disable_web_page_preview: true }, opts));
  } catch (err) {
    console.error("❌ Telegram send failed:", err?.message || err);
  }
}

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

// ======================================
// TELEGRAM COMMANDS
// ======================================
bot.onText(/\/help/, async (msg) => {
  try {
    const isAdmin = ADMIN_USERS.includes((msg.from.username || "").toLowerCase());
    const lines = [
      "🎮 <b>FUD Dodge — Bot Commands</b>",
      "🎮 /play — Get link to the game",
      "🏆 /top10 — Top 10 players (global)",
      "📈 /top50 — Top 50 players (global)",
      "⚡ /eventtop10 — Event top 10 (verified holders list)",
      "🥇 /eventtop50 — Event top 50 (verified holders list)",
      "📢 /event — Show current event info",
      ""
    ];

    if (isAdmin) {
      lines.push("🔧 Admin commands:");
      lines.push("/setholdingreq &lt;whole_tokens&gt; — Set required whole tokens");
      lines.push("/winners [n] — Winners who were holders for full event");
      lines.push("/validatewinners — Re-check top event holders now");
      lines.push("/resetevent — Reset event leaderboard");
      lines.push("/setevent Title | Info | start-YYYY-MM-DD | start-HH:mm | end-YYYY-MM-DD | end-HH:mm | [TZ]");
    }

    await sendSafeMessage(msg.chat.id, lines.join("\n"), { parse_mode: "HTML" });
  } catch (err) {
    console.error("❌ /help error:", err?.message || err);
  }
});

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

bot.onText(/\/event$/, async (msg) => {
  try {
    const meta = await getEventMeta();
    let body = `<b>${escapeXml(meta.title)}</b>\n\n${escapeXml(meta.info)}`;
    if (meta.startDate) {
      const start = DateTime.fromISO(meta.startDate).setZone(meta.timezone || "Europe/Stockholm");
      body += `\n🟢 Starts: ${start.toFormat("yyyy-MM-dd HH:mm ZZZZ")}`;
    }
    if (meta.endDate) {
      const end = DateTime.fromISO(meta.endDate).setZone(meta.timezone || "Europe/Stockholm");
      const now = DateTime.now().setZone(meta.timezone || "Europe/Stockholm");
      if (now < end) {
        const diff = end.diff(now, ["days", "hours", "minutes"]).toObject();
        const remain = `${diff.days ? Math.floor(diff.days) + "d " : ""}${diff.hours ? Math.floor(diff.hours) + "h " : ""}${diff.minutes ? Math.floor(diff.minutes) + "m" : ""}`.trim();
        body += `\n⏳ Ends in ${remain}`;
      }
      body += `\n🛑 Ends: ${end.toFormat("yyyy-MM-dd HH:mm ZZZZ")}`;
    }
    await sendSafeMessage(msg.chat.id, body);
  } catch (err) {
    console.error("❌ /event error:", err?.message || err);
    await sendSafeMessage(msg.chat.id, "⚠️ Could not load event info.");
  }
});

// Top lists
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

// Event tops (verified holders only)
bot.onText(/\/eventtop10/, async (msg) => {
  try {
    const arr = await getVerifiedEventTop(10);
    if (!arr.length) return sendSafeMessage(msg.chat.id, "No event scores yet.");
    const lines = arr.map((p, i) => `${i + 1}. <b>${p.username}</b> – ${p.score}`);
    sendChunked(msg.chat.id, "<b>🥇 Event Top 10 (verified holders)</b>\n\n", lines);
  } catch (err) {
    console.error("❌ /eventtop10 error:", err?.message || err);
    sendSafeMessage(msg.chat.id, "⚠️ Failed to load event top10.");
  }
});
bot.onText(/\/eventtop50/, async (msg) => {
  try {
    const arr = await getVerifiedEventTop(50);
    if (!arr.length) return sendSafeMessage(msg.chat.id, "No event scores yet.");
    const lines = arr.map((p, i) => `${i + 1}. <b>${p.username}</b> – ${p.score}`);
    sendChunked(msg.chat.id, "<b>🥇 Event Top 50 (verified holders)</b>\n\n", lines);
  } catch (err) {
    console.error("❌ /eventtop50 error:", err?.message || err);
    sendSafeMessage(msg.chat.id, "⚠️ Failed to load event top50.");
  }
});

async function getVerifiedEventTop(n) {
  const { scores } = await getEventData();
  const holdersMap = await getHoldersMapFromArray();
  return Object.entries(scores)
    .filter(([u]) => !u.startsWith("_") && holdersMap[u] && holdersMap[u].verifiedAt)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([username, score]) => ({ username, score }));
}

// ======================================
// ADMIN COMMANDS
// ======================================
bot.onText(/\/setholdingreq ?(.+)?/, async (msg, match) => {
  try {
    const from = (msg.from.username || "").toLowerCase();
    if (!ADMIN_USERS.includes(from)) return sendSafeMessage(msg.chat.id, "🚫 Not authorized.");

    const param = (match && match[1]) ? match[1].trim() : null;
    if (!param || isNaN(parseInt(param))) {
      return sendSafeMessage(msg.chat.id, `Usage: /setholdingreq <whole_tokens>\nExample: /setholdingreq 500000`);
    }
    const amount = parseInt(param, 10);
    await updateConfig({ minHoldAmount: amount });
    await sendSafeMessage(msg.chat.id, `✅ Holding requirement updated to ${amount} whole tokens.`);
  } catch (err) {
    console.error("❌ /setholdingreq error:", err?.message || err);
    sendSafeMessage(msg.chat.id, "⚠️ Failed to update config.");
  }
});

bot.onText(/\/winners ?(.*)?/, async (msg, match) => {
  try {
    const from = (msg.from.username || "").toLowerCase();
    if (!ADMIN_USERS.includes(from)) return sendSafeMessage(msg.chat.id, "🚫 Not authorized.");

    const nParam = (match && match[1]) ? parseInt(match[1].trim()) : 10;
    const n = isNaN(nParam) ? 10 : nParam;

    const meta = await getEventMeta();
    const { scores } = await getEventData();
    const holders = await getHoldersArray();
    const cfg = await getConfig();

    if (!meta.startDate || !meta.endDate) {
      return sendSafeMessage(msg.chat.id, "⚠️ Event must have start and end dates set.");
    }

    const startUtc = DateTime.fromISO(meta.startDate).toUTC();

    async function isFullPeriodHolder(u) {
      const rec = holders.find(h => h.username === u);
      if (!rec || !rec.verifiedAt || !rec.wallet) return false;
      const verifiedAt = DateTime.fromISO(rec.verifiedAt).toUTC();
      if (!(verifiedAt <= startUtc)) return false;
      const onChain = await checkSolanaHolding(rec.wallet, cfg.minHoldAmount || 0);
      return !!onChain.ok;
    }

    const sorted = Object.entries(scores)
      .filter(([u]) => !u.startsWith("_"))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 200);

    const out = [];
    for (const [u, s] of sorted) {
      if (await isFullPeriodHolder(u)) out.push({ u, s });
      if (out.length >= n) break;
    }

    if (!out.length) return sendSafeMessage(msg.chat.id, "No winners that match full-period holding.");

    const lines = out.map((row, idx) => `${idx + 1}. ${row.u} — ${row.s}`);
    const header = `<b>🏁 Confirmed Winners</b>\nMust be holders from start to end.\nEvent: ${escapeXml(meta.title)}\n`;
    sendChunked(msg.chat.id, header + "\n", lines);
  } catch (err) {
    console.error("❌ /winners error:", err?.message || err);
    sendSafeMessage(msg.chat.id, "⚠️ Failed to compute winners.");
  }
});

bot.onText(/\/validatewinners/, async (msg) => {
  try {
    const from = (msg.from.username || "").toLowerCase();
    if (!ADMIN_USERS.includes(from)) return sendSafeMessage(msg.chat.id, "🚫 Not authorized.");

    const { scores } = await getEventData();
    const holdersMap = await getHoldersMapFromArray();
    const cfg = await getConfig();
    const required = cfg.minHoldAmount || 0;

    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 50);
    const results = [];
    for (const [uname] of sorted) {
      const rec = holdersMap[uname];
      if (!rec || !rec.wallet) {
        results.push({ username: uname, ok: false, reason: "no record" });
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

bot.onText(/\/resetevent/, async (msg) => {
  try {
    const from = (msg.from.username || "").toLowerCase();
    if (!ADMIN_USERS.includes(from)) return sendSafeMessage(msg.chat.id, "🚫 Not authorized.");

    const chatId = msg.chat.id;
    await sendSafeMessage(chatId, "⚠️ Confirm reset of event leaderboard? Reply YES within 30s.");
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

// Set event
bot.onText(/\/setevent(.*)/, async (msg, match) => {
  try {
    const username = msg.from.username?.toLowerCase() || "";
    if (!ADMIN_USERS.includes(username)) return sendSafeMessage(msg.chat.id, "🚫 You are not authorized.");

    const args = match[1]?.trim();
    if (!args) {
      return sendSafeMessage(msg.chat.id,
`🛠 <b>Create or update event</b>

Use:
<code>/setevent &lt;Title&gt; | &lt;Description&gt; | &lt;start-YYYY-MM-DD&gt; | &lt;start-HH:mm&gt; | &lt;end-YYYY-MM-DD&gt; | &lt;end-HH:mm&gt; | [TZ]</code>

Example:
<code>/setevent Meme Rally | Keep MCap above FUD | 2025-11-02 | 18:00 | 2025-11-10 | 21:00 | CET</code>`, { parse_mode: "HTML" });
    }

    const parts = args.split("|").map((s) => s.trim());
    const [title, info, startDateStr, startTimeStr, endDateStr, endTimeStr, tzStrRaw] = parts;

    const tzMap = { CET: "Europe/Stockholm", CEST: "Europe/Stockholm", UTC: "UTC", GMT: "UTC" };
    const zone = tzMap[tzStrRaw?.toUpperCase()] || tzStrRaw || "Europe/Stockholm";

    if (!startDateStr || !startTimeStr || !endDateStr || !endTimeStr) {
      return sendSafeMessage(msg.chat.id, "❌ Missing start or end date/time.\nUse: YYYY-MM-DD | HH:mm | YYYY-MM-DD | HH:mm | [TZ]");
    }

    const startLocal = DateTime.fromFormat(`${startDateStr} ${startTimeStr}`, "yyyy-MM-dd HH:mm", { zone });
    const endLocal   = DateTime.fromFormat(`${endDateStr} ${endTimeStr}`, "yyyy-MM-dd HH:mm", { zone });

    if (!startLocal.isValid || !endLocal.isValid || endLocal <= startLocal) {
      return sendSafeMessage(msg.chat.id, "❌ Invalid dates. End must be after start.");
    }

    const newData = {
      title: title || "⚡️ Unstable Challenge",
      info: info || "Score big. Stay unstable.",
      startDate: startLocal.toUTC().toISO(),
      startLocal: startLocal.toFormat("yyyy-MM-dd HH:mm ZZZZ"),
      endDate: endLocal.toUTC().toISO(),
      endLocal: endLocal.toFormat("yyyy-MM-dd HH:mm ZZZZ"),
      timezone: zone,
      updatedAt: new Date().toISOString(),
    };

    await writeBin(META_BIN_URL, newData);
    await sendSafeMessage(msg.chat.id, `✅ <b>Event updated</b>
<b>${newData.title}</b>
${newData.info}
🟢 Starts: ${newData.startLocal}
🛑 Ends: ${newData.endLocal}`);
  } catch (err) {
    console.error("❌ /setevent error:", err?.message || err);
    sendSafeMessage(msg.chat.id, "⚠️ Failed to update event.");
  }
});

// List holders
bot.onText(/\/holders/, async (msg) => {
  try {
    const from = (msg.from.username || "").toLowerCase();
    if (!ADMIN_USERS.includes(from))
      return sendSafeMessage(msg.chat.id, "🚫 Not authorized.");

    const holders = await getHoldersArray();
    if (!holders.length) return sendSafeMessage(msg.chat.id, "📋 No holder records.");

    holders.sort((a, b) => new Date(b.verifiedAt || 0) - new Date(a.verifiedAt || 0));
    const lines = holders.map((h) => `<b>${h.username || "n/a"}</b> — ${h.wallet || "n/a"} — ${h.verifiedAt || "n/a"}${h.pending ? " — pending change" : ""}`);
    sendChunked(msg.chat.id, "<b>📋 Stored Holder Records</b>\n", lines);
  } catch (err) {
    console.error("❌ /holders error:", err?.message || err);
    sendSafeMessage(msg.chat.id, "⚠️ Failed to load holders.");
  }
});

// ======================================
// PUBLIC FRONTEND ENDPOINTS
// ======================================
app.get("/event", async (req, res) => {
  try {
    const meta = await getEventMeta();
    res.json({
      title: meta.title,
      info: meta.info,
      startDate: meta.startDate,
      endDate: meta.endDate,
      timezone: meta.timezone
    });
  } catch (err) {
    res.status(500).json({ ok: false, message: "Failed to load event" });
  }
});

app.get("/eventtop10", async (req, res) => {
  try {
    const arr = await getVerifiedEventTop(10);
    res.json(arr);
  } catch (err) {
    res.status(500).json({ ok: false, message: "Failed to load event top10" });
  }
});

app.get("/eventtop50", async (req, res) => {
  try {
    const arr = await getVerifiedEventTop(50);
    res.json(arr);
  } catch (err) {
    res.status(500).json({ ok: false, message: "Failed to load event top50" });
  }
});

// ======================================
// SCORE SUBMIT (main + event)
// ======================================
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
      const resp = await axios.get(`${META_BIN_URL}/latest`, { headers: BIN_HEADERS });
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
        message: "⚠️ Event has ended. Stay tuned for the next UnStable Challenge.",
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

    res.json({ success: true, message: "✅ Score submitted.", eventActive, endDate: eventMeta.endDate || null });
  } catch (err) {
    console.error("❌ Submit failed:", err.message || err);
    res.status(500).json({ error: "Failed to submit score" });
  }
});

// ======================================
// HOLDER VERIFY (initial)
// ======================================
async function verifySolanaBalance(wallet) {
  try {
    const config = await getConfig();
    if (!isValidSolanaAddress(wallet)) return false;

    const connection = new Connection(clusterApiUrl(config.network || CONFIG_DEFAULTS.network), "confirmed");
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(new PublicKey(wallet), {
      mint: new PublicKey(config.tokenMint || CONFIG_DEFAULTS.tokenMint)
    });

    let totalBalance = 0;
    tokenAccounts.value.forEach(acc => {
      const amount = acc.account.data.parsed.info.tokenAmount.uiAmount;
      totalBalance += amount;
    });

    return totalBalance >= (config.minHoldAmount || CONFIG_DEFAULTS.minHoldAmount);
  } catch (err) {
    console.error("❌ verifySolanaBalance error:", err?.message || err);
    return false;
  }
}

app.post("/verifyHolder", async (req, res) => {
  try {
    let { username, wallet } = req.body;
    if (!username || !wallet) return res.status(400).json({ ok: false, message: "Missing username or wallet." });

    username = username.trim();
    if (!username.startsWith("@")) username = "@" + username.replace(/^@+/, "");
    wallet = String(wallet).trim();

    if (!isValidSolanaAddress(wallet)) {
      return res.json({ ok: false, message: "Invalid Solana wallet address." });
    }

    const isOk = await verifySolanaBalance(wallet);
    if (!isOk) return res.json({ ok: false, message: "Wallet balance below minimum requirement." });

    // persist
    const holders = await getHoldersArray();
    const idx = holders.findIndex(h => h.username.toLowerCase() === username.toLowerCase());
    const record = { username, wallet, verifiedAt: new Date().toISOString() };
    if (idx >= 0) holders[idx] = Object.assign({}, holders[idx], record, { pending: undefined });
    else holders.push(record);

    await writeBin(HOLDER_BIN_URL, holders);
    return res.json({ ok: true, message: "✅ Holder verified successfully!", username });
  } catch (err) {
    console.error("❌ verifyHolder error:", err?.message || err);
    res.status(500).json({ ok: false, message: "Server error verifying holder." });
  }
});

app.get("/holderStatus", async (req, res) => {
  try {
    let username = req.query.username;
    if (!username) return res.status(400).json({ verified: false, message: "Missing username" });
    username = username.trim();
    if (!username.startsWith("@")) username = "@" + username.replace(/^@+/, "");

    const holders = await getHoldersArray();
    const match = holders.find(h => h.username?.toLowerCase() === username.toLowerCase());

    if (match && match.wallet) return res.json({ verified: true, username: match.username, wallet: match.wallet });
    else return res.json({ verified: false });
  } catch (err) {
    console.error("❌ holderStatus error:", err?.message || err);
    res.status(500).json({ verified: false, message: "Server error checking holder status" });
  }
});

// ======================================
// SECURE WALLET CHANGE/REMOVE (2-step)
// ======================================
function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit
}

/*
Flow summary:
1) POST /requestHolderChange { username, action: "change"|"remove", newWallet? }
   - Generates code, stores in holder.pending { code, action, newWallet, expiresAt }
   - Validates newWallet format if action=change (but does NOT verify balance yet)
2) POST /confirmHolderChange { username, code }
   - If action=change: verify on-chain balance of pending.newWallet, then commit
   - If action=remove: clear wallet + verifiedAt
*/

app.post("/requestHolderChange", async (req, res) => {
  try {
    let { username, action, newWallet } = req.body;
    if (!username || !action) return res.status(400).json({ ok: false, message: "Missing username or action." });

    username = username.trim();
    if (!username.startsWith("@")) username = "@" + username.replace(/^@+/, "");
    action = String(action).toLowerCase();

    if (!["change", "remove"].includes(action)) {
      return res.status(400).json({ ok: false, message: "action must be 'change' or 'remove'." });
    }

    const holders = await getHoldersArray();
    const idx = holders.findIndex(h => h.username.toLowerCase() === username.toLowerCase());
    if (idx < 0) return res.json({ ok: false, message: "No existing holder record." });

    if (action === "change") {
      if (!newWallet || !isValidSolanaAddress(newWallet)) {
        return res.json({ ok: false, message: "Provide a valid Solana wallet address." });
      }
    }

    const code = generateCode();
    const expiresAt = DateTime.utc().plus({ minutes: 15 }).toISO();

    holders[idx].pending = {
      code,
      action,
      newWallet: action === "change" ? String(newWallet).trim() : null,
      requestedAt: new Date().toISOString(),
      expiresAt
    };

    await writeBin(HOLDER_BIN_URL, holders);

    // Normally you'd send code via a secure channel. Here we return it (frontend may show it or DM it).
    return res.json({ ok: true, message: "Change request created. Confirm with the code.", code, expiresAt });
  } catch (err) {
    console.error("❌ requestHolderChange error:", err?.message || err);
    res.status(500).json({ ok: false, message: "Server error creating request." });
  }
});

app.post("/confirmHolderChange", async (req, res) => {
  try {
    let { username, code } = req.body;
    if (!username || !code) return res.status(400).json({ ok: false, message: "Missing username or code." });
    username = username.trim();
    if (!username.startsWith("@")) username = "@" + username.replace(/^@+/, "");

    const holders = await getHoldersArray();
    const idx = holders.findIndex(h => h.username.toLowerCase() === username.toLowerCase());
    if (idx < 0) return res.json({ ok: false, message: "No existing holder record." });

    const rec = holders[idx];
    const p = rec.pending;
    if (!p) return res.json({ ok: false, message: "No pending change found." });

    const now = DateTime.utc();
    if (now > DateTime.fromISO(p.expiresAt)) {
      holders[idx].pending = undefined;
      await writeBin(HOLDER_BIN_URL, holders);
      return res.json({ ok: false, message: "Code expired. Please start again." });
    }

    if (String(p.code) !== String(code)) {
      return res.json({ ok: false, message: "Invalid code." });
    }

    if (p.action === "remove") {
      holders[idx] = Object.assign({}, rec, {
        wallet: null,
        verifiedAt: null,
        pending: undefined,
        removedAt: new Date().toISOString()
      });
      await writeBin(HOLDER_BIN_URL, holders);
      return res.json({ ok: true, message: "✅ Wallet removed. Holder connection cleared." });
    }

    if (p.action === "change") {
      const cfg = await getConfig();
      const check = await checkSolanaHolding(p.newWallet, cfg.minHoldAmount || 0);
      if (!check.ok) {
        return res.json({ ok: false, message: "New wallet does not meet holding requirement." });
      }

      holders[idx] = Object.assign({}, rec, {
        wallet: p.newWallet,
        verifiedAt: new Date().toISOString(),
        pending: undefined
      });
      await writeBin(HOLDER_BIN_URL, holders);
      return res.json({ ok: true, message: "✅ Wallet updated and verified." });
    }

    return res.json({ ok: false, message: "Unknown action." });
  } catch (err) {
    console.error("❌ confirmHolderChange error:", err?.message || err);
    res.status(500).json({ ok: false, message: "Server error confirming change." });
  }
});

// ======================================
// A.T.H. STORAGE & SHARE
// ======================================
async function getAthMap() {
  const raw = (await readBin(ATH_BIN_URL)) || {};
  return typeof raw === "object" && raw ? raw : {};
}
async function saveAthMap(map) {
  await writeBin(ATH_BIN_URL, map);
  return true;
}

// /share — includes ATH mode (caption style without '#')
app.post("/share", async (req, res) => {
  try {
    const { username, score, chatId, imageBase64, mode, curveImage } = req.body;
    if (!username || typeof score === "undefined") {
      return res.status(400).json({ ok: false, message: "Missing username or score" });
    }

    // Holder-gated posting config
    const cfg = await getConfig();
    const holders = await getHoldersMapFromArray();

    if (!cfg.allowPostingWithoutHold) {
      const rec = holders[username];
      if (!rec || !rec.wallet) {
        return res.status(403).json({ ok: false, message: "User not a verified holder. Posting blocked." });
      }
    }

    // A.T.H. MODE
    if (String(mode).toLowerCase() === "ath") {
      const athMap = await getAthMap();
      const rec = athMap[username] || { ath: 0, lastSentScore: null, milestones: [] };
      const oldAth = +rec.ath || 0;

      if (!ATH_TEST_MODE) {
        if (!(score > oldAth)) {
          return res.status(400).json({ ok: false, message: `Score must beat your A.T.H. of ${oldAth}` });
        }
      } else {
        console.log(`🧪 ATH_TEST_MODE active: allowing repeat sends for ${username}`);
      }

      const isNewAth = score > oldAth;
      if (isNewAth) rec.ath = score;

      // Compose banner
      const banner = await composeAthBanner(curveImage || imageBase64 || null, username, score);

      // Target chat
      const targetChatId = String(chatId || TEST_ATH_CHAT_ID);

      // Format MCap
      function formatMCap(v) {
        if (!v || isNaN(v)) return "0k";
        if (v >= 1_000_000) return (v / 1_000_000).toFixed(3).replace(/\.?0+$/, "") + "M";
        if (v >= 1000) return (v / 1000).toFixed(3).replace(/\.?0+$/, "") + "k";
        return Number(v).toFixed(3).replace(/\.?0+$/, "");
      }

      // Current leaderboard position (no '#')
      let positionText = "unranked";
      try {
        const mainData = await getLeaderboard();
        const sorted = Object.entries(mainData).sort((a, b) => b[1] - a[1]);
        const index = sorted.findIndex(([u]) => u === username);
        if (index >= 0) positionText = `${index + 1}`;
      } catch (err) {
        console.warn("⚠️ Failed to compute leaderboard position:", err?.message);
      }

      const formattedScore = formatMCap(score);
      const caption =
        `${escapeXml(username)} sent a strong signal. ⚡\n` +
        `New A.T.H. logged at ${formattedScore}.\n` +
        `Rank: ${positionText}.\n` +
        `We aim for Win-Win`;

      await bot.sendPhoto(targetChatId, banner, { caption, parse_mode: "HTML" });

      const nowIso = new Date().toISOString();
      rec.lastSentScore = score;
      rec.lastSentAt = nowIso;
      rec.milestones = Array.isArray(rec.milestones) ? rec.milestones : [];
      rec.milestones.push({ score, date: nowIso, sent: true });
      athMap[username] = rec;
      await saveAthMap(athMap);

      return res.json({ ok: true, message: "Posted A.T.H. banner" });
    }

    // Default (non-ATH) share
    const imgBuf = await composeShareImage(imageBase64, username, score);
    const targetChatId = String(chatId || TEST_ATH_CHAT_ID);
    const caption = `<b>${escapeXml(String(username))}</b>\nMCap: ${escapeXml(String(score))}\nShared from UnStableCoin FUD Dodge`;
    await bot.sendPhoto(targetChatId, imgBuf, { caption, parse_mode: "HTML" });

    res.json({ ok: true, message: "Posted to Telegram" });
  } catch (err) {
    console.error("❌ /share error:", err?.message || err);
    res.status(500).json({ ok: false, message: err?.message || "Share failed" });
  }
});

// Preview endpoint for A.T.H. banner
app.post("/athbannerpreview", async (req, res) => {
  try {
    const { username, score, curveImage } = req.body;
    if (!username || typeof score === "undefined") {
      return res.status(400).json({ ok: false, message: "Missing username or score" });
    }
    const banner = await composeAthBanner(curveImage || null, username, score);
    res.setHeader("Content-Type", "image/png");
    res.send(banner);
  } catch (err) {
    console.error("❌ /athbannerpreview error:", err?.message || err);
    res.status(500).json({ ok: false, message: "Failed to compose preview" });
  }
});

// A.T.H. leaders and records
app.get("/athleaders", async (req, res) => {
  try {
    const map = await getAthMap();
    const rows = Object.keys(map).map(u => ({
      username: u,
      ath: map[u]?.ath || 0,
      milestones: Array.isArray(map[u]?.milestones) ? map[u].milestones.length : 0,
      lastSentAt: map[u]?.lastSentAt || null
    }));
    rows.sort((a, b) => b.milestones - a.milestones || b.ath - a.ath);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ ok: false, message: "Failed to load A.T.H. leaders" });
  }
});

app.get("/athrecords", async (req, res) => {
  try {
    const map = await getAthMap();
    res.json(map);
  } catch (err) {
    res.status(500).json({ ok: false, message: "Failed to load A.T.H. records" });
  }
});

// ======================================
/* START SERVER */
// ======================================
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
