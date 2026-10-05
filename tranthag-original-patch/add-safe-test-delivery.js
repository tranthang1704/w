'use strict';
const fs=require('fs');
const path=require('path');
const root=process.argv[2];
if(!root) throw new Error('Usage: node add-safe-test-delivery.js <app-dir>');
const serverPath=path.join(root,'server.js');
const dashPath=path.join(root,'public','dashboard.js');
const widgetPath=path.join(root,'public','widget.js');
let s=fs.readFileSync(serverPath,'utf8');
let d=fs.readFileSync(dashPath,'utf8');
let w=fs.readFileSync(widgetPath,'utf8');
function rep(text,from,to,label){ if(!text.includes(from)) throw new Error('Missing anchor: '+label); return text.replace(from,to); }

if(!s.includes('testDeliveryMode: false')){
  s=rep(s,"  autoDelivery: true,\n  awardApiUrl:","  autoDelivery: true,\n  testDeliveryMode: false,\n  testRobloxUsername: '',\n  testTikTokLabel: 'test_account',\n  awardApiUrl:",'test defaults');
}
if(!s.includes('x.testDeliveryMode = !!x.testDeliveryMode')){
  s=rep(s,"  x.autoDelivery = !!x.autoDelivery;\n  x.autoStatusComment = !!x.autoStatusComment;","  x.autoDelivery = !!x.autoDelivery;\n  x.testDeliveryMode = !!x.testDeliveryMode;\n  x.testRobloxUsername = String(x.testRobloxUsername || '').trim().slice(0, 32);\n  x.testTikTokLabel = String(x.testTikTokLabel || 'test_account').trim().replace(/^@/, '').slice(0, 40);\n  x.autoStatusComment = !!x.autoStatusComment;",'test sanitize');
}
if(!s.includes('let autoRoundHadQualifyingRealGift = false')){
  s=rep(s,"let autoCurrentRoundId = '';","let autoCurrentRoundId = '';\nlet autoRoundHadQualifyingRealGift = false;",'test round state');
}
if(!s.includes('auctionState.config.testDeliveryMode')){
  s=rep(s,"  auctionState.config.autoTieTarget = '';","  auctionState.config.autoTieTarget = '';\n  auctionState.config.testDeliveryMode = !!autoAuctionSettings.testDeliveryMode;",'test state flag');
}
if(!s.includes('async function autoRunSafeTestDelivery')){
  const anchor="async function autoHandleFinishedRound(winner) {";
  const fn=[
    "async function autoRunSafeTestDelivery() {",
    "  if (!autoAuctionSettings.testDeliveryMode) return false;",
    "  if (!autoAuctionSettings.testRobloxUsername) { autoEmitStatus('test_waiting', 'Set TEST Roblox username first'); return false; }",
    "  if (!autoAuctionSettings.awardApiUrl) { autoEmitStatus('test_error', 'Award API URL is empty'); return false; }",
    "  const awardId = 'test-' + autoEnsureRoundId() + '-' + autoAuctionSettings.testRobloxUsername.toLowerCase() + '-' + autoAuctionSettings.itemId;",
    "  if (autoAwardHistory.has(awardId)) { autoEmitStatus('test_queued', 'Already queued: ' + awardId); return true; }",
    "  const payload = { mode:'award', awardId:awardId, username:autoAuctionSettings.testRobloxUsername, itemId:autoAuctionSettings.itemId, itemName:autoAuctionSettings.itemName, winningCoins:0, coinReward:autoAuctionSettings.coinReward };",
    "  try {",
    "    const res = await fetch(autoAuctionSettings.awardApiUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({json:payload})});",
    "    const body = await res.text();",
    "    if(!res.ok) throw new Error('HTTP '+res.status+': '+body.slice(0,300));",
    "    autoAwardHistory.add(awardId);",
    "    autoSaveJson(AUTO_AWARD_HISTORY_FILE,Array.from(autoAwardHistory).slice(-5000));",
    "    autoEmitStatus('test_queued','[TEST] '+autoAuctionSettings.testRobloxUsername+' <- '+autoAuctionSettings.itemName);",
    "    io.emit('auto_auction_test_delivery',{roblox:autoAuctionSettings.testRobloxUsername,tiktok:autoAuctionSettings.testTikTokLabel,item:autoAuctionSettings.itemName,awardId:awardId});",
    "    return true;",
    "  } catch(e) { autoEmitStatus('test_error',String(e&&e.message||e)); return false; }",
    "}",
    ""
  ].join('\n');
  s=rep(s,anchor,fn+anchor,'test delivery function');
}
if(!s.includes("autoRoundHadQualifyingRealGift = false;\n  resetAuction();")){
  s=rep(s,"  autoCurrentRoundId = autoNewRoundId();\n  resetAuction();","  autoCurrentRoundId = autoNewRoundId();\n  autoRoundHadQualifyingRealGift = false;\n  resetAuction();",'reset test qualification');
}
if(!s.includes('autoRoundHadQualifyingRealGift = true')){
  s=rep(s,"  if (delta < autoAuctionSettings.highGiftThreshold) return;","  if (delta < autoAuctionSettings.highGiftThreshold) return;\n  autoRoundHadQualifyingRealGift = true;",'qualifying real gift marker');
}
if(!s.includes("if (autoAuctionSettings.testDeliveryMode && !autoRoundHadQualifyingRealGift)")){
  s=rep(s,"  if (winner) await autoDeliverWinner(winner);","  if (autoAuctionSettings.testDeliveryMode && !autoRoundHadQualifyingRealGift) {\n    await autoRunSafeTestDelivery();\n  } else if (winner) {\n    await autoDeliverWinner(winner);\n  }",'test fallback delivery');
}

