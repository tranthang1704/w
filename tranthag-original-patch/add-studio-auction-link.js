'use strict';
const fs=require('fs');
const path=require('path');
const root=process.argv[2];
if(!root) throw new Error('Usage: node add-studio-auction-link.js <app-dir>');
const serverPath=path.join(root,'server.js');
const dashPath=path.join(root,'public','dashboard.js');
let s=fs.readFileSync(serverPath,'utf8');
let d=fs.readFileSync(dashPath,'utf8');
function rep(text,from,to,label){ if(!text.includes(from)) throw new Error('Missing anchor: '+label); return text.replace(from,to); }

if(!s.includes('autoStartOnTikTokConnect: true')){
  s=rep(s,"  autoNextRound: true,\n  autoDelivery: true,","  autoNextRound: true,\n  autoStartOnTikTokConnect: true,\n  autoTieOnEqualTotals: true,\n  autoDelivery: true,",'auto defaults');
}
if(!s.includes('x.autoStartOnTikTokConnect = x.autoStartOnTikTokConnect !== false')){
  s=rep(s,"  x.autoNextRound = !!x.autoNextRound;\n  x.autoDelivery = !!x.autoDelivery;","  x.autoNextRound = !!x.autoNextRound;\n  x.autoStartOnTikTokConnect = x.autoStartOnTikTokConnect !== false;\n  x.autoTieOnEqualTotals = x.autoTieOnEqualTotals !== false;\n  x.autoDelivery = !!x.autoDelivery;",'auto sanitize');
}

if(!s.includes('AUTO genuine tie overtime')){
  const anchor="  auctionState.status = 'finished';\n  finishedWinnerMessages = [];\n\n  // Find top bidder";
  const block=[
    "  // AUTO genuine tie overtime: equal REAL totals only; never changes bidder balances.",
    "  if (autoAuctionSettings && autoAuctionSettings.enabled && autoAuctionSettings.autoTieOnEqualTotals) {",
    "    const tieRows = Object.values(auctionState.bidders).sort((a,b)=>b.coins-a.coins);",
    "    if (tieRows.length >= 2 && Number(tieRows[0].coins) > 0 && Number(tieRows[0].coins) === Number(tieRows[1].coins)) {",
    "      auctionState.status = 'running';",
    "      auctionState.hasAppliedFinalDelay = true;",
    "      auctionState.timeRemaining = autoAuctionSettings.overtimeSeconds;",
    "      io.emit('timer_extended', { newTime: auctionState.timeRemaining, reason: 'REAL TIE -> overtime reset ' + autoAuctionSettings.overtimeSeconds + 's' });",
    "      io.emit('auto_auction_real_tie', { coins: Number(tieRows[0].coins), users: tieRows.filter(x=>Number(x.coins)===Number(tieRows[0].coins)).map(x=>x.uniqueId), newTime: auctionState.timeRemaining });",
    "      broadcastState();",
    "      startTimer();",
    "      return;",
    "    }",
    "  }",
    "",
    "  auctionState.status = 'finished';",
    "  finishedWinnerMessages = [];",
    "",
    "  // Find top bidder"
  ].join('\n');
  s=rep(s,anchor,block,'genuine tie finish hook');
}

if(!s.includes("io.emit('auto_auction_live_connected'")){
  const anchor="    loadGiftCatalog(tiktokConnection);\n    broadcastState();";
  const block=[
    "    loadGiftCatalog(tiktokConnection);",
    "    broadcastState();",
    "    io.emit('auto_auction_live_connected', { username: cleanUsername, roomId: state.roomId || '', widgetUrl: 'http://localhost:3000/widget.html' });",
    "    if (autoAuctionSettings && autoAuctionSettings.enabled && autoAuctionSettings.autoStartOnTikTokConnect) {",
    "      if (autoNextRoundTimer) { clearTimeout(autoNextRoundTimer); autoNextRoundTimer = null; }",
    "      if (auctionState.status === 'idle' || auctionState.status === 'finished') {",
    "        setTimeout(() => {",
    "          if (auctionState.connection.status === 'connected' && (auctionState.status === 'idle' || auctionState.status === 'finished')) autoStartFreshRound();",
    "        }, 1200);",
    "      }",
    "    }"
  ].join('\n');
  s=rep(s,anchor,block,'auto start on live connect');
}

if(!d.includes('ttaAutoStartLive')){
  d=rep(d,"'<label><input id=\"ttaAutoNext\" type=\"checkbox\"> Auto next round</label></div>'+","'<label><input id=\"ttaAutoNext\" type=\"checkbox\"> Auto next round</label>'+\n      '<label><input id=\"ttaAutoStartLive\" type=\"checkbox\"> Auto start when TikTok LIVE connects</label>'+\n      '<label><input id=\"ttaRealTie\" type=\"checkbox\"> Real tie -> 30s overtime</label></div>'+",'dashboard switches');
  d=rep(d,"        autoNextRound: document.getElementById('ttaAutoNext').checked,\n        winnerMappings: mappings","        autoNextRound: document.getElementById('ttaAutoNext').checked,\n        autoStartOnTikTokConnect: document.getElementById('ttaAutoStartLive').checked,\n        autoTieOnEqualTotals: document.getElementById('ttaRealTie').checked,\n        winnerMappings: mappings",'dashboard save switches');
  d=rep(d,"    document.getElementById('ttaAutoNext').checked = !!autoCfg.autoNextRound;","    document.getElementById('ttaAutoNext').checked = !!autoCfg.autoNextRound;\n    document.getElementById('ttaAutoStartLive').checked = autoCfg.autoStartOnTikTokConnect !== false;\n    document.getElementById('ttaRealTie').checked = autoCfg.autoTieOnEqualTotals !== false;",'dashboard paint switches');
}

if(!d.includes("socket.on('auto_auction_live_connected'")){
  const anchor="    socket.on('auto_auction_round_started', x => {\n      mount();\n      document.getElementById('ttaStatus').textContent = 'new round '+x.timeRemaining+'s';\n    });";
  const block=[
    "    socket.on('auto_auction_round_started', x => {",
    "      mount();",
    "      document.getElementById('ttaStatus').textContent = 'new round '+x.timeRemaining+'s';",
    "    });",
    "    socket.on('auto_auction_live_connected', x => {",
    "      mount();",
    "      document.getElementById('ttaStatus').textContent = 'LIVE @'+(x.username||'')+' -> board active';",
    "      const input=document.getElementById('ttaWidgetUrl');",
    "      if(input && x.widgetUrl) input.value=x.widgetUrl;",
    "      const preview=document.getElementById('previewIframe');",
    "      if(preview) preview.src='/widget.html?live=1&_='+Date.now();",
    "    });",
    "    socket.on('auto_auction_real_tie', x => {",
    "      mount();",
    "      document.getElementById('ttaStatus').textContent = 'REAL TIE '+x.coins+' -> '+x.newTime+'s';",
    "    });"
  ].join('\n');
  d=rep(d,anchor,block,'dashboard live board event');
}

fs.writeFileSync(serverPath,s,'utf8');
fs.writeFileSync(dashPath,d,'utf8');
console.log('TikTok Studio <-> auction board auto-flow integrated.');