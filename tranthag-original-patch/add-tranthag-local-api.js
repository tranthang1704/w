'use strict';
const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) throw new Error('Usage: node add-tranthag-local-api.js <app-dir>');

const serverPath = path.join(root, 'server.js');
const dashPath = path.join(root, 'public', 'dashboard.js');
let s = fs.readFileSync(serverPath, 'utf8');
let d = fs.readFileSync(dashPath, 'utf8');

function replaceOnce(text, from, to, label) {
  if (!text.includes(from)) throw new Error('Missing anchor: ' + label);
  return text.replace(from, to);
}

// Remove Eluder requirement from the desktop app.
s = s.replace(
  "function getEffectiveEluderKey() {\n  return (appConfig.eluderApiKey || process.env.SIGN_API_KEY || '').trim();\n}",
  "function getEffectiveEluderKey() {\n  return '';\n}"
);

s = s.replace(
  "  const effectiveKey = getEffectiveEluderKey();\n  if (!effectiveKey) {\n    isConnectingTikTok = false;\n    auctionState.connection.status = 'disconnected';\n    auctionState.connection.username = '';\n    broadcastState();\n    return;\n  }\n\n  try {",
  "  const effectiveKey = '';\n\n  try {"
);

const eluderServerGate = [
  "    const effectiveEluderKey = (appConfig.eluderApiKey || process.env.SIGN_API_KEY || '').trim();",
  "    if (!effectiveEluderKey) {",
  "      socket.emit('notification', { type: 'error', message: 'Vui lĂ˛ng nháş­p Eluder API Key trĆ°á»›c khi káşżt ná»‘i TikTok. Nháş­p key á»ź Ă´ ELUDER API káşż bĂŞn VOUCHES.' });",
  "      socket.emit('eluder_config', getPublicEluderConfig());",
  "      return;",
  "    }",
  "    const username = String(data && data.username || '').trim().toLowerCase().replace(/^@+/, '');"
].join('\n');
s = s.replace(
  eluderServerGate,
  "    const username = String(data && data.username || '').trim().toLowerCase().replace(/^@+/, '');"
);

