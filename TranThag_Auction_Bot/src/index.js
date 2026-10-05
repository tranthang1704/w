import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import express from "express";
import { fileURLToPath } from "node:url";

import { config } from "./config.js";
import { AwardResolver } from "./AwardResolver.js";
import { RobloxDeliveryService } from "./RobloxDeliveryService.js";
import { TikTokLiveService } from "./TikTokLiveService.js";
import { AuctionEngine } from "./AuctionEngine.js";
import { RealtimeHub } from "./RealtimeHub.js";
import { SimulationGhostBidder } from "./SimulationGhostBidder.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname,"..");

const app = express();
app.disable("x-powered-by");
app.use(express.json({limit:"64kb"}));

const server = http.createServer(app);
const awardResolver = new AwardResolver(config.awards);
const deliveryService = new RobloxDeliveryService(config.roblox);
const simulationGhost = new SimulationGhostBidder(config.simulation);

const engine = new AuctionEngine({
  config:config.auction,
  awardResolver,
  deliveryService,
  simulationGhost
});

const hub = new RealtimeHub(server);
const tiktok = new TikTokLiveService(config.tiktokUsername);

hub.setStateProvider(()=>engine.snapshot());

engine.on("state",state=>hub.broadcastState(state));
engine.on("event",({name,data})=>hub.broadcastEvent(name,data));

tiktok.on("connected",info=>{
  console.log("[TikTok] connected",info);
  console.log("[Simulation] dummy bidders disabled while LIVE is connected.");
  hub.broadcastEvent("tiktok:status",{connected:true,...info});
  engine.onTikTokConnected(info);
});

tiktok.on("disconnected",()=>{
  console.log("[TikTok] disconnected");
  hub.broadcastEvent("tiktok:status",{connected:false});
  engine.onTikTokDisconnected();
});

tiktok.on("errorInfo",data=>{
  console.warn("[TikTok error]",data.message);
  hub.broadcastEvent("tiktok:error",data);
});

tiktok.on("connectFailed",data=>{
  console.warn("[TikTok connect failed]",data.message);
});

tiktok.on("gift",gift=>{
  engine.addGift({...gift,source:"TIKTOK"});
});

tiktok.on("robloxIdentity",data=>{
  try{
    engine.bindRobloxIdentity(data);
    hub.broadcastEvent("auction:roblox-identity",data);
  }catch(err){
    console.warn("[Roblox username]",err.message);
  }
});

function adminGuard(req,res,next){
  if(!config.adminToken){
    const ip = req.socket.remoteAddress;
    if(ip==="127.0.0.1" || ip==="::1" || ip==="::ffff:127.0.0.1") return next();
    return res.status(403).json({ok:false,error:"localhost-only"});
  }

  const token = req.get("x-admin-token");
  if(token !== config.adminToken){
    return res.status(401).json({ok:false,error:"unauthorized"});
  }
  next();
}

app.get("/api/health",(req,res)=>{
  res.json({
    ok:true,
    phase:engine.snapshot().phase,
    simulation:{
      enabled:config.simulation.enabled,
      dummyBidder:config.simulation.dummyBidder.enabled,
      activeNow:simulationGhost.isEnabled({
        tiktokConnected:engine.snapshot().tiktok.connected
      })
    },
    now:new Date().toISOString()
  });
});

app.get("/api/state",(req,res)=>{
  res.json({ok:true,state:engine.snapshot()});
});

app.post("/api/admin/start",adminGuard,(req,res)=>{
  engine.startRound("manual-api");
  res.json({ok:true,state:engine.snapshot()});
});

app.post("/api/admin/stop",adminGuard,(req,res)=>{
  engine.stop();
  res.json({ok:true,state:engine.snapshot()});
});

app.post("/api/admin/winner/roblox",adminGuard,(req,res)=>{
  const winner = engine.snapshot().winner;

  if(!winner){
    return res.status(409).json({ok:false,error:"No current winner"});
  }

  if(winner.isDummy){
    return res.status(409).json({
      ok:false,
      error:"Dummy simulation winners are never eligible for Roblox delivery."
    });
  }

  try{
    engine.bindRobloxIdentity({
      userId:winner.userId,
      username:winner.username,
      robloxUsername:req.body.robloxUsername
    });
    res.json({ok:true});
  }catch(err){
    res.status(400).json({ok:false,error:err.message});
  }
});

app.post("/api/test/gift",adminGuard,(req,res)=>{
  if(!config.allowTestApi){
    return res.status(403).json({ok:false,error:"Test API disabled"});
  }

  if(engine.snapshot().tiktok.connected){
    return res.status(409).json({
      ok:false,
      error:"Test gifts are blocked while TikTok LIVE is connected."
    });
  }

  const username = String(req.body.username || "test_user");

  const result = engine.addGift({
    source:"TEST",
    eventKey:"test_"+Date.now(),
    user:{
      id:"test:"+username.toLowerCase(),
      username,
      nickname:username
    },
    giftId:"TEST",
    giftName:"Test Gift",
    repeatCount:1,
    totalCoins:Number(req.body.coins || 0)
  });

  res.status(result.accepted ? 200 : 400).json(result);
});

const legacyDir = path.resolve(ROOT,"legacy-public");
const fallbackDir = path.resolve(ROOT,"fallback-public");

if(fs.existsSync(legacyDir)){
  app.use(express.static(legacyDir,{fallthrough:true,maxAge:0}));
}

app.use(express.static(fallbackDir,{fallthrough:true,maxAge:0}));
app.get("/",(req,res)=>res.redirect("/widget.html"));

server.listen(config.port,config.host,async()=>{
  console.log(`Auction Bot: http://localhost:${config.port}/widget.html`);
  console.log(`TikTok username: @${config.tiktokUsername || "(not configured)"}`);
  console.log(
    `Simulation dummy bidder: ${config.simulation.enabled && config.simulation.dummyBidder.enabled ? "ENABLED (offline test only)" : "disabled"}`
  );

  try{
    await tiktok.start();
  }catch(err){
    console.error("[Startup]",err.message);
    console.log("HTTP server remains available for local UI/testing.");
  }
});

async function shutdown(){
  engine.stop();
  await tiktok.stop();
  server.close(()=>process.exit(0));
}

process.on("SIGINT",()=>void shutdown());
process.on("SIGTERM",()=>void shutdown());
