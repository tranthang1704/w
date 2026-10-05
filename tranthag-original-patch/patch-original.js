'use strict';
const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) throw new Error('Usage: node patch-original.js <extracted-app-dir>');
const serverPath = path.join(root, 'server.js');
const dashPath = path.join(root, 'public', 'dashboard.js');
if (!fs.existsSync(serverPath) || !fs.existsSync(dashPath)) throw new Error('Original app source not found after ASAR extraction');

let s = fs.readFileSync(serverPath, 'utf8');
const originalServer = s;

function once(needle, replacement, label) {
  if (!s.includes(needle)) throw new Error('Patch anchor missing: ' + label);
  s = s.replace(needle, replacement);
}
function all(needle, replacement, label) {
  const before = s.split(needle).length - 1;
  if (!before) throw new Error('Patch anchor missing: ' + label);
  s = s.split(needle).join(replacement);
  console.log(label + ': ' + before + ' replacements');
}

// Keep the original app and all existing features; only adjust defaults used by new rounds.
s = s.replace('initialTime: 60,', 'initialTime: 50,');
s = s.replace("delay: 30,             //", "delay: 25,             //");

// Persisted automation config. This does not contain TikTok cookies or Roblox Open Cloud secrets.
const settingsBlock = String.raw`
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
function autoInt(v, min, max, fallback) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
function autoCleanTikTok(v) {
  return String(v || '').trim().replace(/^@/, '').toLowerCase();
}
function autoSanitizeSettings(raw) {
  const x = Object.assign({}, AUTO_AUCTION_DEFAULTS, raw || {});
  x.enabled = x.enabled !== false;
  x.mainSeconds = autoInt(x.mainSeconds, 5, 3600, 50);
  x.finalSeconds = autoInt(x.finalSeconds, 0, 600, 25);
  x.highGiftThreshold = autoInt(x.highGiftThreshold, 1, 100000000, 100);
  x.overtimeSeconds = autoInt(x.overtimeSeconds, 5, 600, 30);
  x.nextRoundDelay = autoInt(x.nextRoundDelay, 1, 300, 6);
  x.coinReward = autoInt(x.coinReward, 0, 1000000000, 100);
  x.autoNextRound = !!x.autoNextRound;
  x.autoDelivery = !!x.autoDelivery;
  x.autoStatusComment = !!x.autoStatusComment;
  x.awardApiUrl = String(x.awardApiUrl || '').trim().slice(0, 1000);
  x.itemId = String(x.itemId || '').trim().slice(0, 120);
  x.itemName = String(x.itemName || '').trim().slice(0, 160);
  x.deliveryMessage = String(x.deliveryMessage || '').slice(0, 280);
  x.winnerMappings = Array.isArray(x.winnerMappings) ? x.winnerMappings.slice(0, 50).map(m => ({
    tiktok: autoCleanTikTok(m && m.tiktok),
    roblox: String(m && m.roblox || '').trim().slice(0, 32),
    message: String(m && m.message || '').slice(0, 280)
  })).filter(m => m.tiktok && m.roblox) : [];
  return x;
}
function autoLoadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}
function autoSaveJson(file, value) {
  try { fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8'); } catch (e) { logToFile('AUTO save error: ' + (e && e.message)); }
}
let autoAuctionSettings = autoSanitizeSettings(autoLoadJson(AUTO_AUCTION_SETTINGS_FILE, AUTO_AUCTION_DEFAULTS));
let autoAwardHistory = new Set(autoLoadJson(AUTO_AWARD_HISTORY_FILE, []));
let autoNextRoundTimer = null;
let autoCurrentRoundId = '';
function autoNewRoundId() { return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10); }
function autoEnsureRoundId() { if (!autoCurrentRoundId) autoCurrentRoundId = autoNewRoundId(); return autoCurrentRoundId; }
function autoPublicSettings() {
  return JSON.parse(JSON.stringify(autoAuctionSettings));
}
function autoApplyAuctionTiming() {
  if (!autoAuctionSettings.enabled || !auctionState || !auctionState.config) return;
  auctionState.config.initialTime = autoAuctionSettings.mainSeconds;
  auctionState.config.delay = autoAuctionSettings.finalSeconds;
  // The original Auto-Tie changes bidder totals. Automated mode intentionally
  // disables it so standings remain based on real TikTok gifts.
  auctionState.config.autoTieEnabled = false;
  auctionState.config.autoTieTarget = '';
}
function autoWinnerMapping(uniqueId) {
  const id = autoCleanTikTok(uniqueId);
  return autoAuctionSettings.winnerMappings.find(m => autoCleanTikTok(m.tiktok) === id) || null;
}
function autoTemplate(template, winner, mapping) {
  return String(template || '')
    .replaceAll('{winner}', String(winner && winner.uniqueId || ''))
    .replaceAll('{roblox}', String(mapping && mapping.roblox || ''))
    .replaceAll('{item}', String(autoAuctionSettings.itemName || autoAuctionSettings.itemId || ''))
    .replaceAll('{coins}', String(winner && winner.coins || 0));
}
function autoEmitStatus(status, detail) {
  if (io) io.emit('auto_auction_delivery_status', { status, detail: String(detail || '') });
}
async function autoDeliverWinner(winner) {
  const mapping = autoWinnerMapping(winner.uniqueId);
  if (!mapping) {
    autoEmitStatus('waiting_mapping', 'No Roblox mapping for @' + winner.uniqueId);
    return false;
  }
  if (!autoAuctionSettings.autoDelivery) {
    autoEmitStatus('delivery_off', 'Auto Roblox delivery is disabled');
    return false;
  }
  if (!autoAuctionSettings.awardApiUrl) {
    autoEmitStatus('error', 'Award API URL is empty');
    return false;
  }
  const awardId = 'auction-' + autoEnsureRoundId() + '-' + autoCleanTikTok(winner.uniqueId) + '-' + autoAuctionSettings.itemId;
  if (autoAwardHistory.has(awardId)) {
    autoEmitStatus('delivered', 'Already delivered: ' + awardId);
    return true;
  }
  const payload = {
    mode: 'award',
    awardId,
    username: mapping.roblox,
    itemId: autoAuctionSettings.itemId,
    itemName: autoAuctionSettings.itemName,
    winningCoins: Math.max(0, Math.floor(Number(winner.coins) || 0)),
    coinReward: autoAuctionSettings.coinReward
  };
  autoEmitStatus('sending', mapping.roblox + ' ← ' + autoAuctionSettings.itemName);
  try {
    const res = await fetch(autoAuctionSettings.awardApiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json: payload })
    });
    const body = await res.text();
    if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + body.slice(0, 300));
    autoAwardHistory.add(awardId);
    autoSaveJson(AUTO_AWARD_HISTORY_FILE, Array.from(autoAwardHistory).slice(-5000));
    autoEmitStatus('delivered', mapping.roblox + ' received ' + autoAuctionSettings.itemName);
    if (autoAuctionSettings.autoStatusComment) {
      const message = autoTemplate(mapping.message || autoAuctionSettings.deliveryMessage, winner, mapping).trim();
      if (message && tiktokConnection && typeof tiktokConnection.sendMessage === 'function') {
        try {
          await tiktokConnection.sendMessage(message);
          autoEmitStatus('comment_sent', message);
        } catch (e) {
          autoEmitStatus('comment_pending', message);
        }
      }
    }
    return true;
  } catch (e) {
    autoEmitStatus('error', String(e && e.message || e));
    return false;
  }
}
function autoStartFreshRound() {
  if (!autoAuctionSettings.enabled) return;
  autoCurrentRoundId = autoNewRoundId();
  resetAuction();
  autoApplyAuctionTiming();
  auctionState.timeRemaining = auctionState.config.initialTime;
  auctionState.hasAppliedFinalDelay = false;
  auctionState.vouchAvailable = false;
  auctionState.bidders = {};
  activeFinishedWinner = null;
  finishedWinnerMessages = [];
  pendingGiftCoins = {};
  pendingGiftProfiles = {};
  lastRoundHadWinner = false;
  startTimer();
  io.emit('auto_auction_round_started', { timeRemaining: auctionState.timeRemaining });
}
async function autoHandleFinishedRound(winner) {
  if (!autoAuctionSettings.enabled) return;
  if (winner) await autoDeliverWinner(winner);
  if (autoAuctionSettings.autoNextRound) {
    if (autoNextRoundTimer) clearTimeout(autoNextRoundTimer);
    autoNextRoundTimer = setTimeout(autoStartFreshRound, autoAuctionSettings.nextRoundDelay * 1000);
  }
}
function autoHandleRealGift(decision) {
  if (!autoAuctionSettings.enabled || !decision) return;
  const delta = Math.max(0, Math.floor(Number(decision.creditDelta) || 0));
  if (auctionState.status !== 'running') return;
  if (!auctionState.hasAppliedFinalDelay) return;
  if (delta < autoAuctionSettings.highGiftThreshold) return;
  auctionState.timeRemaining = autoAuctionSettings.overtimeSeconds;
  io.emit('timer_extended', {
    newTime: auctionState.timeRemaining,
    reason: 'REAL gift >= ' + autoAuctionSettings.highGiftThreshold + ' → overtime reset ' + autoAuctionSettings.overtimeSeconds + 's'
  });
  io.emit('auto_auction_overtime', {
    uniqueId: decision.uniqueId,
    creditedCoins: delta,
    threshold: autoAuctionSettings.highGiftThreshold,
    newTime: auctionState.timeRemaining
  });
  broadcastState();
}
`;

