'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const PORT = 3000;
const DATA_DIR = process.env.TRANTHAG_DATA_DIR || __dirname;
const CONFIG_FILE = path.join(DATA_DIR, 'auto-auction-config.json');
const AWARDS_FILE = path.join(DATA_DIR, 'delivered-awards.json');

const DEFAULTS = {
  streamerUsername: '',
  mainSeconds: 50,
  finalSeconds: 25,
  highGiftThreshold: 100,
  overtimeSeconds: 30,
  nextRoundDelay: 6,
  autoStartNextRound: true,
  itemId: 'AETHERON',
  itemName: 'Aetheron Pet',
  coinReward: 100,
  awardApiUrl: 'https://tranthag-auto-auction-test.floot.app/_api/roblox-award',
  autoDelivery: true,
  autoStatusComment: true,
  deliveryMessage: '@{winner} prize delivered: {item}, tysm',
  winnerMappings: []
};

function ensureDir() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}
}
function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}
function saveJson(file, value) {
  ensureDir();
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}
function cleanId(v) { return String(v || '').trim().replace(/^@/, '').toLowerCase(); }
function clampInt(v, min, max, fallback) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
function sanitizeConfig(input) {
  const x = { ...DEFAULTS, ...(input || {}) };
  x.streamerUsername = String(x.streamerUsername || '').trim().replace(/^@/, '');
  x.mainSeconds = clampInt(x.mainSeconds, 5, 3600, 50);
  x.finalSeconds = clampInt(x.finalSeconds, 0, 600, 25);
  x.highGiftThreshold = clampInt(x.highGiftThreshold, 1, 100000000, 100);
  x.overtimeSeconds = clampInt(x.overtimeSeconds, 5, 600, 30);
  x.nextRoundDelay = clampInt(x.nextRoundDelay, 1, 300, 6);
  x.coinReward = clampInt(x.coinReward, 0, 1000000000, 100);
  x.itemId = String(x.itemId || '').trim().slice(0, 120);
  x.itemName = String(x.itemName || '').trim().slice(0, 160);
  x.awardApiUrl = String(x.awardApiUrl || '').trim().slice(0, 1000);
  x.deliveryMessage = String(x.deliveryMessage || '').slice(0, 280);
  x.autoStartNextRound = !!x.autoStartNextRound;
  x.autoDelivery = !!x.autoDelivery;
  x.autoStatusComment = !!x.autoStatusComment;
  x.winnerMappings = Array.isArray(x.winnerMappings) ? x.winnerMappings.slice(0, 50).map(m => ({
    tiktok: cleanId(m && m.tiktok),
    roblox: String(m && m.roblox || '').trim().slice(0, 32),
    message: String(m && m.message || '').slice(0, 280)
  })).filter(m => m.tiktok && m.roblox) : [];
  return x;
}

ensureDir();
let config = sanitizeConfig(loadJson(CONFIG_FILE, DEFAULTS));
let deliveredAwardIds = new Set(loadJson(AWARDS_FILE, []));
let io = null;
let timer = null;
let nextRoundTimer = null;
let tiktokConnection = null;
let tiktokGeneration = 0;
let giftCatalog = new Map();

const state = {
  roundId: 0,
  phase: 'idle',
  timeRemaining: config.mainSeconds,
  bidders: {},
  winner: null,
  recentGifts: [],
  connection: { status: 'disconnected', username: '', roomId: '' },
  delivery: { status: 'idle', message: '' },
  lastEvent: 'Ready'
};

