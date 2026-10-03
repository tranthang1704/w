const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { TIKTOK_GIFTS } = require('./public/tiktok-gifts');
const { createAnbeoAnimationClient, normalizeAnbeoUrl, DEFAULT_URL: DEFAULT_ANBEO_URL } = require('./anbeo-animation-client');

let TikTokLiveConnectionClass = null;
let simplifyObjectFn = null;
let tiktokSignConfig = null;
let isConnectingTikTok = false;
let giftPriceCache = {};

// Auth Keys Config - write to Electron's userData folder for persistence and write access
let extRootDir = __dirname;
try {
  const { app } = require('electron');
  if (app) {
    extRootDir = app.getPath('userData');
  }
} catch (e) {
  const isPkg = typeof process.pkg !== 'undefined';
  extRootDir = isPkg ? path.dirname(process.execPath) : __dirname;
}

const KEYS_FILE = path.join(extRootDir, 'keys.json');
const ACCOUNTS_FILE = path.join(extRootDir, 'allowed_accounts.enc');
const CONFIG_FILE = path.join(extRootDir, 'config.json');
const DEVICES_FILE = path.join(extRootDir, 'device_bindings.json');
const DEVICE_ID_FILE = path.join(extRootDir, 'device_id.json');
const GIFT_PRICES_FILE = path.join(extRootDir, 'gift_prices.json');
const RCKZ_SETTINGS_FILE = path.join(extRootDir, 'rckz_board_settings.json');

const AUTO_AUCTION_SETTINGS_FILE = path.join(extRootDir, 'auto_auction_settings.json');
const AUTO_AWARD_HISTORY_FILE = path.join(extRootDir, 'auto_auction_awards.json');
const AUTO_AUCTION_DEFAULTS = {
  enabled: true,
  mainSeconds: 50,
  finalSeconds: 25,
  highGiftThreshold: 100,
  overtimeSeconds: 30,
  nextRoundDelay: 6,
  autoNextRound: true,
  autoDelivery: true,
  awardApiUrl: 'https://tranthag-auto-auction-test.floot.app/_api/roblox-award',
  itemId: 'AETHERON',
  itemName: 'Aetheron Pet',
  coinReward: 100,
  autoStatusComment: true,
  deliveryMessage: '@{winner} received {item}, tysm',
  winnerMappings: []
};
function aaInt(v,min,max,fallback){ const n=Math.floor(Number(v)); return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback; }
function aaTikTok(v){ return String(v||'').trim().replace(/^@/,'').toLowerCase(); }
function aaLoad(file,fallback){ try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(_){return fallback;} }
function aaSave(file,value){ try{fs.writeFileSync(file,JSON.stringify(value,null,2),'utf8');}catch(e){logToFile('AUTO_AUCTION save error: '+(e&&e.message));} }
function aaSanitize(raw){
  const x=Object.assign({},AUTO_AUCTION_DEFAULTS,raw||{});
  x.enabled=x.enabled!==false;
  x.mainSeconds=aaInt(x.mainSeconds,5,3600,50);
  x.finalSeconds=aaInt(x.finalSeconds,0,600,25);
  x.highGiftThreshold=aaInt(x.highGiftThreshold,1,100000000,100);
  x.overtimeSeconds=aaInt(x.overtimeSeconds,5,600,30);
  x.nextRoundDelay=aaInt(x.nextRoundDelay,1,300,6);
  x.coinReward=aaInt(x.coinReward,0,1000000000,100);
  x.autoNextRound=!!x.autoNextRound;
  x.autoDelivery=!!x.autoDelivery;
  x.autoStatusComment=!!x.autoStatusComment;
  x.awardApiUrl=String(x.awardApiUrl||'').trim().slice(0,1000);
  x.itemId=String(x.itemId||'').trim().slice(0,120);
  x.itemName=String(x.itemName||'').trim().slice(0,160);
  x.deliveryMessage=String(x.deliveryMessage||'').slice(0,280);
  x.winnerMappings=Array.isArray(x.winnerMappings)?x.winnerMappings.slice(0,50).map(m=>({
    tiktok:aaTikTok(m&&m.tiktok),
    roblox:String(m&&m.roblox||'').trim().slice(0,32),
    message:String(m&&m.message||'').slice(0,280)
  })).filter(m=>m.tiktok&&m.roblox):[];
  return x;
}
let autoAuctionSettings=aaSanitize(aaLoad(AUTO_AUCTION_SETTINGS_FILE,AUTO_AUCTION_DEFAULTS));
let autoAwardHistory=new Set(aaLoad(AUTO_AWARD_HISTORY_FILE,[]));
let autoNextRoundTimer=null;
function aaPublic(){ return JSON.parse(JSON.stringify(autoAuctionSettings)); }
function aaApplyTiming(){
  if(!autoAuctionSettings.enabled||!auctionState||!auctionState.config)return;
  auctionState.config.initialTime=autoAuctionSettings.mainSeconds;
  auctionState.config.delay=autoAuctionSettings.finalSeconds;
  auctionState.config.autoTieEnabled=false;
  auctionState.config.autoTieTarget='';
}
function aaMap(id){ const k=aaTikTok(id); return autoAuctionSettings.winnerMappings.find(m=>aaTikTok(m.tiktok)===k)||null; }
function aaTemplate(t,w,m){
  return String(t||'').replaceAll('{winner}',String(w?.uniqueId||'')).replaceAll('{roblox}',String(m?.roblox||''))
    .replaceAll('{item}',String(autoAuctionSettings.itemName||autoAuctionSettings.itemId||''))
    .replaceAll('{coins}',String(w?.coins||0));
}
function aaStatus(status,detail){ if(io) io.emit('auto_auction_delivery_status',{status,detail:String(detail||'')}); }
async function aaDeliver(winner){
  const mapping=aaMap(winner.uniqueId);
  if(!mapping){ aaStatus('waiting_mapping','No Roblox mapping for @'+winner.uniqueId); return false; }
  if(!autoAuctionSettings.autoDelivery){ aaStatus('delivery_off','Auto Roblox delivery disabled'); return false; }
  const awardId='auction-'+auctionRoundGeneration+'-'+aaTikTok(winner.uniqueId)+'-'+autoAuctionSettings.itemId;
  if(autoAwardHistory.has(awardId)){ aaStatus('delivered','Already delivered: '+awardId); return true; }
  const payload={mode:'award',awardId,username:mapping.roblox,itemId:autoAuctionSettings.itemId,itemName:autoAuctionSettings.itemName,
    winningCoins:Math.max(0,Math.floor(Number(winner.coins)||0)),coinReward:autoAuctionSettings.coinReward};
  aaStatus('sending',mapping.roblox+' ← '+autoAuctionSettings.itemName);
  try{
    const res=await fetch(autoAuctionSettings.awardApiUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({json:payload})});
    const body=await res.text();
    if(!res.ok) throw new Error('HTTP '+res.status+': '+body.slice(0,250));
    autoAwardHistory.add(awardId);
    aaSave(AUTO_AWARD_HISTORY_FILE,Array.from(autoAwardHistory).slice(-5000));
    aaStatus('delivered',mapping.roblox+' ← '+autoAuctionSettings.itemName);
    if(autoAuctionSettings.autoStatusComment){
      const message=aaTemplate(mapping.message||autoAuctionSettings.deliveryMessage,winner,mapping).trim();
      if(message&&tiktokConnection&&typeof tiktokConnection.sendMessage==='function'){
        try{ await tiktokConnection.sendMessage(message); aaStatus('comment_sent',message); }
        catch(_){ aaStatus('comment_pending',message); }
      }
    }
    return true;
  }catch(e){ aaStatus('error',String(e&&e.message||e)); return false; }
}
function aaStartFreshRound(){
  if(!autoAuctionSettings.enabled)return;
  resetAuction();
  aaApplyTiming();
  auctionState.timeRemaining=auctionState.config.initialTime;
  auctionState.hasAppliedFinalDelay=false;
  auctionState.vouchAvailable=false;
  auctionState.bidders={};
  activeFinishedWinner=null;
  finishedWinnerMessages=[];
  pendingGiftCoins={};
  pendingGiftProfiles={};
  lastRoundHadWinner=false;
  startTimer();
  io.emit('auto_auction_round_started',{timeRemaining:auctionState.timeRemaining});
}
async function aaAfterFinish(winner){
  if(!autoAuctionSettings.enabled)return;
  if(winner) await aaDeliver(winner);
  if(autoAuctionSettings.autoNextRound){
    if(autoNextRoundTimer) clearTimeout(autoNextRoundTimer);
    autoNextRoundTimer=setTimeout(aaStartFreshRound,autoAuctionSettings.nextRoundDelay*1000);
  }
}
function aaOnRealGift(decision){
  if(!autoAuctionSettings.enabled||!decision||auctionState.status!=='running'||!auctionState.hasAppliedFinalDelay)return;
  const delta=Math.max(0,Math.floor(Number(decision.creditDelta)||0));
  if(delta<autoAuctionSettings.highGiftThreshold)return;
  auctionState.timeRemaining=autoAuctionSettings.overtimeSeconds;
  io.emit('timer_extended',{newTime:auctionState.timeRemaining,reason:'REAL gift >= '+autoAuctionSettings.highGiftThreshold+' → overtime reset '+autoAuctionSettings.overtimeSeconds+'s'});
  io.emit('auto_auction_overtime',{uniqueId:decision.uniqueId,creditedCoins:delta,threshold:autoAuctionSettings.highGiftThreshold,newTime:auctionState.timeRemaining});
  broadcastState();
}