const fileAnchor = "const RCKZ_SETTINGS_FILE = path.join(extRootDir, 'rckz_board_settings.json');";
once(fileAnchor, fileAnchor + '\n' + settingsBlock, 'automation settings block');

// Ensure automated mode never alters a bidder's total through the legacy synthetic Auto-Tie.
all(
  "if (auctionState.config.autoTieEnabled && auctionState.config.autoTieTarget) {",
  "if (!autoAuctionSettings.enabled && auctionState.config.autoTieEnabled && auctionState.config.autoTieTarget) {",
  'disable legacy synthetic auto-tie while automation is enabled'
);

// Every credited REAL TikTok gift >= threshold in final/overtime resets the clock.
const giftAnchor = "      processBid(decision.uniqueId, decision.nickname, decision.profilePictureUrl, decision.creditDelta, 'gift', { forwardSeparately: true });\n      forwardRealGiftToHybrid(data, decision);";
once(
  giftAnchor,
  "      processBid(decision.uniqueId, decision.nickname, decision.profilePictureUrl, decision.creditDelta, 'gift', { forwardSeparately: true });\n      autoHandleRealGift(decision);\n      forwardRealGiftToHybrid(data, decision);",
  'real gift overtime hook'
);

// Hand the genuine top bidder to Roblox delivery, then optionally start a new round.
once(
  "  // Find top bidder\n  const biddersArray = Object.values(auctionState.bidders).sort((a, b) => b.coins - a.coins);",
  "  // Find top bidder\n  let autoCompletedWinner = null;\n  const biddersArray = Object.values(auctionState.bidders).sort((a, b) => b.coins - a.coins);",
  'winner handoff variable'
);
once(
  "    activeFinishedWinner = {\n      ...winningRecord,\n      canonicalId: canonicalPlayerId(winningRecord.uniqueId)\n    };",
  "    activeFinishedWinner = {\n      ...winningRecord,\n      canonicalId: canonicalPlayerId(winningRecord.uniqueId)\n    };\n    autoCompletedWinner = { ...winningRecord };",
  'capture genuine winner'
);
once(
  "  broadcastState();\n}\n\n// Known TikTok gift prices",
  "  broadcastState();\n  if (autoAuctionSettings.enabled) {\n    setTimeout(() => autoHandleFinishedRound(autoCompletedWinner).catch(e => autoEmitStatus('error', e && e.message || e)), 0);\n  }\n}\n\n// Known TikTok gift prices",
  'winner delivery and next-round hook'
);

