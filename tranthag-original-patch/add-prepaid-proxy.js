'use strict';
const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) throw new Error('Usage: node add-prepaid-proxy.js <extracted-app-dir>');
const serverPath = path.join(root, 'server.js');
const dashPath = path.join(root, 'public', 'dashboard.js');

let s = fs.readFileSync(serverPath, 'utf8');
let d = fs.readFileSync(dashPath, 'utf8');

function rep(text, from, to, label) {
  if (!text.includes(from)) throw new Error('Missing anchor: ' + label);
  return text.replace(from, to);
}

// Add transparent prepaid/proxy-bid accounts to the existing Auto Auction config.
s = rep(s,
"  deliveryMessage: '@{winner} received {item}, tysm',\n  winnerMappings: []\n};",
"  deliveryMessage: '@{winner} received {item}, tysm',\n  winnerMappings: [],\n  prepaidAccounts: []\n};",
'prepaid defaults');

s = rep(s,
"  x.winnerMappings = Array.isArray(x.winnerMappings) ? x.winnerMappings.slice(0, 50).map(m => ({\n    tiktok: autoCleanTikTok(m && m.tiktok),\n    roblox: String(m && m.roblox || '').trim().slice(0, 32),\n    message: String(m && m.message || '').slice(0, 280)\n  })).filter(m => m.tiktok && m.roblox) : [];\n  return x;",
"  x.winnerMappings = Array.isArray(x.winnerMappings) ? x.winnerMappings.slice(0, 50).map(m => ({\n    tiktok: autoCleanTikTok(m && m.tiktok),\n    roblox: String(m && m.roblox || '').trim().slice(0, 32),\n    message: String(m && m.message || '').slice(0, 280)\n  })).filter(m => m.tiktok && m.roblox) : [];\n  x.prepaidAccounts = Array.isArray(x.prepaidAccounts) ? x.prepaidAccounts.slice(0, 50).map((m, index) => ({\n    tiktok: autoCleanTikTok(m && m.tiktok),\n    nickname: String(m && m.nickname || '').trim().slice(0, 80),\n    enabled: m && m.enabled !== false,\n    mode: m && m.mode === 'ahead_by_one' ? 'ahead_by_one' : 'match_top',\n    prepaidBalance: autoInt(m && m.prepaidBalance, 0, 1000000000, 0),\n    maxAutoBid: autoInt(m && m.maxAutoBid, 0, 1000000000, 0),\n    priority: autoInt(m && m.priority, 1, 999, index + 1)\n  })).filter(m => m.tiktok) : [];\n  return x;",
'prepaid sanitize');

const oldHandle = "function autoHandleRealGift(decision) {\n  if (!autoAuctionSettings.enabled || !decision) return;\n  const delta = Math.max(0, Math.floor(Number(decision.creditDelta) || 0));\n  if (auctionState.status !== 'running') return;\n  if (!auctionState.hasAppliedFinalDelay) return;\n  if (delta < autoAuctionSettings.highGiftThreshold) return;\n  auctionState.timeRemaining = autoAuctionSettings.overtimeSeconds;\n  io.emit('timer_extended', {\n    newTime: auctionState.timeRemaining,\n    reason: 'REAL gift >= ' + autoAuctionSettings.highGiftThreshold + ' → overtime reset ' + autoAuctionSettings.overtimeSeconds + 's'\n  });\n  io.emit('auto_auction_overtime', {\n    uniqueId: decision.uniqueId,\n    creditedCoins: delta,\n    threshold: autoAuctionSettings.highGiftThreshold,\n    newTime: auctionState.timeRemaining\n  });\n  broadcastState();\n}";