const CIPHER_KEY = 'TIKTOK-AUCTION-SECRET-2026';

// RCKZ Custom Board â€” shared settings schema (validation + presentation
// tables). Same module the board/customizer use in the browser. No Firebase,
// no external endpoints; pure local validation.
const rckzSchema = require('./public/rckz-settings-schema.js');

// In-memory copy of the current RCKZ board customizer settings, persisted to
// RCKZ_SETTINGS_FILE so the chosen look survives an app restart with no cloud.
let rckzBoardSettings = rckzSchema.defaults();

function loadRckzBoardSettings() {
  try {
    if (fs.existsSync(RCKZ_SETTINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(RCKZ_SETTINGS_FILE, 'utf8'));
      rckzBoardSettings = rckzSchema.validate(data);
    }
  } catch (e) {
    console.error('Error loading rckz_board_settings.json:', e && e.message);
    rckzBoardSettings = rckzSchema.defaults();
  }
}

function saveRckzBoardSettings() {
  try {
    fs.writeFileSync(RCKZ_SETTINGS_FILE, JSON.stringify(rckzBoardSettings, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving rckz_board_settings.json:', e && e.message);
  }
}

loadRckzBoardSettings();

// â”€â”€ RCKZ Custom Board â€” ephemeral runtime overlays (not persisted) â”€â”€â”€â”€â”€â”€
// These are the extra source-side controls (ban banner, Spotify embed, bad-
// connection banner, instant-take state). They live only in memory and are
// broadcast to freshly-connected boards so a reload re-paints the current
// state. All mutators are gated as controlActions (widgets cannot write).
let rckzRuntimeState = {
  ban: { active: false, title: 'BAN ALERT', reason: '' },
  spotify: { visible: false, embedUrl: '' },
  badConnection: false,
  instantTake: { enabled: false, amount: 0 }
};

function sanitizeInlineText(value, max) {
  if (typeof value !== 'string') return '';
  var v = value.replace(/[\x00-\x1f<>"'`\\]/g, '').trim();
  var cap = max || 200;
  if (v.length > cap) v = v.slice(0, cap);
  return v;
}

// Whitelist ONLY the official Spotify embed host (open.spotify.com/embed) to
// avoid arbitrary iframe injection from a rogue dashboard socket. Everything
// else is dropped.
function sanitizeSpotifyEmbed(value) {
  if (typeof value !== 'string') return '';
  var v = value.trim();
  if (!v) return '';
  if (v.length > 512) return '';
  if (!/^https:\/\/open\.spotify\.com\/embed\//.test(v)) return '';
  return v;
}

const DEFAULT_ANBEO_CONFIG = Object.freeze({
  enabled: false,
  url: DEFAULT_ANBEO_URL
});

function sanitizeAnbeoConfig(value) {
  const incoming = value && typeof value === 'object' ? value : {};
  const normalizedUrl = normalizeAnbeoUrl(incoming.url || DEFAULT_ANBEO_URL);
  return {
    enabled: incoming.enabled === true,
    url: normalizedUrl || DEFAULT_ANBEO_URL
  };
}

function getPublicAnbeoConfig() {
  const config = sanitizeAnbeoConfig(appConfig.anbeoAnimation);
  return { enabled: config.enabled, url: config.url };
}

function sanitizeEluderApiKey(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length <= 512 ? trimmed : trimmed.slice(0, 512);
}

function maskEluderKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '****' + key.slice(-4);
}

function getPublicEluderConfig() {
  return {
    configured: !!appConfig.eluderApiKey,
    maskedKey: maskEluderKey(appConfig.eluderApiKey),
    hasKey: !!appConfig.eluderApiKey
  };
}

let googleSheetApiUrl = '';
let appConfig = {
  googleSheetApiUrl: '',
  lastActiveKey: '',
  eluderApiKey: '',
  termsAccepted: false,
  anbeoAnimation: { ...DEFAULT_ANBEO_CONFIG }
};
let machineDeviceId = '';

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(appConfig, null, 2), 'utf8');
    googleSheetApiUrl = appConfig.googleSheetApiUrl || '';
  } catch (e) {
    console.error("Error saving config.json:", e);
  }
}

function loadConfig() {
  try {
    const BUNDLED_CONFIG = path.join(__dirname, 'config.json');
    if (fs.existsSync(CONFIG_FILE)) {
      const configData = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      appConfig = { ...appConfig, ...configData };
      appConfig.anbeoAnimation = sanitizeAnbeoConfig(configData.anbeoAnimation);
      appConfig.eluderApiKey = sanitizeEluderApiKey(configData.eluderApiKey || '');
      appConfig.termsAccepted = configData.termsAccepted === true;
    }
    
    if (!appConfig.googleSheetApiUrl) {
      let defaultUrl = '';
      if (fs.existsSync(BUNDLED_CONFIG)) {
        const bundledData = JSON.parse(fs.readFileSync(BUNDLED_CONFIG, 'utf8'));
        defaultUrl = bundledData.googleSheetApiUrl || '';
      }
      if (defaultUrl) {
        appConfig.googleSheetApiUrl = defaultUrl;
        saveConfig();
        console.log(`[AUTH] Restored googleSheetApiUrl from bundled config: ${defaultUrl}`);
      }
    }
    googleSheetApiUrl = appConfig.googleSheetApiUrl || '';
  } catch (e) {
    console.error("Error loading config.json:", e);
  }
}

function getOrGenerateMachineDeviceId() {
  if (machineDeviceId) return machineDeviceId;
  try {
    if (fs.existsSync(DEVICE_ID_FILE)) {
      const data = JSON.parse(fs.readFileSync(DEVICE_ID_FILE, 'utf8'));
      machineDeviceId = data.deviceId;
    }
  } catch (e) {
    console.error("Error reading device_id.json:", e);
  }
  
  if (!machineDeviceId) {
    machineDeviceId = 'mac_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    try {
      fs.writeFileSync(DEVICE_ID_FILE, JSON.stringify({ deviceId: machineDeviceId }, null, 2), 'utf8');
    } catch (e) {
      console.error("Error writing device_id.json:", e);
    }
  }
  return machineDeviceId;
}