function snapshot() {
  const biddersList = Object.values(state.bidders)
    .sort((a,b) => (b.coins-a.coins) || (a.firstBidAt-b.firstBidAt))
    .slice(0, 100);
  return { ...state, biddersList, config };
}
function broadcast() {
  if (io) io.emit('state', snapshot());
}
function event(text) {
  state.lastEvent = text;
  if (io) io.emit('log', { at: Date.now(), text });
  broadcast();
}
function clearTimers() {
  if (timer) clearInterval(timer);
  timer = null;
  if (nextRoundTimer) clearTimeout(nextRoundTimer);
  nextRoundTimer = null;
}
function startTicker() {
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    if (!['main','final','overtime'].includes(state.phase)) return;
    state.timeRemaining = Math.max(0, state.timeRemaining - 1);
    if (state.timeRemaining > 0) return broadcast();

    if (state.phase === 'main') {
      state.phase = 'final';
      state.timeRemaining = config.finalSeconds;
      if (config.finalSeconds <= 0) return finishRound();
      event('FINAL DELAY +' + config.finalSeconds + 's');
      return;
    }
    finishRound();
  }, 1000);
}
function startRound() {
  clearTimers();
  state.roundId += 1;
  state.phase = 'main';
  state.timeRemaining = config.mainSeconds;
  state.bidders = {};
  state.winner = null;
  state.recentGifts = [];
  state.delivery = { status: 'idle', message: '' };
  event('ROUND #' + state.roundId + ' started (' + config.mainSeconds + 's)');
  startTicker();
}
function stopRound() {
  clearTimers();
  state.phase = 'idle';
  state.timeRemaining = config.mainSeconds;
  event('Auction stopped');
}
function resetOvertime(reason) {
  state.phase = 'overtime';
  state.timeRemaining = config.overtimeSeconds;
  event(reason + ' → OVERTIME reset ' + config.overtimeSeconds + 's');
}

function normalizeProfile(raw) {
  const user = raw && (raw.user || raw.userInfo || raw);
  const uniqueId = String(
    raw?.uniqueId || user?.uniqueId || user?.unique_id || raw?.userUniqueId || ''
  ).replace(/^@/, '');
  const nickname = String(raw?.nickname || user?.nickname || user?.displayName || uniqueId);
  let avatar = raw?.profilePictureUrl || user?.profilePictureUrl || user?.avatarThumb || '';
  if (Array.isArray(avatar)) avatar = avatar[0] || '';
  if (avatar && typeof avatar === 'object') avatar = avatar.url_list?.[0] || avatar.urlList?.[0] || '';
  return { uniqueId, nickname, profilePictureUrl: String(avatar || '') };
}
function giftCoins(raw) {
  const repeat = Math.max(1, Number(raw?.repeatCount || raw?.repeat_count || 1) || 1);
  const giftType = Number(raw?.giftType ?? raw?.gift_type ?? raw?.extendedGiftInfo?.type ?? 0);
  const repeatEnd = raw?.repeatEnd === true || raw?.repeatEnd === 1 || raw?.repeat_end === 1;
  if (giftType === 1 && !repeatEnd) return 0;

  const giftId = String(raw?.giftId || raw?.gift_id || raw?.extendedGiftInfo?.id || '');
  let unit = Number(
    raw?.diamondCount ??
    raw?.diamond_count ??
    raw?.extendedGiftInfo?.diamondCount ??
    raw?.extendedGiftInfo?.diamond_count ??
    raw?.giftDetails?.diamondCount ??
    0
  ) || 0;
  if (!unit && giftCatalog.has(giftId)) unit = giftCatalog.get(giftId);
  return Math.max(0, Math.floor(unit * repeat));
}
function giftName(raw) {
  return String(raw?.giftName || raw?.gift_name || raw?.extendedGiftInfo?.name || 'Gift');
}
function addRealGift(raw) {
  if (!['main','final','overtime'].includes(state.phase)) return;
  const p = normalizeProfile(raw);
  if (!p.uniqueId) return;
  const coins = giftCoins(raw);
  if (coins <= 0) return;

  const key = cleanId(p.uniqueId);
  const now = Date.now();
  const b = state.bidders[key] || {
    uniqueId: p.uniqueId,
    nickname: p.nickname || p.uniqueId,
    profilePictureUrl: p.profilePictureUrl || '',
    coins: 0,
    firstBidAt: now,
    lastBidAt: now
  };
  b.nickname = p.nickname || b.nickname;
  b.profilePictureUrl = p.profilePictureUrl || b.profilePictureUrl;
  b.coins += coins;
  b.lastBidAt = now;
  state.bidders[key] = b;

  state.recentGifts.unshift({
    at: now, uniqueId: p.uniqueId, nickname: p.nickname, giftName: giftName(raw), coins
  });
  state.recentGifts = state.recentGifts.slice(0, 25);

  if ((state.phase === 'final' || state.phase === 'overtime') && coins >= config.highGiftThreshold) {
    resetOvertime('REAL gift @' + p.uniqueId + ' +' + coins);
  } else {
    event('REAL gift @' + p.uniqueId + ' +' + coins + ' coins');
  }
}

