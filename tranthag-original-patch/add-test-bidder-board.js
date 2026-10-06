'use strict';
const fs=require('fs');
const path=require('path');
const root=process.argv[2];
if(!root) throw new Error('Usage: node add-test-bidder-board.js <app-dir>');
const serverPath=path.join(root,'server.js');
const widgetPath=path.join(root,'public','widget.js');
let s=fs.readFileSync(serverPath,'utf8');
let w=fs.readFileSync(widgetPath,'utf8');
function rep(text,from,to,label){ if(!text.includes(from)) throw new Error('Missing anchor: '+label); return text.replace(from,to); }

if(!s.includes('let autoTestBidCoins = 0;')){
  s=rep(s,"let autoRoundHadQualifyingRealGift = false;","let autoRoundHadQualifyingRealGift = false;\nlet autoTestBidCoins = 0;\nlet autoTestBidTimer = null;",'test bidder globals');
}

if(!s.includes('function autoStartTestBidSimulation()')){
  const anchor="async function autoRunSafeTestDelivery() {";
  const fn=[
    "function autoStopTestBidSimulation() {",
    "  if (autoTestBidTimer) { clearInterval(autoTestBidTimer); autoTestBidTimer = null; }",
    "}",
    "function autoStartTestBidSimulation() {",
    "  autoStopTestBidSimulation();",
    "  autoTestBidCoins = 0;",
    "  if (!autoAuctionSettings.testDeliveryMode) return;",
    "  const username = autoAuctionSettings.testTikTokLabel || 'test_account';",
    "  io.emit('auto_auction_test_bid', { test:true, username, coins:autoTestBidCoins, status:'ready' });",
    "  autoTestBidTimer = setInterval(() => {",
    "    if (!autoAuctionSettings.testDeliveryMode || auctionState.status !== 'running' || autoRoundHadQualifyingRealGift) return;",
    "    autoTestBidCoins += Math.max(10, Math.ceil(autoAuctionSettings.highGiftThreshold / 5));",
    "    io.emit('auto_auction_test_bid', { test:true, username, coins:autoTestBidCoins, status:'simulating' });",
    "  }, 5000);",
    "}",
    ""
  ].join('\n');
  s=rep(s,anchor,fn+anchor,'test bidder simulation funcs');
}

if(!s.includes('autoStartTestBidSimulation();\n  io.emit(\'auto_auction_round_started\'')){
  s=rep(s,"  startTimer();\n  io.emit('auto_auction_round_started', { timeRemaining: auctionState.timeRemaining });","  startTimer();\n  autoStartTestBidSimulation();\n  io.emit('auto_auction_round_started', { timeRemaining: auctionState.timeRemaining });",'start test bidder simulation');
}

if(!s.includes("io.emit('auto_auction_test_winner'")){
  const anchor="  const awardId = 'test-' + autoEnsureRoundId() + '-' + autoAuctionSettings.testRobloxUsername.toLowerCase() + '-' + autoAuctionSettings.itemId;";
  const replacement=anchor+"\n  autoStopTestBidSimulation();\n  io.emit('auto_auction_test_winner', { test:true, username:autoAuctionSettings.testTikTokLabel || 'test_account', coins:autoTestBidCoins, roblox:autoAuctionSettings.testRobloxUsername, label:'TEST WINNER — NOT A REAL AUCTION RESULT' });";
  s=rep(s,anchor,replacement,'test winner event');
}

if(!w.includes('TRANTHAG_TEST_BIDDER_BOARD_V1')){
  w += [
    '',
    '// TRANTHAG_TEST_BIDDER_BOARD_V1',
    "(() => {",
    "  function ensureTestBidderBoard(){",
    "    let box=document.getElementById('tranthagTestBidderBoard');",
    "    if(box) return box;",
    "    const style=document.createElement('style');",
    "    style.textContent=[",
    "      '#tranthagTestBidderBoard{position:fixed;left:18px;bottom:18px;width:min(340px,42vw);z-index:100002;padding:12px 14px;border-radius:14px;background:rgba(67,20,7,.92);border:1px solid #fb923c;color:#fff7ed;box-shadow:0 10px 28px rgba(0,0,0,.35);font-family:Inter,Arial,sans-serif;display:none;pointer-events:none}',",
    "      '#tranthagTestBidderBoard .tta-test-tag{font-size:10px;font-weight:900;letter-spacing:.1em;color:#fdba74}',",
    "      '#tranthagTestBidderBoard .tta-test-row{display:flex;align-items:end;justify-content:space-between;gap:10px;margin-top:6px}',",
    "      '#tranthagTestBidderBoard .tta-test-user{font-size:18px;font-weight:900;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',",
    "      '#tranthagTestBidderBoard .tta-test-coins{font-size:26px;font-weight:950;color:#fb923c;white-space:nowrap}',",
    "      '#tranthagTestBidderBoard .tta-test-note{margin-top:5px;font-size:10px;color:#fed7aa}',",
    "      '@media(max-width:700px){#tranthagTestBidderBoard{left:10px;bottom:10px;width:min(300px,76vw)}}'",
    "    ].join('');",
    "    document.head.appendChild(style);",
    "    box=document.createElement('div');",
    "    box.id='tranthagTestBidderBoard';",
    "    box.innerHTML='<div class=\"tta-test-tag\">TEST BIDDER · SIMULATION ONLY</div><div class=\"tta-test-row\"><div class=\"tta-test-user\">@test_account</div><div class=\"tta-test-coins\">0 test xu</div></div><div class=\"tta-test-note\">Separate from LIVE TOP BIDDER</div>';",
    "    document.body.appendChild(box);",
    "    return box;",
    "  }",
    "  function setTestVisible(visible){ const box=ensureTestBidderBoard(); box.style.display=visible?'block':'none'; }",
    "  function renderTestBid(data){",
    "    const box=ensureTestBidderBoard(); setTestVisible(true);",
    "    box.querySelector('.tta-test-tag').textContent='TEST BIDDER · SIMULATION ONLY';",
    "    box.querySelector('.tta-test-user').textContent='@'+String(data&&data.username||'test_account');",
    "    box.querySelector('.tta-test-coins').textContent=String(Math.max(0,Number(data&&data.coins||0)))+' test xu';",
    "    box.querySelector('.tta-test-note').textContent='Separate from LIVE TOP BIDDER · not a real gift';",
    "  }",
    "  function renderTestWinner(data){",
    "    const box=ensureTestBidderBoard(); setTestVisible(true);",
    "    box.querySelector('.tta-test-tag').textContent='TEST WINNER — NOT A REAL AUCTION RESULT';",
    "    box.querySelector('.tta-test-user').textContent='@'+String(data&&data.username||'test_account');",
    "    box.querySelector('.tta-test-coins').textContent=String(Math.max(0,Number(data&&data.coins||0)))+' test xu';",
    "    box.querySelector('.tta-test-note').textContent='Roblox test target: '+String(data&&data.roblox||'not configured');",
    "  }",
    "  if(typeof socket!=='undefined'){",
    "    socket.on('state_update',state=>setTestVisible(!!(state&&state.config&&state.config.testDeliveryMode)));",
    "    socket.on('auto_auction_test_bid',renderTestBid);",
    "    socket.on('auto_auction_test_winner',renderTestWinner);",
    "  }",
    "})();"
  ].join('\n');
}

fs.writeFileSync(serverPath,s,'utf8');
fs.writeFileSync(widgetPath,w,'utf8');
console.log('TEST bidder simulation panel added to auction board.');