// Local API block.
if (!s.includes('TRANTHAG_LOCAL_API_V1')) {
  const anchor = "const PORT = process.env.PORT || 3000;";
  if (!s.includes(anchor)) throw new Error('Missing local API insertion anchor');

  const apiBlock = [
    anchor,
    "",
    "// TRANTHAG_LOCAL_API_V1",
    "const LOCAL_API_HOST = '127.0.0.1';",
    "const LOCAL_API_PORT = 3789;",
    "const LOCAL_API_KEY_FILE = path.join(extRootDir, 'API_KEY.txt');",
    "const localApiCrypto = require('crypto');",
    "let localApiKey = '';",
    "try { localApiKey = fs.readFileSync(LOCAL_API_KEY_FILE, 'utf8').trim(); } catch (_) {}",
    "if (!localApiKey) {",
    "  localApiKey = 'tta_' + localApiCrypto.randomBytes(24).toString('hex');",
    "  try { fs.writeFileSync(LOCAL_API_KEY_FILE, localApiKey + '\\n', 'utf8'); } catch (_) {}",
    "}",
    "const localApiApp = express();",
    "localApiApp.use(express.json({ limit: '256kb' }));",
    "localApiApp.use((req,res,next)=>{",
    "  res.setHeader('Access-Control-Allow-Origin','*');",
    "  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');",
    "  res.setHeader('Access-Control-Allow-Headers','Content-Type,x-api-key');",
    "  res.setHeader('Cache-Control','no-store');",
    "  if (req.method === 'OPTIONS') return res.sendStatus(204);",
    "  next();",
    "});",
    "function localApiAuth(req,res,next){",
    "  const supplied=String(req.headers['x-api-key']||req.query.apiKey||'').trim();",
    "  if (!supplied || supplied !== localApiKey) return res.status(401).json({ok:false,error:'invalid TranThagAPPLIVE API key'});",
    "  next();",
    "}",
    "let localApiChat=[];",
    "let localApiWsClients=new Set();",
    "function localApiBroadcast(type,payload){",
    "  const packet=JSON.stringify({type:type,data:payload||{},timestamp:Date.now()});",
    "  for (const ws of Array.from(localApiWsClients)) {",
    "    try { if (ws.readyState===1) ws.send(packet); else localApiWsClients.delete(ws); } catch (_) { localApiWsClients.delete(ws); }",
    "  }",
    "}",
    "localApiApp.get('/api/status', localApiAuth, (req,res)=>res.json({",
    "  ok:true,",
    "  status:auctionState&&auctionState.connection?auctionState.connection.status:'disconnected',",
    "  username:auctionState&&auctionState.connection?auctionState.connection.username:'',",
    "  auctionStatus:auctionState?auctionState.status:'idle',",
    "  timeRemaining:auctionState?auctionState.timeRemaining:0,",
    "  api:'TranThagAPPLIVE Local API',",
    "  port:LOCAL_API_PORT",
    "}));",
    "localApiApp.get('/api/chat', localApiAuth, (req,res)=>{",
    "  const limit=Math.max(1,Math.min(100,Number(req.query.limit)||50));",
    "  res.json({ok:true,messages:localApiChat.slice(0,limit)});",
    "});",
    "localApiApp.post('/api/connect', localApiAuth, async (req,res)=>{",
    "  const username=String(req.body&&req.body.username||'').trim().toLowerCase().replace(/^@+/,'');",
    "  if(!username) return res.status(400).json({ok:false,error:'TikTok username is required'});",
    "  try {",
    "    localApiBroadcast('status',{status:'connecting',username:username});",
    "    await connectTikTok(username);",
    "    return res.json({ok:true,status:auctionState.connection.status,username:username,roomId:tiktokConnection&&tiktokConnection.roomId?String(tiktokConnection.roomId):''});",
    "  } catch(e) { return res.status(502).json({ok:false,error:String(e&&e.message||e)}); }",
    "});",
    "localApiApp.post('/api/disconnect', localApiAuth, async (req,res)=>{",
    "  try { await disconnectTikTok(); } catch (_) {}",
    "  localApiBroadcast('status',{status:'disconnected'});",
    "  res.json({ok:true,status:'disconnected'});",
    "});",
    "// Test-only: never changes real auction totals.",
    "localApiApp.post('/api/gift', localApiAuth, (req,res)=>{",
    "  const body=req.body&&typeof req.body==='object'?req.body:{};",
    "  const event={test:true,username:String(body.username||body.uniqueId||'Viewer'),nickname:String(body.nickname||body.username||body.uniqueId||'Viewer'),giftName:String(body.giftName||'Test Gift'),repeatCount:Math.max(1,Math.floor(Number(body.repeatCount)||1)),diamonds:Math.max(0,Math.floor(Number(body.diamonds)||0)),profilePictureUrl:String(body.profilePictureUrl||'')};",
    "  localApiBroadcast('gift_test',event);",
    "  localApiBroadcast('animation',{test:true,giftName:event.giftName,coins:event.diamonds,username:event.username});",
    "  res.json({ok:true,test:true,affectsAuction:false,event:event});",
    "});",
    "const localApiServer=http.createServer(localApiApp);",
    "try {",
    "  const WebSocketServer=require('ws').WebSocketServer;",
    "  const localApiWss=new WebSocketServer({server:localApiServer,path:'/ws'});",
    "  localApiWss.on('connection',(ws,req)=>{",
    "    let supplied='';",
    "    try { supplied=String(new URL(req.url,'http://127.0.0.1').searchParams.get('apiKey')||'').trim(); } catch (_) {}",
    "    if(supplied!==localApiKey){ try{ws.close(1008,'invalid api key');}catch(_){} return; }",
    "    localApiWsClients.add(ws);",
    "    try { ws.send(JSON.stringify({type:'status',data:{status:auctionState&&auctionState.connection?auctionState.connection.status:'disconnected',username:auctionState&&auctionState.connection?auctionState.connection.username:''},timestamp:Date.now()})); } catch (_) {}",
    "    ws.on('close',()=>localApiWsClients.delete(ws));",
    "    ws.on('error',()=>localApiWsClients.delete(ws));",
    "  });",
    "} catch(e) { logToFile('Local API WebSocket init error: '+String(e&&e.message||e)); }",
    "localApiServer.on('error',err=>logToFile('Local API 3789 error: '+String(err&&err.message||err)));",
    "localApiServer.listen(LOCAL_API_PORT,LOCAL_API_HOST,()=>{",
    "  logToFile('TranThagAPPLIVE Local API listening on http://'+LOCAL_API_HOST+':'+LOCAL_API_PORT);",
    "  logToFile('TranThagAPPLIVE API key file: '+LOCAL_API_KEY_FILE);",
    "});"
  ].join('\n');

  s = s.replace(anchor, apiBlock);
}

