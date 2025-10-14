// === UnStableCoin Game Bot ===
// ⚡ Version: EventTimeStrict + EventCloseOnEnd + Protected Submits + Admin Tools + Holder Verification + Share Image
// Author: UnStableCoin Community
// ------------------------------------

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

// === ENVIRONMENT VARIABLES ===
const token = process.env.TELEGRAM_BOT_TOKEN;
const JSONBIN_ID = process.env.JSONBIN_ID;
const EVENT_JSONBIN_ID = process.env.EVENT_JSONBIN_ID;
const JSONBIN_KEY = process.env.JSONBIN_KEY;
const EVENT_META_JSONBIN_ID = process.env.EVENT_META_JSONBIN_ID;
const RESET_KEY = process.env.RESET_KEY;
const CONFIG_JSONBIN_ID = process.env.CONFIG_JSONBIN_ID;
const HOLDER_JSONBIN_ID = process.env.HOLDER_JSONBIN_ID;
const RENDER_EXTERNAL_HOSTNAME = process.env.RENDER_EXTERNAL_HOSTNAME || null;

if (
  !token ||
  !JSONBIN_ID ||
  !EVENT_JSONBIN_ID ||
  !JSONBIN_KEY ||
  !EVENT_META_JSONBIN_ID ||
  !RESET_KEY ||
  !CONFIG_JSONBIN_ID ||
  !HOLDER_JSONBIN_ID
) {
  console.error("❌ Missing required environment variables. Please set TELEGRAM_BOT_TOKEN, JSONBIN_ID, EVENT_JSONBIN_ID, JSONBIN_KEY, EVENT_META_JSONBIN_ID, RESET_KEY, CONFIG_JSONBIN_ID, HOLDER_JSONBIN_ID");
  process.exit(1);
}

// === SETTINGS / BIN URLs ===
const ADMIN_USERS = ["unstablecoinx", "unstablecoinx_bot", "pachenko_14"];
const app = express();
app.use(cors({ origin: "https://theunstable.io" }));
app.use(bodyParser.json({ limit: "8mb" })); // allow images as base64 payloads

const MAIN_BIN_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_ID}`;
const EVENT_BIN_URL = `https://api.jsonbin.io/v3/b/${EVENT_JSONBIN_ID}`;
const META_BIN_URL = `https://api.jsonbin.io/v3/b/${EVENT_META_JSONBIN_ID}`;
const CONFIG_BIN_URL = `https://api.jsonbin.io/v3/b/${CONFIG_JSONBIN_ID}`;
const HOLDER_BIN_URL = `https://api.jsonbin.io/v3/b/${HOLDER_JSONBIN_ID}`;

// === TELEGRAM BOT & WEBHOOK SETUP ===
const bot = new TelegramBot(token, { polling: false });

(async () => {
  try {
    const host = RENDER_EXTERNAL_HOSTNAME || `https://unstablecoin-fuddodge-backend.onrender.com`;
    const webhookUrl = `${host.replace(/\/$/, "")}/bot${token}`;
    await bot.setWebHook(webhookUrl);
    console.log(`✅ Webhook set to: ${webhookUrl}`);
  } catch (err) {
    console.warn("⚠️ Failed to set webhook (maybe already set). Continuing with bot object. Error:", err?.message || err);
  }
})();

// Express endpoint for Telegram webhook
app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
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
  // Provide defaults to avoid crashes
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
  // Expected shape: { "<username>": { wallet, verifiedAt, note } }
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

    // get parsed token accounts for owner filtered by mint
    const parsed = await conn.getParsedTokenAccountsByOwner(ownerPub, { mint: mintPub });

    if (!parsed.value || parsed.value.length === 0) return { ok: false, amount: 0, decimals: 0 };

    // sum all token accounts for that mint
    let total = 0;
    let decimals = null;
    for (const acc of parsed.value) {
      const parsedInfo = acc.account?.data?.parsed?.info;
      if (parsedInfo && parsedInfo.tokenAmount) {
        const amt = parseFloat(parsedInfo.tokenAmount.amount || 0);
        const dec = parsedInfo.tokenAmount.decimals || 0;
        decimals = dec;
        // amount is raw integer, so convert to ui amount
        const ui = amt / Math.pow(10, dec);
        total += ui;
      }
    }

    // Compare only whole tokens (floor)
    const whole = Math.floor(total);
    const ok = whole >= requiredWholeTokens;
    return { ok, amount: total, whole, decimals };
  } catch (err) {
    console.error("❌ checkSolanaHolding error:", err?.message || err);
    return { ok: false, amount: 0, whole: 0, decimals: 0, error: err?.message || String(err) };
  }
}