function winnerMapping(uniqueId) {
  const key = cleanId(uniqueId);
  return config.winnerMappings.find(m => cleanId(m.tiktok) === key) || null;
}
function renderTemplate(template, winner) {
  return String(template || '')
    .replaceAll('{winner}', winner?.uniqueId || '')
    .replaceAll('{roblox}', winner?.roblox || '')
    .replaceAll('{item}', config.itemName || config.itemId)
    .replaceAll('{coins}', String(winner?.coins || 0));
}
async function postAward(winner, mapping) {
  if (!config.autoDelivery) {
    state.delivery = { status: 'skipped', message: 'Auto delivery is off' };
    return false;
  }
  if (!mapping || !mapping.roblox) {
    state.delivery = { status: 'waiting_mapping', message: 'No Roblox username mapping for @' + winner.uniqueId };
    return false;
  }
  if (!config.awardApiUrl) {
    state.delivery = { status: 'error', message: 'Award API URL is empty' };
    return false;
  }
  const awardId = 'auction-' + state.roundId + '-' + cleanId(winner.uniqueId) + '-' + config.itemId;
  if (deliveredAwardIds.has(awardId)) {
    state.delivery = { status: 'delivered', message: 'Already delivered (' + awardId + ')' };
    return true;
  }

  const payload = {
    mode: 'award',
    awardId,
    username: mapping.roblox,
    itemId: config.itemId,
    itemName: config.itemName,
    winningCoins: winner.coins,
    coinReward: config.coinReward
  };
  state.delivery = { status: 'sending', message: 'Sending ' + mapping.roblox + ' + ' + config.itemId };
  broadcast();

  try {
    const res = await fetch(config.awardApiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json: payload })
    });
    const text = await res.text();
    if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + text.slice(0, 300));
    deliveredAwardIds.add(awardId);
    saveJson(AWARDS_FILE, Array.from(deliveredAwardIds).slice(-5000));
    state.delivery = { status: 'delivered', message: mapping.roblox + ' ← ' + config.itemName };
    event('Roblox delivery complete for @' + winner.uniqueId + ' → ' + mapping.roblox);
    return true;
  } catch (e) {
    state.delivery = { status: 'error', message: String(e && e.message || e) };
    event('Roblox delivery error: ' + state.delivery.message);
    return false;
  }
}
async function postStatusComment(winner, mapping) {
  if (!config.autoStatusComment) return;
  const template = mapping?.message || config.deliveryMessage;
  const msg = renderTemplate(template, { ...winner, roblox: mapping?.roblox || '' });
  if (!msg) return;
  try {
    if (!tiktokConnection || typeof tiktokConnection.sendMessage !== 'function') throw new Error('TikTok connection cannot send authorized comments');
    await tiktokConnection.sendMessage(msg);
    event('Status comment sent: ' + msg);
  } catch (e) {
    state.delivery.message += ' | Comment pending: ' + msg;
    event('Could not auto-send status comment; kept as pending text');
  }
}
async function finishRound() {
  if (timer) clearInterval(timer);
  timer = null;
  const list = Object.values(state.bidders).sort((a,b) => (b.coins-a.coins) || (a.firstBidAt-b.firstBidAt));

  if (list.length > 1 && list[0].coins === list[1].coins && list[0].coins > 0) {
    resetOvertime('Exact real-bid tie @' + list[0].uniqueId + ' / @' + list[1].uniqueId);
    startTicker();
    return;
  }

  state.phase = 'finished';
  state.timeRemaining = 0;
  state.winner = list[0] && list[0].coins > 0 ? { ...list[0] } : null;
  if (!state.winner) {
    event('Round finished — no valid bidder');
  } else {
    event('WINNER @' + state.winner.uniqueId + ' with ' + state.winner.coins + ' real coins');
    const mapping = winnerMapping(state.winner.uniqueId);
    const delivered = await postAward(state.winner, mapping);
    if (delivered) await postStatusComment(state.winner, mapping);
  }
  broadcast();
  if (config.autoStartNextRound) {
    nextRoundTimer = setTimeout(startRound, config.nextRoundDelay * 1000);
  }
}