// Apply persisted 50/25 (or user-edited values) every time the host starts a new round.
once(
  "  socket.on('start_auction', () => {\n    // Bug 3:",
  "  socket.on('start_auction', () => {\n    autoApplyAuctionTiming();\n    if (auctionState.status === 'idle') auctionRoundGeneration++;\n    // Bug 3:",
  'start round timing hook'
);

// Treat config changes as dashboard control actions, never widget actions.
once(
  "'save_rckz_settings', 'reset_rckz_settings',",
  "'save_rckz_settings', 'reset_rckz_settings', 'auto_auction_save_config',",
  'socket permission gate'
);

// Add config read/write events next to the initial state push.
const stateAnchor = "  socket.emit('state_update', {\n    ...auctionState,\n    biddersList: biddersArray\n  });";
const socketBlock = String.raw`
  socket.emit('auto_auction_config', autoPublicSettings());
  socket.on('auto_auction_get_config', () => {
    socket.emit('auto_auction_config', autoPublicSettings());
  });
  socket.on('auto_auction_save_config', (incoming) => {
    autoAuctionSettings = autoSanitizeSettings(Object.assign({}, autoAuctionSettings, incoming || {}));
    autoSaveJson(AUTO_AUCTION_SETTINGS_FILE, autoAuctionSettings);
    autoApplyAuctionTiming();
    if (auctionState.status === 'idle') auctionState.timeRemaining = auctionState.config.initialTime;
    socket.emit('auto_auction_config', autoPublicSettings());
    io.emit('notification', { type: 'success', message: 'Auto Auction settings saved.' });
    broadcastState();
  });
`;
once(stateAnchor, stateAnchor + '\n' + socketBlock, 'dashboard automation socket handlers');