// Mirror genuine TikTok gifts to local API realtime without changing the existing auction flow.
const giftForward = "      forwardRealGiftToHybrid(data, decision);";
if (s.includes(giftForward) && !s.includes("localApiBroadcast('gift'")) {
  s = s.replace(
    giftForward,
    giftForward + "\n" +
    "      localApiBroadcast('gift',{username:decision.uniqueId,uniqueId:decision.uniqueId,nickname:decision.nickname,giftName:decision.giftName,repeatCount:decision.repeatCount||1,diamonds:decision.creditDelta,profilePictureUrl:decision.profilePictureUrl});\n" +
    "      localApiBroadcast('animation',{username:decision.uniqueId,giftName:decision.giftName,coins:decision.creditDelta,source:'tiktok_live'});"
  );
}

// Mirror chat messages to GET /api/chat + WebSocket.
const chatNeedle = "      const isFinishedWinner = auctionState.status === 'finished' && lastRoundHadWinner &&";
if (s.includes(chatNeedle) && !s.includes('localChatEvent')) {
  s = s.replace(
    chatNeedle,
    "      const localChatEvent={id:messageId||String(Date.now()),username:String(rawSender||''),uniqueId:String(rawSender||''),comment:rawComment,source:source||'tiktok_live',timestamp:Date.now()};\n" +
    "      localApiChat.unshift(localChatEvent);\n" +
    "      if(localApiChat.length>100)localApiChat.length=100;\n" +
    "      localApiBroadcast('chat',localChatEvent);\n\n" +
    chatNeedle
  );
}

const connectedNeedle = "    auctionState.connection.status = 'connected';";
if (s.includes(connectedNeedle) && !s.includes("localApiBroadcast('status',{status:'connected'")) {
  s = s.replace(
    connectedNeedle,
    connectedNeedle + "\n    localApiBroadcast('status',{status:'connected',username:cleanUsername,roomId:state&&state.roomId||''});"
  );
}

const disconnectNeedle = "  auctionState.connection.status = 'disconnected';\n  auctionState.connection.username = '';\n  broadcastState();";
if (s.includes(disconnectNeedle) && !s.includes("localApiBroadcast('status',{status:'disconnected'")) {
  s = s.replace(
    disconnectNeedle,
    "  auctionState.connection.status = 'disconnected';\n  auctionState.connection.username = '';\n  if(typeof localApiBroadcast==='function')localApiBroadcast('status',{status:'disconnected'});\n  broadcastState();"
  );
}

// Dashboard: remove Eluder gate, keep Terms gate, hide old Eluder UI.
d = d.replace(
  "  } else {\n    btn.disabled = !eluderConfigured;\n    btn.title = eluderConfigured ? '' : 'Vui lĂ˛ng nháş­p Eluder API Key trĆ°á»›c';\n    btn.style.opacity = eluderConfigured ? '' : '0.5';\n    btn.style.pointerEvents = eluderConfigured ? '' : 'none';\n  }",
  "  } else {\n    btn.disabled = false;\n    btn.title = '';\n    btn.style.opacity = '';\n    btn.style.pointerEvents = '';\n  }"
);

d = d.replace(
  "  if (!eluderConfigured) {\n    alert('Vui lĂ˛ng nháş­p Eluder API Key trĆ°á»›c khi káşżt ná»‘i TikTok. Nháş­p key á»ź Ă´ ELUDER API káşż bĂŞn VOUCHES.');\n    if (inputEluderApiKey) inputEluderApiKey.focus();\n    return;\n  }\n  const username = tiktokUsernameSelect.value;",
  "  const username = tiktokUsernameSelect.value;"
);

if (!d.includes('TRANTHAG_HIDE_ELUDER_UI_V1')) {
  d += "\n// TRANTHAG_HIDE_ELUDER_UI_V1\n" +
       "document.addEventListener('DOMContentLoaded',()=>{const el=document.getElementById('eluderControlHeader');if(el)el.style.display='none';});\n";
}

fs.writeFileSync(serverPath, s, 'utf8');
fs.writeFileSync(dashPath, d, 'utf8');
console.log('TranThag Local API + no-Eluder patch applied.');