const newHandle = "function autoFindBidder(uniqueId) {\n  const id = autoCleanTikTok(uniqueId);\n  return Object.values(auctionState.bidders || {}).find(b => autoCleanTikTok(b && b.uniqueId) === id) || null;\n}\nfunction autoTopOtherBidder(uniqueId) {\n  const id = autoCleanTikTok(uniqueId);\n  return Object.values(auctionState.bidders || {}).filter(b => autoCleanTikTok(b && b.uniqueId) !== id).sort((a,b) => (Number(b.coins)||0) - (Number(a.coins)||0))[0] || null;\n}\nfunction autoApplyPrepaidProxy(triggerDecision) {\n  if (!autoAuctionSettings.enabled || auctionState.status !== 'running' || !auctionState.hasAppliedFinalDelay) return;\n  const triggerCoins = Math.max(0, Math.floor(Number(triggerDecision && triggerDecision.creditDelta) || 0));\n  if (triggerCoins < autoAuctionSettings.highGiftThreshold) return;\n  const accounts = (autoAuctionSettings.prepaidAccounts || []).filter(a => a && a.enabled && a.tiktok && Number(a.prepaidBalance) > 0).sort((a,b) => (Number(a.priority)||999) - (Number(b.priority)||999));\n  for (const account of accounts) {\n    const current = Math.max(0, Math.floor(Number((autoFindBidder(account.tiktok) || {}).coins) || 0));\n    const leader = autoTopOtherBidder(account.tiktok);\n    const top = Math.max(0, Math.floor(Number(leader && leader.coins) || 0));\n    if (top <= 0) continue;\n    const target = account.mode === 'ahead_by_one' ? top + 1 : top;\n    if (target <= current) continue;\n    if (account.maxAutoBid > 0 && target > account.maxAutoBid) continue;\n    const spend = target - current;\n    if (spend > account.prepaidBalance) continue;\n    const result = processBid(account.tiktok, account.nickname || account.tiktok, DEFAULT_AVATAR_URL, spend, 'prepaid_proxy', { forwardSeparately: true });\n    if (!result) continue;\n    account.prepaidBalance = Math.max(0, account.prepaidBalance - spend);\n    autoSaveJson(AUTO_AUCTION_SETTINGS_FILE, autoAuctionSettings);\n    logToFile('PREPAID_PROXY ' + JSON.stringify({ account: account.tiktok, mode: account.mode, used: spend, total: target, remaining: account.prepaidBalance }));\n    io.emit('auto_auction_prepaid_bid', { tiktok: account.tiktok, mode: account.mode, used: spend, targetTotal: target, remaining: account.prepaidBalance });\n    io.emit('auto_auction_config', autoPublicSettings());\n    break;\n  }\n}\nfunction autoHandleRealGift(decision) {\n  if (!autoAuctionSettings.enabled || !decision) return;\n  const delta = Math.max(0, Math.floor(Number(decision.creditDelta) || 0));\n  if (auctionState.status !== 'running') return;\n  if (!auctionState.hasAppliedFinalDelay) return;\n  if (delta < autoAuctionSettings.highGiftThreshold) return;\n  auctionState.timeRemaining = autoAuctionSettings.overtimeSeconds;\n  io.emit('timer_extended', { newTime: auctionState.timeRemaining, reason: 'REAL gift threshold reached → overtime reset' });\n  io.emit('auto_auction_overtime', { uniqueId: decision.uniqueId, creditedCoins: delta, threshold: autoAuctionSettings.highGiftThreshold, newTime: auctionState.timeRemaining });\n  autoApplyPrepaidProxy(decision);\n  broadcastState();\n}";
s = rep(s, oldHandle, newHandle, 'prepaid server logic');

// Extend existing save handler so prepaidAccounts persist.
s = rep(s,
"        winnerMappings: mappings\n      });",
"        winnerMappings: mappings,\n        prepaidAccounts: [...document.querySelectorAll('#ttaPrepaid .tta-prepaid')].map((r, index) => ({\n          tiktok: r.querySelector('.tta-ptiktok').value,\n          nickname: r.querySelector('.tta-pnick').value,\n          prepaidBalance: +r.querySelector('.tta-pbalance').value,\n          maxAutoBid: +r.querySelector('.tta-pmax').value,\n          mode: r.querySelector('.tta-pmode').value,\n          priority: +r.querySelector('.tta-ppriority').value || index + 1,\n          enabled: r.querySelector('.tta-penabled').checked\n        })).filter(x => x.tiktok.trim())\n      });",
'prepaid save');