/* ============================
   Helper: Compose share image with sharp
   - Input: base64 PNG graph (data URL or raw base64), username, score
   - Output: Buffer PNG
   ============================ */
async function composeShareImage(graphBase64, username, score) {
  // Standard banner size for Telegram (approx landscape)
  const W = 1200, H = 628;

  // Normalize base64 input (allow data URL)
  let base64 = graphBase64 || "";
  const m = base64.match(/^data:image\/png;base64,(.*)$/);
  if (m) base64 = m[1];

  let graphBuffer = null;
  try {
    graphBuffer = Buffer.from(base64, "base64");
  } catch (_err) {
    graphBuffer = null;
  }

  // Create a background layer (dark gradient) using SVG
  const bgSvg = `<svg width="${W}" height="${H}">
    <defs>
      <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0%" stop-color="#070707"/>
        <stop offset="100%" stop-color="#0b0b10"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
  </svg>`;

  // Compose title / texts as SVG
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

  // Compose final via sharp: background -> graph (center) -> text overlay
  try {
    // Start with background
    let img = sharp(Buffer.from(bgSvg)).resize(W, H);

    // If we have a graph buffer, scale and place it
    if (graphBuffer) {
      // create resized graph preserving aspect inside card area
      const graphW = Math.floor(W * 0.86);
      const graphH = Math.floor(H * 0.62);
      const graphImg = await sharp(graphBuffer).resize(graphW, graphH, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();

      // Compose
      img = img.composite([
        // graph centered lower
        { input: graphImg, left: Math.floor((W - graphW) / 2), top: Math.floor(H * 0.18) },
        // text overlay
        { input: Buffer.from(textSvg), left: 0, top: 0 }
      ]);
    } else {
      // no graph — just add text
      img = img.composite([{ input: Buffer.from(textSvg), left: 0, top: 0 }]);
    }

    // Output PNG buffer
    const out = await img.png().toBuffer();
    return out;
  } catch (err) {
    console.error("❌ composeShareImage failed:", err?.message || err);
    throw err;
  }
}

function escapeXml(unsafe) {
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/* ============================
   Telegram posting endpoint (called from frontend)
   Endpoint: POST /share
   body: { username, score, chatId, imageBase64 }
   - imageBase64: "data:image/png;base64,..." or plain base64
   ============================ */
app.post("/share", async (req, res) => {
  try {
    const { username, score, chatId, imageBase64 } = req.body;
    if (!username || typeof score === "undefined" || !chatId) {
      return res.status(400).json({ error: "Missing username, score or chatId" });
    }

    // Load config and holders
    const cfg = await getConfig();
    const holders = await getHoldersMap();

    // If posting is restricted and user not verified, block
    if (!cfg.allowPostingWithoutHold) {
      const rec = holders[username];
      if (!rec) {
        return res.status(403).json({ ok: false, message: "User not a verified holder. Posting blocked." });
      }
    }

    // Compose image
    const imgBuf = await composeShareImage(imageBase64, username, score);

    // Compose caption
    const caption = `<b>${escapeXml(String(username))}</b>\nMCap: ${escapeXml(String(score))}\nShared from UnStableCoin FUD Dodge`;

    // Send as photo
    await bot.sendPhoto(chatId.toString(), imgBuf, { caption, parse_mode: "HTML" });

    res.json({ ok: true, message: "Posted to Telegram" });
  } catch (err) {
    console.error("❌ /share error:", err?.message || err);
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

/* ============================
   Holder verification endpoint (frontend calls to check and register)
   POST /verifyHolder
   body: { username, wallet }
   Returns quick result { ok, amount, whole, decimals }
   - If success and configured, also stores holder record in HOLDER_BIN
   ============================ */
app.post("/verifyHolder", async (req, res) => {
  try {
    const { username, wallet } = req.body;
    if (!username || !wallet) return res.status(400).json({ error: "Missing username or wallet" });

    const cfg = await getConfig();
    if (!cfg.holderVerificationEnabled) {
      return res.status(403).json({ ok: false, message: "Holder verification is disabled." });
    }

    const required = cfg.minHoldAmount || 0;
    const check = await checkSolanaHolding(wallet, required);

    // Save quick verification record on success
    if (check.ok) {
      const rec = {
        wallet: wallet,
        verifiedAt: new Date().toISOString(),
        amount: check.amount,
        whole: check.whole,
        decimals: check.decimals,
      };
      await saveHolder(username, rec);
      return res.json({ ok: true, message: "Verified and saved", record: rec });
    }

    return res.json({ ok: false, message: "Not holding required amount", info: check });
  } catch (err) {
    console.error("❌ /verifyHolder failed:", err?.message || err);
    res.status(500).json({ error: err?.message || String(err) });
  }
});

/* ============================
   Extended leaderboard/event endpoints:
   - event list endpoints now return only verified holders (eventtop10/eventtop50)
   - keep /leaderboard as global
   ============================ */
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
   Admin commands: /setholdingreq, /winners, /validatewinners
   - setholdingreq <amount> updates CONFIG_JSONBIN_ID
   - winners returns confirmed winners (verifiedAt <= eventEnd)
   - validatewinners re-checks each top holder on-chain (admin-only)
   ============================ */

bot.onText(/\/setholdingreq ?(.+)?/, async (msg, match) => {
  try {
    const username = (msg.from.username || "").toLowerCase();
    if (!ADMIN_USERS.includes(username)) return sendSafeMessage(msg.chat.id, "🚫 Not authorized.");

    const param = (match && match[1]) ? match[1].trim() : null;
    if (!param || isNaN(parseInt(param))) {
      return sendSafeMessage(msg.chat.id, `Usage: /setholdingreq <whole_tokens>\nExample: /setholdingreq 500000`);
    }
    const amount = parseInt(param);
    const updated = await updateConfig({ minHoldAmount: amount });
    await sendSafeMessage(msg.chat.id, `✅ Holding requirement updated to ${amount} whole tokens.\nConfig saved.`);
  } catch (err) {
    console.error("❌ /setholdingreq error:", err?.message || err);
    sendSafeMessage(msg.chat.id, "⚠️ Failed to update config.");
  }
});

bot.onText(/\/winners ?(.*)?/, async (msg, match) => {
  try {
    const username = (msg.from.username || "").toLowerCase();
    if (!ADMIN_USERS.includes(username)) return sendSafeMessage(msg.chat.id, "🚫 Not authorized.");

    // optional param: 'n' number of winners
    const nParam = (match && match[1]) ? parseInt(match[1].trim()) : 10;
    const n = isNaN(nParam) ? 10 : nParam;

    // Load event meta and event data
    const meta = await getEventMeta();
    const { scores } = await getEventData();
    const holders = await getHoldersMap();

    // If no event endDate, block
    if (!meta.endDate) return sendSafeMessage(msg.chat.id, "⚠️ Event has no endDate set in meta.");

    const end = DateTime.fromISO(meta.endDate, { zone: "utc" });
    // Filter scores to only those with verified holder records where verifiedAt <= end
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

// re-check on-chain for each top event holder (admin)
bot.onText(/\/validatewinners ?(.*)?/, async (msg, match) => {
  try {
    const username = (msg.from.username || "").toLowerCase();
    if (!ADMIN_USERS.includes(username)) return sendSafeMessage(msg.chat.id, "🚫 Not authorized.");

    const recheckNow = (match && match[1] && match[1].trim().toLowerCase() === "now");
    const meta = await getEventMeta();
    if (!meta.endDate) return sendSafeMessage(msg.chat.id, "⚠️ Event has no endDate set in meta.");

    const { scores } = await getEventData();
    const holders = await getHoldersMap();
    const cfg = await getConfig();
    const required = cfg.minHoldAmount || 0;

    // iterate top 50 event scores, validating on-chain
    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 50);
    const results = [];
    for (const [uname, sc] of sorted) {
      const rec = holders[uname];
      if (!rec || !rec.wallet) {
        results.push({ username: uname, ok: false, reason: "no holder record" });
        continue;
      }

      // Re-check on-chain now
      const check = await checkSolanaHolding(rec.wallet, required);
      results.push({ username: uname, ok: check.ok, amount: check.amount, reason: check.ok ? "ok" : "insufficient" });
    }

    // Format results in message chunks
    const lines = results.map((r, i) => `${i + 1}. ${r.username} — ${r.ok ? "✅" : "❌"} ${r.amount ? "(" + r.amount + ")" : ""} ${r.reason || ""}`);
    sendChunked(msg.chat.id, `<b>🔎 Revalidation results (top 50)</b>\n`, lines);
  } catch (err) {
    console.error("❌ /validatewinners error:", err?.message || err);
    sendSafeMessage(msg.chat.id, "⚠️ Validation failed.");
  }
});

/* ============================
   Utilities (existing commands kept) - trimmed to keep core functionality
   ============================ */

async function sendSafeMessage(chatId, message, opts = {}) {
  try {
    await bot.sendMessage(chatId, message, Object.assign({ parse_mode: "HTML", disable_web_page_preview: true }, opts));
  } catch (err) {
    console.error("❌ Telegram send failed:", err?.message || err);
  }
}

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

/* Keep other /top10 /top50 /eventtop10 /eventtop50 endpoints already implemented above in your app.
   For brevity we reuse the earlier handlers: */
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
  // If config says only verified holders, we redirect to eventverifiedtop10 endpoint
  const cfg = await getConfig();
  if (cfg.holderVerificationEnabled) {
    const arr = await axios.get(`${RENDER_EXTERNAL_HOSTNAME || ""}/eventverifiedtop10`).then(r => r.data).catch(()=>null);
    if (Array.isArray(arr) && arr.length) {
      const lines = arr.map((p, i) => `${i + 1}. <b>${p.username}</b> – ${p.score}`);
      return sendChunked(msg.chat.id, "<b>🥇 Event Top 10 (Verified holders)</b>\n\n", lines);
    }
  }
  // fallback to raw event top10
  const { scores } = await getEventData();
  const sorted = Object.entries(scores).filter(([u]) => !u.startsWith("_")).sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return sendSafeMessage(msg.chat.id, "No event scores yet.");
  const lines = sorted.slice(0, 10).map(([u, s], i) => `${i + 1}. <b>${u}</b> – ${s} pts`);
  sendChunked(msg.chat.id, "<b>🥇 Event Top 10</b>\n\n", lines);
});

bot.onText(/\/eventtop50/, async (msg) => {
  const cfg = await getConfig();
  if (cfg.holderVerificationEnabled) {
    const arr = await axios.get(`${RENDER_EXTERNAL_HOSTNAME || ""}/eventverifiedtop50`).then(r => r.data).catch(()=>null);
    if (Array.isArray(arr) && arr.length) {
      const lines = arr.map((p, i) => `${i + 1}. <b>${p.username}</b> – ${p.score}`);
      return sendChunked(msg.chat.id, "<b>🥇 Event Top 50 (Verified holders)</b>\n\n", lines);
    }
  }
  const { scores } = await getEventData();
  const sorted = Object.entries(scores).filter(([u]) => !u.startsWith("_")).sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return sendSafeMessage(msg.chat.id, "No event scores yet.");
  const lines = sorted.slice(0, 50).map(([u, s], i) => `${i + 1}. <b>${u}</b> – ${s} pts`);
  sendChunked(msg.chat.id, "<b>🥇 Event Top 50</b>\n\n", lines);
});

/* ============================
   Helper: sendChunked for long messages
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
   SUBMIT endpoint as before (keeps same logic)
   ============================ */
app.post("/submit", async (req, res) => {
  try {
    const { username, score, target } = req.body;
    const adminKey = req.headers["x-admin-key"];
    const isAdmin = adminKey && adminKey === RESET_KEY;

    if (!username || typeof score !== "number") {
      return res.status(400).json({ error: "Invalid data" });
    }

    console.log(`📥 Submit received → ${username}: ${score} (${target || "both"})`);

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

    // block event writes when closed (unless admin or target=main)
    if (!eventActive && !isAdmin && target !== "main") {
      console.log(`⏳ Event closed — ${username}'s event score ignored.`);
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
        console.log(`🔥 Main updated for ${username}: ${score}`);
      }
    }

    // EVENT
    if (target !== "main") {
      const { scores } = await getEventData();
      const prev = scores[username] || 0;
      if (score > prev || isAdmin) {
        scores[username] = score;
        await writeBin(EVENT_BIN_URL, { scores });
        console.log(`⚡️ Event updated for ${username}: ${score}`);
      }
    }

    res.json({ success: true, message: "✅ Score submitted successfully.", eventActive, endDate: eventMeta.endDate || null });
  } catch (err) {
    console.error("❌ Submit failed:", err.message || err);
    res.status(500).json({ error: "Failed to submit score" });
  }
});

/* ============================
   START SERVER
   ============================ */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 UnStableCoinBot running on port ${PORT}`));