if(!d.includes('ttaTestMode')){
  d=rep(d,"'<label><input id=\"ttaAutoDelivery\" type=\"checkbox\"> Auto Roblox delivery</label>'+","'<label><input id=\"ttaAutoDelivery\" type=\"checkbox\"> Auto Roblox delivery</label>'+\n      '<label><input id=\"ttaTestMode\" type=\"checkbox\"> TEST DELIVERY MODE</label>'+",'test toggle ui');
  d=rep(d,"'<label style=\"display:block;margin-top:8px\">Factual delivery status comment<input id=\"ttaDefaultMessage\" placeholder=\"@{winner} received {item}, tysm\"></label>'+","'<div style=\"display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px\"><label>TEST TikTok label<input id=\"ttaTestTikTok\" placeholder=\"test_account\"></label><label>TEST Roblox username<input id=\"ttaTestRoblox\" placeholder=\"your_test_account\"></label></div>'+\n      '<div style=\"font-size:11px;color:#fbbf24;margin-top:5px\">TEST MODE never changes real bidder totals. If no real gift reaches the threshold, it only triggers a clearly-marked test Roblox delivery.</div>'+\n      '<label style=\"display:block;margin-top:8px\">Factual delivery status comment<input id=\"ttaDefaultMessage\" placeholder=\"@{winner} received {item}, tysm\"></label>'+",'test fields ui');
  d=rep(d,"        autoDelivery: document.getElementById('ttaAutoDelivery').checked,\n        autoStatusComment:","        autoDelivery: document.getElementById('ttaAutoDelivery').checked,\n        testDeliveryMode: document.getElementById('ttaTestMode').checked,\n        testTikTokLabel: document.getElementById('ttaTestTikTok').value,\n        testRobloxUsername: document.getElementById('ttaTestRoblox').value,\n        autoStatusComment:",'test save ui');
  d=rep(d,"    set('ttaAwardUrl',autoCfg.awardApiUrl); set('ttaDefaultMessage',autoCfg.deliveryMessage);","    set('ttaAwardUrl',autoCfg.awardApiUrl); set('ttaDefaultMessage',autoCfg.deliveryMessage);\n    set('ttaTestTikTok',autoCfg.testTikTokLabel); set('ttaTestRoblox',autoCfg.testRobloxUsername);",'test paint fields');
  d=rep(d,"    document.getElementById('ttaAutoDelivery').checked = !!autoCfg.autoDelivery;","    document.getElementById('ttaAutoDelivery').checked = !!autoCfg.autoDelivery;\n    document.getElementById('ttaTestMode').checked = !!autoCfg.testDeliveryMode;",'test paint toggle');
}

if(!w.includes('TRANTHAG_TEST_MODE_BANNER_V1')){
  w += [
    '',
    '// TRANTHAG_TEST_MODE_BANNER_V1',
    "(() => {",
    "  function syncTestBanner(state){",
    "    const enabled=!!(state&&state.config&&state.config.testDeliveryMode);",
    "    let el=document.getElementById('tranthagTestModeBanner');",
    "    if(!enabled){ if(el) el.remove(); return; }",
    "    if(!el){ el=document.createElement('div'); el.id='tranthagTestModeBanner'; el.style.cssText='position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:200000;padding:8px 14px;border-radius:999px;background:#7c2d12;color:#fff;font:900 12px Arial,sans-serif;letter-spacing:.08em;border:1px solid #fb923c;box-shadow:0 8px 24px rgba(0,0,0,.35);pointer-events:none'; el.textContent='TEST MODE — NOT A REAL AUCTION RESULT'; document.body.appendChild(el); }",
    "  }",
    "  if(typeof socket!=='undefined') socket.on('state_update',syncTestBanner);",
    "})();"
  ].join('\n');
}

fs.writeFileSync(serverPath,s,'utf8');
fs.writeFileSync(dashPath,d,'utf8');
fs.writeFileSync(widgetPath,w,'utf8');
console.log('Safe TEST DELIVERY MODE added.');