async function disconnectTikTok() {
  tiktokGeneration += 1;
  const old = tiktokConnection;
  tiktokConnection = null;
  giftCatalog = new Map();
  if (old) {
    try { old.removeAllListeners(); } catch (_) {}
    try { await old.disconnect(); } catch (_) {}
  }
  state.connection = { status: 'disconnected', username: '', roomId: '' };
  broadcast();
}
async function connectTikTok(username) {
  const clean = String(username || config.streamerUsername || '').trim().replace(/^@/, '');
  if (!clean) throw new Error('Enter TikTok LIVE username first');
  await disconnectTikTok();
  config.streamerUsername = clean;
  saveJson(CONFIG_FILE, config);
  const generation = ++tiktokGeneration;
  state.connection = { status: 'connecting', username: clean, roomId: '' };
  broadcast();

  const mod = await import('tiktok-live-connector');
  const TikTokLiveConnection = mod.TikTokLiveConnection || mod.WebcastPushConnection || mod.default?.TikTokLiveConnection;
  if (!TikTokLiveConnection) throw new Error('TikTok connector class was not found');

  const conn = new TikTokLiveConnection(clean, {
    enableExtendedGiftInfo: true,
    processInitialData: true,
    fetchRoomInfoOnConnect: true
  });
  tiktokConnection = conn;

  conn.on('gift', raw => {
    if (generation !== tiktokGeneration || conn !== tiktokConnection) return;
    addRealGift(raw);
  });
  conn.on('roomUser', raw => {
    if (generation !== tiktokGeneration || conn !== tiktokConnection) return;
    if (raw && Number.isFinite(Number(raw.viewerCount))) {
      state.viewerCount = Number(raw.viewerCount);
      broadcast();
    }
  });
  conn.on('chat', raw => {
    if (generation !== tiktokGeneration || conn !== tiktokConnection) return;
    const p = normalizeProfile(raw);
    const comment = String(raw?.comment || raw?.message || '');
    io.emit('chat', { ...p, comment, at: Date.now() });
  });
  conn.on('disconnected', () => {
    if (generation !== tiktokGeneration || conn !== tiktokConnection) return;
    state.connection.status = 'disconnected';
    event('TikTok LIVE disconnected');
  });
  conn.on('error', err => {
    if (generation !== tiktokGeneration || conn !== tiktokConnection) return;
    io.emit('log', { at: Date.now(), text: 'TikTok error: ' + String(err?.message || err) });
  });

  const connected = await conn.connect();
  if (generation !== tiktokGeneration || conn !== tiktokConnection) return;
  state.connection = {
    status: 'connected',
    username: clean,
    roomId: String(connected?.roomId || '')
  };
  try {
    const gifts = await conn.fetchAvailableGifts();
    giftCatalog = new Map((gifts || []).map(g => [String(g.id || g.giftId || ''), Number(g.diamondCount || g.diamond_count || 0)]));
  } catch (_) {}
  event('Connected to TikTok LIVE @' + clean);
}

function startServer() {
  return new Promise((resolve, reject) => {
    const app = express();
    app.use(express.json({ limit: '256kb' }));
    app.use(express.static(path.join(__dirname, 'public')));
    const server = http.createServer(app);
    io = new Server(server, { cors: { origin: '*' } });

    app.get('/api/health', (_req,res) => res.json({ ok:true, phase:state.phase }));
    io.on('connection', socket => {
      socket.emit('state', snapshot());
      socket.on('get_state', () => socket.emit('state', snapshot()));
      socket.on('start_round', startRound);
      socket.on('stop_round', stopRound);
      socket.on('connect_tiktok', async d => {
        try { await connectTikTok(d && d.username); }
        catch (e) {
          state.connection = { status:'error', username:String(d?.username || ''), roomId:'' };
          event('TikTok connect error: ' + String(e?.message || e));
        }
      });
      socket.on('disconnect_tiktok', disconnectTikTok);
      socket.on('update_config', raw => {
        config = sanitizeConfig({ ...config, ...(raw || {}) });
        saveJson(CONFIG_FILE, config);
        if (state.phase === 'idle') state.timeRemaining = config.mainSeconds;
        event('Settings saved');
      });
      socket.on('test_award', async () => {
        const fake = { uniqueId:'test', nickname:'Test', coins:100 };
        const mapping = { roblox: config.winnerMappings[0]?.roblox || '', message:'' };
        await postAward(fake, mapping);
        broadcast();
      });
    });

    server.on('error', reject);
    server.listen(PORT, '127.0.0.1', () => {
      resolve({
        close: () => new Promise(r => server.close(r))
      });
    });
  });
}

module.exports = { startServer };