loadConfig();

const LOG_MAX_SIZE = 5 * 1024 * 1024; // 5MB
let logDirVerified = false;
let logRotating = false;
function logToFile(msg) {
  try {
    const logPath = path.join(extRootDir, 'logs', 'server_debug.log');
    const logDir = path.dirname(logPath);
    if (!logDirVerified) {
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      logDirVerified = true;
    }
    if (!logRotating) {
      try {
        const stat = fs.statSync(logPath);
        if (stat.size > LOG_MAX_SIZE) {
          logRotating = true;
          const rotated = logPath + '.old';
          fs.rename(logPath, rotated, () => { logRotating = false; });
          return;
        }
      } catch (_) {}
    }
    const logLine = `[${new Date().toISOString()}] [PID:${process.pid}] ${msg}\n`;
    fs.appendFile(logPath, logLine, 'utf8', () => {});
  } catch (_) {}
}

const anbeoAnimationClient = createAnbeoAnimationClient({
  getConfig: () => sanitizeAnbeoConfig(appConfig.anbeoAnimation),
  log: logToFile,
  timeoutMs: 2500
});

// Open the bridge eagerly whenever it's enabled, so ANBEO can push commands
// (e.g. anbeo-credit-gift) even during idle periods with no outbound effect
// traffic. Safe to call multiple times â€” the client no-ops when already open.
function ensureAnbeoConnected() {
  try {
    if (!sanitizeAnbeoConfig(appConfig.anbeoAnimation).enabled) return;
    anbeoAnimationClient.connect();
  } catch (_) {}
}

let activeKeys = [];
let allowedAccounts = [];
let activeDevicesByKey = {};
// Delta-based gift tracking: streakId/fingerprint -> highest repeatCount credited.
// Lets us credit each combo increment instantly (no waiting for repeatEnd).
const giftGroupState = new Map();

// Canonical identity used for every bidder map key and effect correlation.
function canonicalPlayerId(value) {
  return String(value == null ? '' : value).trim().replace(/^@+/, '').toLowerCase();
}

const DEFAULT_AVATAR_URL = '/assets/default-avatar.png';

function firstAvatarUrl(value, seen = new Set()) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = firstAvatarUrl(item, seen);
      if (url) return url;
    }
    return '';
  }
  if (typeof value !== 'object' || seen.has(value)) return '';
  seen.add(value);
  for (const key of ['url', 'urlList', 'url_list', 'urls']) {
    const url = firstAvatarUrl(value[key], seen);
    if (url) return url;
  }
  return '';
}

function extractTikTokProfile(value) {
  const sources = [];
  const add = candidate => {
    if (candidate && typeof candidate === 'object' && !sources.includes(candidate)) sources.push(candidate);
  };
  add(value);
  add(value && value.user);
  add(value && value.userInfo);
  add(value && value.userInfo && value.userInfo.user);
  add(value && value.userDetails);
  add(value && value.user_details);

  let uniqueId = '';
  let nickname = '';
  let profilePictureUrl = '';
  const avatarFields = [
    'profilePictureUrl', 'profile_picture_url', 'profilePictureUrls', 'profile_picture_urls',
    'profilePicture', 'profile_picture', 'avatarUrl', 'avatar_url', 'avatarThumb',
    'avatar_thumb', 'avatarMedium', 'avatar_medium', 'avatarLarge', 'avatar_large',
    'avatarLarger', 'avatar_larger'
  ];
  for (const source of sources) {
    if (!uniqueId) uniqueId = String(source.uniqueId || source.unique_id || source.displayId || source.display_id || '').trim();
    if (!nickname) nickname = String(source.nickname || source.nickName || source.displayName || source.display_name || '').trim();
    if (!profilePictureUrl) {
      for (const field of avatarFields) {
        profilePictureUrl = firstAvatarUrl(source[field]);
        if (profilePictureUrl && profilePictureUrl !== DEFAULT_AVATAR_URL) break;
        profilePictureUrl = '';
      }
    }
  }
  return { uniqueId, nickname, profilePictureUrl };
}