if (s === originalServer) throw new Error('No server changes applied');
fs.writeFileSync(serverPath, s, 'utf8');

// Append a panel rather than replacing the original dashboard: all old controls remain.
let d = fs.readFileSync(dashPath, 'utf8');
if (!d.includes('TRANTHAG_AUTO_AUCTION_PANEL_V1')) {
d += String.raw`

// TRANTHAG_AUTO_AUCTION_PANEL_V1
(() => {
  const AUTO_ID = 'tranthagAutoAuctionPanel';
  let autoCfg = null;
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function rows(maps) {
    return (maps || []).map((m, i) => '<div class="tta-map" data-i="'+i+'" style="display:grid;grid-template-columns:1fr 1fr 2fr auto;gap:6px;margin:6px 0">'+
      '<input class="tta-tiktok" placeholder="@TikTok" value="'+esc(m.tiktok)+'">'+
      '<input class="tta-roblox" placeholder="Roblox username" value="'+esc(m.roblox)+'">'+
      '<input class="tta-message" placeholder="received {item}, tysm" value="'+esc(m.message || '')+'">'+
      '<button type="button" class="btn-secondary tta-remove">×</button></div>').join('');
  }
  function mount() {
    if (document.getElementById(AUTO_ID)) return;
    const host = document.querySelector('.auction-widget-box') || document.querySelector('.app-shell') || document.body;
    const box = document.createElement('div');
    box.id = AUTO_ID;
    box.style.cssText = 'margin:14px 0;background:rgba(6,15,28,.95);border:1px solid #164e63;border-radius:10px;padding:14px;color:#e5eef8;';
    box.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px">'+
      '<div><b style="color:#22d3ee;font-size:16px">AUTO AUCTION + ROBLOX DELIVERY</b><div style="font-size:11px;color:#94a3b8;margin-top:3px">Uses real TikTok gifts. Existing app functions stay unchanged.</div></div>'+
      '<span id="ttaStatus" style="font-size:12px;color:#fbbf24">loading…</span></div>'+
      '<div style="display:grid;grid-template-columns:repeat(4,minmax(110px,1fr));gap:8px">'+
      '<label>Main (s)<input id="ttaMain" type="number"></label>'+
      '<label>Final (s)<input id="ttaFinal" type="number"></label>'+
      '<label>High gift ≥<input id="ttaThreshold" type="number"></label>'+
      '<label>Overtime reset (s)<input id="ttaOvertime" type="number"></label>'+
      '<label>Next round delay<input id="ttaNext" type="number"></label>'+
      '<label>Coin reward<input id="ttaReward" type="number"></label>'+
      '<label>Item ID<input id="ttaItemId"></label>'+
      '<label>Item name<input id="ttaItemName"></label></div>'+
      '<label style="display:block;margin-top:8px">Roblox award endpoint<input id="ttaAwardUrl"></label>'+
      '<div style="margin-top:12px;padding:10px;border:1px solid #155e75;border-radius:8px;background:rgba(8,47,73,.35)">'+
      '<div style="font-weight:800;color:#67e8f9;margin-bottom:6px">TIKTOK LIVE / BROWSER SOURCE</div>'+
      '<div style="font-size:11px;color:#94a3b8;margin-bottom:7px">Copy this authenticated link into TikTok LIVE Studio / OBS Browser Source. It stays synced with the auction inside this app.</div>'+
      '<div style="display:grid;grid-template-columns:1fr auto auto;gap:6px">'+
      '<input id="ttaWidgetUrl" readonly placeholder="Preparing widget link...">'+
      '<button type="button" id="ttaCopyWidget" class="btn-secondary">COPY LINK</button>'+
      '<button type="button" id="ttaPreviewWidget" class="btn-secondary">PREVIEW</button></div>'+
      '<div style="display:grid;grid-template-columns:1fr auto;gap:6px;margin-top:7px">'+
      '<select id="ttaTikTokAccount"><option value="">Select TikTok account...</option></select>'+
      '<button type="button" id="ttaConnectTikTok" class="btn-primary">CONNECT TIKTOK LIVE</button></div>'+
      '<div id="ttaTikTokState" style="font-size:11px;color:#94a3b8;margin-top:6px">TikTok: waiting...</div>'+
      '</div>'+
      '<label style="display:block;margin-top:8px">Factual delivery status comment<input id="ttaDefaultMessage" placeholder="@{winner} received {item}, tysm"></label>'+
      '<div style="display:flex;gap:14px;flex-wrap:wrap;margin:10px 0">'+
      '<label><input id="ttaEnabled" type="checkbox"> Automation enabled</label>'+
      '<label><input id="ttaAutoDelivery" type="checkbox"> Auto Roblox delivery</label>'+
      '<label><input id="ttaAutoComment" type="checkbox"> Auto delivery-status comment</label>'+
      '<label><input id="ttaAutoNext" type="checkbox"> Auto next round</label></div>'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px"><b>WINNER ACCOUNT → ROBLOX</b><button type="button" id="ttaAdd" class="btn-secondary">+ Add</button></div>'+
      '<div style="font-size:11px;color:#94a3b8;margin:4px 0">The genuine top bidder is used. Mapping lets delivery happen without asking the winner to retype their Roblox name.</div>'+
      '<div id="ttaMaps"></div>'+
      '<div style="font-size:11px;color:#64748b;margin:7px 0">Message variables: {winner}, {roblox}, {item}, {coins}</div>'+
      '<button type="button" id="ttaSave" class="btn-primary" style="width:100%;margin-top:6px">SAVE AUTO AUCTION</button>';
    host.parentNode ? host.parentNode.insertBefore(box, host.nextSibling) : document.body.appendChild(box);

    box.addEventListener('click', e => {
      if (e.target.classList.contains('tta-remove')) e.target.closest('.tta-map').remove();
    });
    document.getElementById('ttaAdd').onclick = () => {
      const root = document.getElementById('ttaMaps');
      const w = document.createElement('div');
      w.innerHTML = rows([{tiktok:'',roblox:'',message:''}]);
      root.appendChild(w.firstElementChild);
    };
    async function refreshTtaWidgetLink() {
      const input = document.getElementById('ttaWidgetUrl');
      if (!input) return;
      try {
        if (typeof loadWidgetAuth === 'function') await loadWidgetAuth();
        const url = typeof buildWidgetUrl === 'function' ? buildWidgetUrl('widget.html') : '';
        input.value = url || (window.location.origin + '/widget.html');
      } catch (_) {
        input.value = window.location.origin + '/widget.html';
      }
    }
    function refreshTtaAccounts(list) {
      const select = document.getElementById('ttaTikTokAccount');
      if (!select) return;
      const prev = select.value;
      const accounts = Array.isArray(list) ? list : [];
      select.innerHTML = '<option value="">Select TikTok account...</option>' + accounts.map(x => {
        const v = String(x || '').replace(/^@/, '');
        return '<option value="'+esc(v)+'">@'+esc(v)+'</option>';
      }).join('');
      if (accounts.includes(prev)) select.value = prev;
    }
    document.getElementById('ttaCopyWidget').onclick = async () => {
      await refreshTtaWidgetLink();
      const url = document.getElementById('ttaWidgetUrl').value;
      if (!url) return;
      try { await navigator.clipboard.writeText(url); } catch (_) {}
      const btn = document.getElementById('ttaCopyWidget');
      btn.textContent = 'COPIED';
      setTimeout(() => { btn.textContent = 'COPY LINK'; }, 1500);
    };
    document.getElementById('ttaPreviewWidget').onclick = async () => {
      await refreshTtaWidgetLink();
      const url = document.getElementById('ttaWidgetUrl').value;
      if (url) window.open(url, '_blank', 'width=500,height=850');
    };
    document.getElementById('ttaConnectTikTok').onclick = () => {
      const select = document.getElementById('ttaTikTokAccount');
      const username = String(select && select.value || '').trim();
      if (!username) {
        document.getElementById('ttaTikTokState').textContent = 'TikTok: choose an account first';
        return;
      }
      socket.emit('connect_tiktok', { username });
      document.getElementById('ttaTikTokState').textContent = 'TikTok: connecting @' + username + '...';
    };
    if (typeof socket !== 'undefined') {
      socket.emit('request_accounts_list');
    }
    refreshTtaWidgetLink();
    document.getElementById('ttaSave').onclick = () => {
      const mappings = [...document.querySelectorAll('#ttaMaps .tta-map')].map(r => ({
        tiktok: r.querySelector('.tta-tiktok').value,
        roblox: r.querySelector('.tta-roblox').value,
        message: r.querySelector('.tta-message').value
      })).filter(x => x.tiktok.trim() && x.roblox.trim());
      socket.emit('auto_auction_save_config', {
        enabled: document.getElementById('ttaEnabled').checked,
        mainSeconds: +document.getElementById('ttaMain').value,
        finalSeconds: +document.getElementById('ttaFinal').value,
        highGiftThreshold: +document.getElementById('ttaThreshold').value,
        overtimeSeconds: +document.getElementById('ttaOvertime').value,
        nextRoundDelay: +document.getElementById('ttaNext').value,
        coinReward: +document.getElementById('ttaReward').value,
        itemId: document.getElementById('ttaItemId').value,
        itemName: document.getElementById('ttaItemName').value,
        awardApiUrl: document.getElementById('ttaAwardUrl').value,
        deliveryMessage: document.getElementById('ttaDefaultMessage').value,
        autoDelivery: document.getElementById('ttaAutoDelivery').checked,
        autoStatusComment: document.getElementById('ttaAutoComment').checked,
        autoNextRound: document.getElementById('ttaAutoNext').checked,
        winnerMappings: mappings
      });
    };
    socket.emit('auto_auction_get_config');
  }
  function paint(c) {
    autoCfg = c || {};
    mount();
    const set = (id,v) => { const el=document.getElementById(id); if(el) el.value=v == null ? '' : v; };
    set('ttaMain',autoCfg.mainSeconds); set('ttaFinal',autoCfg.finalSeconds);
    set('ttaThreshold',autoCfg.highGiftThreshold); set('ttaOvertime',autoCfg.overtimeSeconds);
    set('ttaNext',autoCfg.nextRoundDelay); set('ttaReward',autoCfg.coinReward);
    set('ttaItemId',autoCfg.itemId); set('ttaItemName',autoCfg.itemName);
    set('ttaAwardUrl',autoCfg.awardApiUrl); set('ttaDefaultMessage',autoCfg.deliveryMessage);
    ['Enabled','AutoDelivery','AutoComment','AutoNext'].forEach(() => {});
    document.getElementById('ttaEnabled').checked = autoCfg.enabled !== false;
    document.getElementById('ttaAutoDelivery').checked = !!autoCfg.autoDelivery;
    document.getElementById('ttaAutoComment').checked = !!autoCfg.autoStatusComment;
    document.getElementById('ttaAutoNext').checked = !!autoCfg.autoNextRound;
    document.getElementById('ttaMaps').innerHTML = rows(autoCfg.winnerMappings || []);
    document.getElementById('ttaStatus').textContent = 'saved';
  }
  if (typeof socket !== 'undefined') {
    socket.on('auto_auction_config', paint);
    socket.on('auto_auction_overtime', x => {
      mount();
      document.getElementById('ttaStatus').textContent = '@'+x.uniqueId+' +'+x.creditedCoins+' → '+x.newTime+'s';
    });
    socket.on('auto_auction_delivery_status', x => {
      mount();
      document.getElementById('ttaStatus').textContent = x.status+': '+(x.detail || '');
    });
    socket.on('auto_auction_round_started', x => {
      mount();
      document.getElementById('ttaStatus').textContent = 'new round '+x.timeRemaining+'s';
    });
    socket.on('allowed_accounts_list', list => {
      mount();
      const select = document.getElementById('ttaTikTokAccount');
      if (select) {
        const prev = select.value;
        const accounts = Array.isArray(list) ? list : [];
        select.innerHTML = '<option value="">Select TikTok account...</option>' + accounts.map(x => {
          const v = String(x || '').replace(/^@/, '');
          return '<option value="'+esc(v)+'">@'+esc(v)+'</option>';
        }).join('');
        if (accounts.includes(prev)) select.value = prev;
      }
    });
    socket.on('state_update', state => {
      const el = document.getElementById('ttaTikTokState');
      if (!el || !state || !state.connection) return;
      const status = state.connection.status || 'disconnected';
      const user = state.connection.username ? ' @'+String(state.connection.username).replace(/^@/,'') : '';
      el.textContent = 'TikTok: ' + status + user;
    });
    socket.on('connect', () => {
      if (typeof loadWidgetAuth === 'function') {
        loadWidgetAuth().then(() => {
          const input = document.getElementById('ttaWidgetUrl');
          if (input && typeof buildWidgetUrl === 'function') input.value = buildWidgetUrl('widget.html') || (window.location.origin + '/widget.html');
        }).catch(() => {});
      }
      socket.emit('request_accounts_list');
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else setTimeout(mount, 0);
})();
`;
}
fs.writeFileSync(dashPath, d, 'utf8');

console.log('Patched original TranThag app without replacing its existing dashboard/features.');