const saveButton = "      '<div style=\"font-size:11px;color:#64748b;margin:7px 0\">Message variables: {winner}, {roblox}, {item}, {coins}</div>'+\n      '<button type=\"button\" id=\"ttaSave\" class=\"btn-primary\" style=\"width:100%;margin-top:6px\">SAVE AUTO AUCTION</button>';";
const prepaidUi = "      '<div style=\"font-size:11px;color:#64748b;margin:7px 0\">Message variables: {winner}, {roblox}, {item}, {coins}</div>'+\n      '<div style=\"border-top:1px solid #164e63;margin:14px 0 8px;padding-top:10px\"><b>PREPAID / PROXY BID</b><div style=\"font-size:11px;color:#94a3b8\">Uses only recorded prepaid balance; every automatic increment is logged.</div></div>'+\n      '<div id=\"ttaPrepaid\"></div>'+\n      '<button type=\"button\" id=\"ttaAddPrepaid\" class=\"btn-secondary\" style=\"margin-bottom:8px\">+ Add prepaid account</button>'+\n      '<button type=\"button\" id=\"ttaSave\" class=\"btn-primary\" style=\"width:100%;margin-top:6px\">SAVE AUTO AUCTION</button>';";
d = rep(d, saveButton, prepaidUi, 'prepaid UI section');

const mountAnchor = "    document.getElementById('ttaAdd').onclick = () => {\n      const root = document.getElementById('ttaMaps');\n      const w = document.createElement('div');\n      w.innerHTML = rows([{tiktok:'',roblox:'',message:''}]);\n      root.appendChild(w.firstElementChild);\n    };";
const mountExtra = mountAnchor + "\n    document.getElementById('ttaAddPrepaid').onclick = () => {\n      const root = document.getElementById('ttaPrepaid');\n      const r = document.createElement('div');\n      r.className = 'tta-prepaid';\n      r.style.cssText = 'display:grid;grid-template-columns:1fr 1fr .8fr .8fr .8fr .6fr auto;gap:6px;margin:6px 0';\n      r.innerHTML = '<input class=\"tta-ptiktok\" placeholder=\"@TikTok\"><input class=\"tta-pnick\" placeholder=\"Nickname\"><input class=\"tta-pbalance\" type=\"number\" min=\"0\" placeholder=\"Prepaid\"><input class=\"tta-pmax\" type=\"number\" min=\"0\" placeholder=\"Max total\"><select class=\"tta-pmode\"><option value=\"match_top\">Match top</option><option value=\"ahead_by_one\">Ahead +1</option></select><input class=\"tta-ppriority\" type=\"number\" min=\"1\" value=\"1\"><label><input class=\"tta-penabled\" type=\"checkbox\" checked> On</label>';\n      root.appendChild(r);\n    };";
d = rep(d, mountAnchor, mountExtra, 'prepaid add button');

d = rep(d,
"    document.getElementById('ttaMaps').innerHTML = rows(autoCfg.winnerMappings || []);\n    document.getElementById('ttaStatus').textContent = 'saved';",
"    document.getElementById('ttaMaps').innerHTML = rows(autoCfg.winnerMappings || []);\n    const pRoot = document.getElementById('ttaPrepaid');\n    if (pRoot) {\n      pRoot.innerHTML = '';\n      (autoCfg.prepaidAccounts || []).forEach(a => {\n        const r = document.createElement('div');\n        r.className = 'tta-prepaid';\n        r.style.cssText = 'display:grid;grid-template-columns:1fr 1fr .8fr .8fr .8fr .6fr auto;gap:6px;margin:6px 0';\n        r.innerHTML = '<input class=\"tta-ptiktok\" value=\"'+esc(a.tiktok)+'\"><input class=\"tta-pnick\" value=\"'+esc(a.nickname||'')+'\"><input class=\"tta-pbalance\" type=\"number\" min=\"0\" value=\"'+esc(a.prepaidBalance||0)+'\"><input class=\"tta-pmax\" type=\"number\" min=\"0\" value=\"'+esc(a.maxAutoBid||0)+'\"><select class=\"tta-pmode\"><option value=\"match_top\"'+(a.mode==='match_top'?' selected':'')+'>Match top</option><option value=\"ahead_by_one\"'+(a.mode==='ahead_by_one'?' selected':'')+'>Ahead +1</option></select><input class=\"tta-ppriority\" type=\"number\" min=\"1\" value=\"'+esc(a.priority||1)+'\"><label><input class=\"tta-penabled\" type=\"checkbox\" '+(a.enabled===false?'':'checked')+'> On</label>';\n        pRoot.appendChild(r);\n      });\n    }\n    document.getElementById('ttaStatus').textContent = 'saved';",
'paint prepaid');

d = d.replace('TRANTHAG_AUTO_AUCTION_PANEL_V1','TRANTHAG_AUTO_AUCTION_PANEL_V2');

fs.writeFileSync(serverPath, s, 'utf8');
fs.writeFileSync(dashPath, d, 'utf8');
console.log('Added transparent prepaid/proxy bidding.');