function mergeTikTokProfileData(playerId, ...profiles) {
  const firstProfile = profiles.find(Boolean) || {};
  const canonicalId = canonicalPlayerId(playerId || firstProfile.uniqueId);
  let nickname = '';
  let profilePictureUrl = '';
  for (const raw of profiles) {
    const profile = extractTikTokProfile(raw || {});
    const candidateNickname = String(profile.nickname || '').trim();
    if (!nickname && candidateNickname && canonicalPlayerId(candidateNickname) !== canonicalId) nickname = candidateNickname;
    if (!profilePictureUrl && profile.profilePictureUrl && profile.profilePictureUrl !== DEFAULT_AVATAR_URL) {
      profilePictureUrl = profile.profilePictureUrl;
    }
  }
  return { uniqueId: canonicalId, nickname, profilePictureUrl };
}

// Merge legacy map entries that differ only by case or a leading @. Coins are
// summed exactly once; display fields remain human-friendly.
function mergeCanonicalBidders(bidders) {
  const merged = {};
  for (const [legacyKey, raw] of Object.entries(bidders || {})) {
    if (!raw) continue;
    const playerId = canonicalPlayerId(raw.uniqueId || legacyKey);
    if (!playerId) continue;
    const bidder = { ...raw, uniqueId: playerId, coins: Number(raw.coins) || 0 };
    if (!merged[playerId]) {
      merged[playerId] = bidder;
      continue;
    }
    const current = merged[playerId];
    current.coins += bidder.coins;
    if ((!current.nickname || canonicalPlayerId(current.nickname) === playerId) && bidder.nickname) {
      current.nickname = bidder.nickname;
    }
    const bidderAvatar = firstAvatarUrl(bidder.profilePictureUrl);
    if ((!current.profilePictureUrl || current.profilePictureUrl === DEFAULT_AVATAR_URL) && bidderAvatar) {
      current.profilePictureUrl = bidderAvatar;
    }
    if (new Date(bidder.lastBidTime || 0).getTime() > new Date(current.lastBidTime || 0).getTime()) {
      current.lastBidTime = bidder.lastBidTime;
    }
  }
  return merged;
}

let effectSequence = 0;
function buildEffectEnvelope(input) {
  const playerId = canonicalPlayerId(input.playerId || input.uniqueId);
  const order = ++effectSequence;
  return Object.freeze({
    effectId: `effect-${Date.now().toString(36)}-${process.pid}-${order}`,
    playerId,
    username: String(input.username || input.nickname || playerId),
    avatarUrl: input.avatarUrl || input.profilePictureUrl || '',
    giftName: String(input.giftName || ''),
    giftId: input.giftId,
    msgId: input.msgId,
    groupId: input.groupId,
    giftType: input.giftType,
    repeatEnd: input.repeatEnd,
    countMode: input.countMode,
    iconUrl: input.iconUrl || input.giftIcon || '',
    count: Number(input.count || input.creditedCoins) || 0,
    streak: Math.max(1, parseInt(input.streak, 10) || 1),
    creditedCoins: Number(input.creditedCoins) || 0,
    source: String(input.source || 'unknown'),
    order,
    titleGifter: !!input.titleGifter,
    hideCard: !!input.hideCard
  });
}

const COIN_EFFECT_TIERS = Object.freeze([
  Object.freeze({ minimumCoins: 1000, giftName: 'Galaxy', iconUrl: 'https://p16-webcast.tiktokcdn.com/img/maliva/webcast-va/resource/79a02148079526539f7599150da9fd28.png~tplv-obj.webp', legacyVideoEvent: '' }),
  Object.freeze({ minimumCoins: 699, giftName: 'Swan', iconUrl: 'https://p16-webcast.tiktokcdn.com/img/maliva/webcast-va/97a26919dbf6afe262c97e22a83f4bf1~tplv-obj.webp', legacyVideoEvent: '' }),
  Object.freeze({ minimumCoins: 500, giftName: 'Money Gun', iconUrl: 'https://p16-webcast.tiktokcdn.com/img/maliva/webcast-va/e0589e95a2b41970f0f30f6202f5fce6~tplv-obj.webp', legacyVideoEvent: 'play_fake_gift_moneygun' }),
  Object.freeze({ minimumCoins: 299, giftName: 'Corgi', iconUrl: 'https://p16-webcast.tiktokcdn.com/img/maliva/webcast-va/148eef0884fdb12058d1c6897d1e02b9~tplv-obj.webp', legacyVideoEvent: 'play_fake_gift_corgy' }),
  Object.freeze({ minimumCoins: 100, giftName: 'Game Controller', iconUrl: 'https://p16-webcast.tiktokcdn.com/img/maliva/webcast-va/20ec0eb50d82c2c445cb8391fd9fe6e2~tplv-obj.webp', legacyVideoEvent: 'play_fake_gift_manette' }),
  Object.freeze({ minimumCoins: 30, giftName: 'Doughnut', iconUrl: 'https://p16-webcast.tiktokcdn.com/img/maliva/webcast-va/4e7ad6bdf0a1d860c538f38026d4e812~tplv-obj.webp', legacyVideoEvent: '' })
]);

const ANBEO_GIFT_BUCKETS = (() => {
  const buckets = new Map();
  for (const gift of TIKTOK_GIFTS || []) {
    const name = String(gift && gift.n || '').trim();
    const coins = Number(gift && gift.c);
    const iconUrl = String(gift && gift.i || '').trim();
    if (!name || !Number.isInteger(coins) || coins <= 0) continue;
    if (!/^https:\/\/p16-webcast\.tiktokcdn\.com\//i.test(iconUrl)) continue;
    if (Number(gift.id) >= 90001 && Number(gift.id) <= 90003) continue;
    if (!buckets.has(coins)) buckets.set(coins, []);
    buckets.get(coins).push(Object.freeze({ giftName: name, iconUrl, coinCost: coins }));
  }
  for (const gifts of buckets.values()) Object.freeze(gifts);
  return buckets;
})();
const ANBEO_GIFT_PRICES = Object.freeze(Array.from(ANBEO_GIFT_BUCKETS.keys()).sort((a, b) => a - b));

function findAnbeoGiftBucket(creditedCoins) {
  const coins = Number(creditedCoins);
  if (!Number.isFinite(coins) || coins <= 0 || !ANBEO_GIFT_PRICES.length) return null;
  if (ANBEO_GIFT_BUCKETS.has(coins)) return ANBEO_GIFT_BUCKETS.get(coins);

  let low = 0;
  let high = ANBEO_GIFT_PRICES.length - 1;
  let nearestIndex = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (ANBEO_GIFT_PRICES[middle] <= coins) {
      nearestIndex = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return nearestIndex >= 0 ? ANBEO_GIFT_BUCKETS.get(ANBEO_GIFT_PRICES[nearestIndex]) : null;
}

function pickRandomAnbeoGift(creditedCoins, rng = Math.random) {
  const bucket = findAnbeoGiftBucket(creditedCoins);
  if (!bucket || !bucket.length) return null;
  const value = typeof rng === 'function' ? Number(rng()) : Number(rng);
  const normalized = Number.isFinite(value) ? Math.max(0, Math.min(0.999999999, value)) : 0;
  return bucket[Math.floor(normalized * bucket.length)];
}

// Fixed-pick gift theo má»©c xu. LáşĄy quĂ  Ć°u tiĂŞn Ä‘áş§u tiĂŞn trong bucket tĆ°Ćˇng
// á»©ng (Rose/1, Finger Heart/5, Rosa/10, Perfume/20, Doughnut/30, Game Controller/100,
// Money Gun/500, Swan/699, Galaxy/1000). Má»©c xu khĂ´ng khá»›p rĆˇi xuá»‘ng má»©c â‰¤ gáş§n
// nháşĄt (theo findAnbeoGiftBucket).
function resolveFixedGift(creditedCoins) {
  const bucket = findAnbeoGiftBucket(creditedCoins);
  if (bucket && bucket.length) {
    // Catalog order is not a gift identity. Keep the new release's preferred
    // coin-only defaults even when the full catalog is sorted alphabetically.
    const preferred = {1: 'Rose', 5: 'Finger Heart', 10: 'Rosa', 20: 'Perfume',
      30: 'Doughnut', 100: 'Game Controller', 299: 'Corgi', 500: 'Money Gun',
      699: 'Swan', 1000: 'Galaxy'}[bucket[0].coinCost];
    return bucket.find(gift => gift.giftName === preferred) || bucket[0];
  }
  return null;
}

function resolveCoinEffectTier(creditedCoins) {
  const coins = Number(creditedCoins);
  if (!Number.isFinite(coins) || coins <= 0) return null;
  return COIN_EFFECT_TIERS.find(tier => coins >= tier.minimumCoins) || null;
}

function getCoinEffectRoute(creditedCoins, source, autoFakeGift) {
  const coins = Number(creditedCoins);
  // anbeo_control is driven from the ANBEO side with an explicit exact gift.
  // Skip the random-bucket + local-overlay routing so the ANBEO animation is
  // driven only by the caller's exact selection (no random replacement, no
  // extra local effect).
  if (source === 'fake_user_gift' || source === 'anbeo_control' ||
      !Number.isFinite(coins) || coins <= 0) return null;
  return autoFakeGift && resolveCoinEffectTier(coins) ? 'local-and-anbeo' : 'anbeo-only';
}

function forwardGiftEffectToAnbeo(envelope) {
  if (!envelope || !envelope.effectId || !envelope.playerId) return false;
  if (!sanitizeAnbeoConfig(appConfig.anbeoAnimation).enabled) {
    logToFile(`ANBEO_FORWARD_SKIPPED ${JSON.stringify({ effectId: envelope.effectId, reason: 'disabled' })}`);
    return false;
  }
  try {
    const accepted = anbeoAnimationClient.forward(envelope);
    logToFile(`${accepted ? 'ANBEO_FORWARD_QUEUED' : 'ANBEO_FORWARD_SKIPPED'} ${JSON.stringify({ effectId: envelope.effectId, playerId: envelope.playerId, source: envelope.source, creditedCoins: envelope.creditedCoins, giftName: envelope.giftName, reason: accepted ? undefined : 'duplicate-or-unavailable' })}`);
    return accepted;
  } catch (e) {
    logToFile(`ANBEO_FORWARD_ERROR ${String(e && e.message || 'unknown')}`);
    return false;
  }
}

function emitLocalGiftEffect(envelope, legacyVideoEvent) {
  if (!envelope || !envelope.effectId || !envelope.playerId) return false;
  logToFile(`EFFECT_EMIT ${JSON.stringify({ effectId: envelope.effectId, playerId: envelope.playerId, source: envelope.source, order: envelope.order, creditedCoins: envelope.creditedCoins, giftName: envelope.giftName })}`);
  io.emit('show-gift', envelope);
  // Correlated effects are rendered exclusively by the FIFO overlay. Emitting the
  // old per-video events as well would create a second, interruptible renderer.
  return true;
}

function emitGiftEffect(envelope, legacyVideoEvent) {
  if (!emitLocalGiftEffect(envelope, legacyVideoEvent)) return false;
  forwardGiftEffectToAnbeo(envelope);
  forwardGiftToLog(envelope);
  return true;
}

function buildCoinEffectEnvelope(data, gift) {
  return buildEffectEnvelope({
    playerId: data.playerId,
    nickname: data.nickname,
    profilePictureUrl: data.profilePictureUrl,
    giftName: gift.giftName,
    giftIcon: gift.iconUrl,
    count: data.creditedCoins,
    streak: data.streak || 1,
    giftId: data.giftId,
    msgId: data.msgId,
    groupId: data.groupId,
    giftType: data.giftType,
    repeatEnd: data.repeatEnd,
    countMode: data.countMode,
    creditedCoins: data.creditedCoins,
    source: data.source,
    hideCard: data.hideCard
  });
}

function dispatchCoinEffect(input, handlers) {
  const data = input || {};
  const route = getCoinEffectRoute(data.creditedCoins, data.source, data.autoFakeGift);
  if (!route) return null;

  const tier = resolveCoinEffectTier(data.creditedCoins);
  const targets = handlers || {};
  let localEffect = null;
  if (route === 'local-and-anbeo' && tier) {
    localEffect = buildCoinEffectEnvelope(data, tier);
    if (typeof targets.emit === 'function') targets.emit(localEffect, tier.legacyVideoEvent);
  }

  // Named gifts must never be replaced by a different gift with a similar price.
  const fixedGift = data.giftName ? {
    giftName: data.giftName,
    iconUrl: data.giftIcon || '',
    coinCost: data.creditedCoins
  } : resolveFixedGift(data.creditedCoins) || tier;
  if (!fixedGift) return localEffect ? Object.freeze({ route, tier, fixedGift: null, localEffect, anbeoEffect: null, effect: localEffect }) : null;
  const anbeoEffect = buildCoinEffectEnvelope(data, fixedGift);
  if (typeof targets.forward === 'function') targets.forward(anbeoEffect);
  forwardGiftToLog(anbeoEffect);

  return Object.freeze({ route, tier, fixedGift, localEffect, anbeoEffect, effect: localEffect || anbeoEffect });
}

function findCatalogGift(giftId, giftName) {
  const official = gift => !(Number(gift.id) >= 90001 && Number(gift.id) <= 90003);
  const byId = giftId != null && TIKTOK_GIFTS.find(gift => official(gift) && gift.id != null && String(gift.id) === String(giftId));
  if (byId) return byId;
  const name = normalizeGiftLookupName(giftName);
  return name ? TIKTOK_GIFTS.find(gift => official(gift) && normalizeGiftLookupName(gift.n) === name) || null : null;
}

// The auction ledger can defer admission below minimumEntry, or reject a bid
// after a round ends. Live Chat must still receive every newly counted gift.
// HYBRID ver700 supports countMode=delta: do not count the combo a second time.
function forwardRealGiftToHybrid(data, decision, handlers) {
  if (!decision.credit || decision.creditDelta <= 0) return null;
  const catalog = findCatalogGift(decision.giftId, decision.giftName);
  const giftName = decision.giftName && !/^Gift ID /i.test(decision.giftName)
    ? decision.giftName : (catalog && catalog.n) || decision.giftName;
  const icon = firstAvatarUrl(data.giftPictureUrl) || firstAvatarUrl(data.giftDetails?.image)
    || firstAvatarUrl(data.extendedGiftInfo?.image) || firstAvatarUrl(data.gift?.image)
    || (catalog && catalog.i) || '';
  return dispatchCoinEffect({
    playerId: canonicalPlayerId(decision.uniqueId),
    nickname: decision.nickname,
    profilePictureUrl: decision.profilePictureUrl,
    giftId: decision.giftId,
    giftName,
    giftIcon: icon,
    msgId: decision.msgId || undefined,
    groupId: data.groupId,
    giftType: data.giftType ?? data.extendedGiftInfo?.giftType,
    repeatEnd: decision.repeatEnd,
    countMode: 'delta',
    streak: Math.max(1, Math.round(decision.creditDelta / decision.unitDiamonds)),
    creditedCoins: decision.creditDelta,
    source: 'gift',
    autoFakeGift: auctionState.config.autoFakeGift === true,
    hideCard: auctionState.config.fakeUserGiftShowUser === false
  }, handlers || { emit: emitLocalGiftEffect, forward: forwardGiftEffectToAnbeo });
}

// â”€â”€ ANBEO BIDIRECTIONAL CONTROL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Normalize a gift name for exact-match lookup: lowercase, collapse whitespace,
// strip leading/trailing whitespace. The player-picker on the ANBEO side sends
// the exact display name; the server rebuilds icon/price authoritatively from
// TIKTOK_GIFTS so a manipulated payload can't spoof value.
function normalizeGiftLookupName(value) {
  if (value == null) return '';
  return String(value).trim().replace(/\s+/g, ' ').toLowerCase();
}

const ANBEO_GIFT_LOOKUP = (() => {
  const byName = new Map();
  for (const gift of TIKTOK_GIFTS || []) {
    const name = String(gift && gift.n || '').trim();
    const coins = Number(gift && gift.c);
    const iconUrl = String(gift && gift.i || '').trim();
    if (!name || !Number.isInteger(coins) || coins <= 0) continue;
    // Match the ANBEO_GIFT_BUCKETS filter: only remote TikTok CDN icons, and
    // exclude the local fake-gift stubs (ids 90001..90003).
    if (!/^https:\/\/p16-webcast\.tiktokcdn\.com\//i.test(iconUrl)) continue;
    if (Number(gift.id) >= 90001 && Number(gift.id) <= 90003) continue;
    const key = normalizeGiftLookupName(name);
    if (!key) continue;
    // A given normalized name maps to a single canonical (name, price, icon).
    // If the catalog has more than one entry for a name (rare edge case), the
    // first wins; every subsequent duplicate is ignored so validation stays
    // deterministic.
    if (!byName.has(key)) {
      byName.set(key, Object.freeze({ giftName: name, coinCost: coins, iconUrl }));
    }
  }
  return byName;
})();

function findAnbeoControlGift(name, expectedPrice) {
  const key = normalizeGiftLookupName(name);
  if (!key) return null;
  const gift = ANBEO_GIFT_LOOKUP.get(key);
  if (!gift) return null;
  if (expectedPrice != null) {
    const price = Number(expectedPrice);
    // Fail closed if the ANBEO-provided price doesn't match the catalog. This
    // prevents a spoofed control packet from crediting the target user for
    // more coins than the picked gift actually costs.
    if (!Number.isFinite(price) || price !== gift.coinCost) return null;
  }
  return gift;
}

function buildAnbeoGiftManifest() {
  return Array.from(ANBEO_GIFT_LOOKUP.values())
    .map((gift) => ({
      giftName: gift.giftName,
      coinCost: gift.coinCost,
      iconUrl: gift.iconUrl
    }))
    .sort((a, b) => a.coinCost - b.coinCost || a.giftName.localeCompare(b.giftName));
}

// Sanitized bidder snapshot the ANBEO player-picker consumes. Public shape only
// (canonical id, display name, current coin total, avatar) â€” internal fields
// like lastBidTime or map keys are omitted.
function buildAnbeoBidderSnapshot() {
  const bidders = Object.values(auctionState.bidders || {})
    .sort((a, b) => (Number(b.coins) || 0) - (Number(a.coins) || 0))
    .map((bidder) => ({
      playerId: canonicalPlayerId(bidder.uniqueId),
      username: String(bidder.nickname || bidder.uniqueId || ''),
      avatarUrl: String(bidder.profilePictureUrl || ''),
      coins: Number(bidder.coins) || 0
    }));
  return {
    status: String(auctionState.status || 'idle'),
    timeRemaining: Number(auctionState.timeRemaining) || 0,
    gifts: buildAnbeoGiftManifest(),
    bidders
  };
}

function publishAnbeoState() {
  if (!sanitizeAnbeoConfig(appConfig.anbeoAnimation).enabled) return false;
  try {
    return anbeoAnimationClient.sendEvent('bettertok-state', buildAnbeoBidderSnapshot());
  } catch (e) {
    logToFile(`ANBEO_STATE_ERROR ${String(e && e.message || 'unknown')}`);
    return false;
  }
}

// Bounded, TTL-based dedup for ANBEO-issued credit requests. Duplicate request
// IDs (e.g. an ANBEO client retry after a socket blip) must not credit the
// selected player twice.
const ANBEO_REQUEST_DEDUP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const ANBEO_REQUEST_DEDUP_CAP = 500;
const anbeoProcessedRequests = new Map(); // requestId -> expiresAt

function pruneAnbeoRequestDedup(now) {
  const cutoff = now || Date.now();
  // Prune expired entries first.
  for (const [id, expiresAt] of anbeoProcessedRequests) {
    if (expiresAt <= cutoff) anbeoProcessedRequests.delete(id);
  }
  // Cap size â€” drop oldest inserted entries (Map iteration order = insertion).
  while (anbeoProcessedRequests.size > ANBEO_REQUEST_DEDUP_CAP) {
    const oldest = anbeoProcessedRequests.keys().next().value;
    if (oldest === undefined) break;
    anbeoProcessedRequests.delete(oldest);
  }
}

function claimAnbeoRequestId(requestId) {
  if (typeof requestId !== 'string') return false;
  const trimmed = requestId.trim();
  if (!trimmed || trimmed.length > 128) return false;
  const now = Date.now();
  pruneAnbeoRequestDedup(now);
  if (anbeoProcessedRequests.has(trimmed)) return false;
  anbeoProcessedRequests.set(trimmed, now + ANBEO_REQUEST_DEDUP_TTL_MS);
  return true;
}

function __resetAnbeoRequestDedup() {
  anbeoProcessedRequests.clear();
}

// Extract the sanitized fields we accept from ANBEO. Returns { ok, ... } on
// success or { ok: false, code, message } on any validation failure. Pure
// function â€” safe to unit-test.
function validateAnbeoCreditGiftPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, code: 'invalid_payload', message: 'Payload must be an object.' };
  }
  const requestId = typeof payload.requestId === 'string' ? payload.requestId.trim() : '';
  if (!requestId) return { ok: false, code: 'missing_request_id', message: 'requestId is required.' };
  if (requestId.length > 128) return { ok: false, code: 'invalid_request_id', message: 'requestId too long.' };

  const playerId = canonicalPlayerId(payload.playerId || payload.uniqueId || payload.username);
  if (!playerId) return { ok: false, code: 'missing_player_id', message: 'playerId is required.', requestId };

  const giftNameRaw = payload.giftName;
  if (typeof giftNameRaw !== 'string' || !giftNameRaw.trim()) {
    return { ok: false, code: 'missing_gift_name', message: 'giftName is required.', requestId };
  }

  // The ANBEO side always sends the price so we can cross-check its selection
  // against the authoritative catalog. Fail closed if it's absent, non-integer,
  // or non-positive.
  const priceRaw = payload.price != null ? payload.price : payload.coinCost;
  const price = Number(priceRaw);
  if (!Number.isFinite(price) || !Number.isInteger(price) || price <= 30) {
    return { ok: false, code: 'invalid_price', message: 'Gift effects require a price of at least 31 coins.', requestId, playerId };
  }

  const gift = findAnbeoControlGift(giftNameRaw);
  if (!gift) {
    return { ok: false, code: 'gift_not_found', message: 'Gift is not available in BetterTok.', requestId, playerId };
  }
  if (price !== gift.coinCost) {
    return {
      ok: false,
      code: 'price_mismatch',
      message: `Gift price changed to ${gift.coinCost} coins. Refresh ANBEO and try again.`,
      requestId,
      playerId
    };
  }

  return {
    ok: true,
    requestId,
    playerId,
    // Authoritative fields rebuilt from TIKTOK_GIFTS â€” never trust the icon/name
    // shape sent by the peer.
    giftName: gift.giftName,
    iconUrl: gift.iconUrl,
    coinCost: gift.coinCost,
    streak: Math.max(1, parseInt(payload.streak, 10) || 1),
    hideCard: payload.hideCard === true
  };
}

// Deliver an ANBEO command result back over the bridge. Never throws â€” all
// transport failures are logged and dropped so the credit path is unaffected.
function replyAnbeoCreditGift(requestId, result) {
  if (!requestId) return false;
  try {
    return anbeoAnimationClient.sendEvent('anbeo-credit-gift-result', {
      requestId,
      ...result
    });
  } catch (e) {
    logToFile(`ANBEO_REPLY_ERROR ${String(e && e.message || e)}`);
    return false;
  }
}

// Handle an inbound ANBEO command that asks BetterTok to credit the EXACT
// gift chosen by the player-picker for a specific bidder. Validates the
// payload, dedupes the request id, credits through processBid with the
// dedicated `anbeo_control` source (skips the random-bucket routing), then
// forwards the SELECTED gift once to the ANBEO overlay. Returns the result
// object for testability.
function handleAnbeoCreditGiftCommand(payload) {
  const validation = validateAnbeoCreditGiftPayload(payload);
  if (!validation.ok) {
    logToFile(`ANBEO_CREDIT_GIFT_REJECTED ${JSON.stringify({ code: validation.code, requestId: validation.requestId })}`);
    replyAnbeoCreditGift(validation.requestId, { ok: false, code: validation.code, message: validation.message });
    return { ok: false, code: validation.code };
  }
  const { requestId, playerId, giftName, iconUrl, coinCost, streak, hideCard } = validation;

  if (auctionState.status !== 'running') {
    logToFile(`ANBEO_CREDIT_GIFT_REJECTED ${JSON.stringify({ code: 'auction_not_running', requestId })}`);
    replyAnbeoCreditGift(requestId, { ok: false, code: 'auction_not_running', message: 'Auction is not running.' });
    return { ok: false, code: 'auction_not_running' };
  }

  // Existing-player-only: ANBEO cannot invent bidders. The player-picker only
  // shows current bidders, so any missing id here is a bug or a stale UI.
  const bidder = auctionState.bidders && auctionState.bidders[playerId];
  if (!bidder) {
    logToFile(`ANBEO_CREDIT_GIFT_REJECTED ${JSON.stringify({ code: 'unknown_player', playerId, requestId })}`);
    replyAnbeoCreditGift(requestId, { ok: false, code: 'unknown_player', message: 'Player is not in the current auction.' });
    return { ok: false, code: 'unknown_player' };
  }

  if (!claimAnbeoRequestId(requestId)) {
    logToFile(`ANBEO_CREDIT_GIFT_DUPLICATE ${JSON.stringify({ requestId, playerId })}`);
    replyAnbeoCreditGift(requestId, { ok: false, code: 'duplicate_request', message: 'requestId already processed.' });
    return { ok: false, code: 'duplicate_request' };
  }

  logToFile(`ANBEO_CREDIT_GIFT_ACCEPTED ${JSON.stringify({ requestId, playerId, giftName, coinCost })}`);

  const nickname = bidder.nickname || playerId;
  const profilePictureUrl = bidder.profilePictureUrl || '';

  // Credit the coins on the auction ledger. Source `anbeo_control` short-circuits
  // dispatchCoinEffect (via getCoinEffectRoute) so no local overlay and no random
  // ANBEO forward are triggered here.
  const credit = processBid(playerId, nickname, profilePictureUrl, coinCost, 'anbeo_control');
  if (!credit) {
    replyAnbeoCreditGift(requestId, { ok: false, code: 'credit_failed', message: 'processBid rejected the credit.' });
    return { ok: false, code: 'credit_failed' };
  }

  // Forward the EXACT selected gift back to the ANBEO overlay so its animation
  // matches the picker's choice (no random replacement). Uses buildEffectEnvelope
  // to keep the effectId / dedup semantics identical to the natural gift path.
  const effect = buildEffectEnvelope({
    playerId,
    nickname,
    profilePictureUrl,
    giftName,
    giftIcon: iconUrl,
    count: coinCost,
    streak,
    creditedCoins: credit.creditedCoins,
    source: 'anbeo_control',
    hideCard
  });
  forwardGiftEffectToAnbeo(effect);
  forwardGiftToLog(effect);
  publishAnbeoState();

  replyAnbeoCreditGift(requestId, {
    ok: true,
    playerId,
    giftName,
    creditedCoins: credit.creditedCoins,
    totalCoins: credit.totalCoins,
    effectId: effect.effectId
  });
  return { ok: true, effectId: effect.effectId, playerId, giftName, creditedCoins: credit.creditedCoins };
}

// â”€â”€ GIFT LOG BRIDGE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const GIFT_LOG_HOST = "127.0.0.1";
const GIFT_LOG_PORT = 1136;
const GIFT_LOG_TIMEOUT_MS = 750;
const giftLogAgent = new http.Agent({ keepAlive: true, maxSockets: 4 });
let giftLogConnected = false;
let giftLogEffectSequence = 0;

function emitGiftLogState(target) {
  const payload = { connected: giftLogConnected, host: GIFT_LOG_HOST, port: GIFT_LOG_PORT };
  (target || io).emit("giftlog-status", payload);
}

function generateGiftEffectId(payload) {
  giftLogEffectSequence += 1;
  return `anbeo-gift-${Date.now()}-${giftLogEffectSequence}-${Math.random().toString(36).slice(2, 8)}`;
}

function forwardGiftToLog(payload) {
  const body = JSON.stringify({
    ...payload,
    source: payload.source || "anbeo",
    stampedAt: Date.now(),
  });
  logToFile(`GIFTLG_POST ${JSON.stringify({ effectId: payload && payload.effectId, playerId: payload && payload.playerId, giftName: payload && payload.giftName, creditedCoins: payload && payload.creditedCoins })}`);
  const request = http.request(
    {
      hostname: GIFT_LOG_HOST,
      port: GIFT_LOG_PORT,
      path: "/api/gift",
      method: "POST",
      agent: giftLogAgent,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
      timeout: GIFT_LOG_TIMEOUT_MS,
    },
    (res) => { res.on("error", () => {}); res.resume(); }
  );
  request.on("error", (e) => { logToFile(`GIFTLG_ERR ${e && e.message || 'unknown'}`); });
  request.on("timeout", () => request.destroy());
  request.end(body);
}

// When the ANBEO bridge (re)connects, immediately push the current bidder
// snapshot so the player-picker paints without waiting for the next
// state_update tick. Wired here (after every helper is defined) to avoid
// use-before-define at module load time.
anbeoAnimationClient.on('ready', (isReady) => {
  if (!isReady) return;
  logToFile('ANBEO_BRIDGE_READY');
  publishAnbeoState();
});

anbeoAnimationClient.on('anbeo-credit-gift', (payload) => {
  try {
    handleAnbeoCreditGiftCommand(payload);
  } catch (e) {
    logToFile(`ANBEO_CREDIT_GIFT_ERROR ${String(e && e.message || e)}`);
  }
});

// The persisted ANBEO setting is loaded before this module reaches the bridge
// handlers. Connect immediately on startup instead of waiting for the operator
// to toggle the setting or for the first outbound gift.
ensureAnbeoConnected();

// Persistent device bindings: { "KEY_UPPER": "device_id" }
let deviceBindings = {};

// Multi-device cache populated from Google Sheet: { "KEY_UPPER": { max: Number, devices: [String] } }
// When present for a key, this takes precedence over the single-device deviceBindings.
let deviceListByKey = {};

function parseMaxDevices(v) {
  const n = parseInt(v, 10);
  if (isNaN(n) || n <= 0) return 1;
  return n;
}

function loadDeviceBindings() {
  try {
    if (fs.existsSync(DEVICES_FILE)) {
      const data = fs.readFileSync(DEVICES_FILE, 'utf8');
      deviceBindings = JSON.parse(data) || {};
      console.log(`[AUTH] Loaded ${Object.keys(deviceBindings).length} device bindings from file.`);
    } else {
      deviceBindings = {};
    }
  } catch (e) {
    console.error('Error loading device bindings:', e);
    deviceBindings = {};
  }
}

function saveDeviceBindings() {
  try {
    fs.writeFileSync(DEVICES_FILE, JSON.stringify(deviceBindings, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving device bindings:', e);
  }
}

// Sync device binding to Google Sheet (fire-and-forget)
// Reset all devices for a key: clears local caches and the Google Sheet device list
async function resetDevicesForKey(keyUpper) {
  delete deviceBindings[keyUpper];
  saveDeviceBindings();
  if (deviceListByKey[keyUpper]) deviceListByKey[keyUpper].devices = [];
  if (!googleSheetApiUrl) return;
  try {
    await fetch(googleSheetApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reset', key: keyUpper }),
      signal: AbortSignal.timeout(10000)
    });
    console.log(`[AUTH] Reset devices on Google Sheet for ${keyUpper}.`);
  } catch (e) {
    console.error(`[AUTH] Error resetting devices on Google Sheet: ${e.message}`);
  }
}
