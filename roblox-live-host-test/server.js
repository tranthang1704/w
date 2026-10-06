import express from "express";
import http from "http";
import { Server } from "socket.io";
import { TikTokLiveConnection, WebcastEvent, ControlEvent } from "tiktok-live-connector";
const app=express(); const server=http.createServer(app); const io=new Server(server);
app.use(express.json()); app.use(express.static("public"));
const PORT=Number(process.env.PORT||3000);
const state={live:{username:"",connected:false,roomId:null,connection:null},auction:{round:0,phase:"IDLE",secondsLeft:0,leader:null,bids:{},events:[]}};
function pub(){return {live:{username:state.live.username,connected:state.live.connected,roomId:state.live.roomId},auction:{...state.auction,bids:Object.values(state.auction.bids).sort((a,b)=>b.coins-a.coins)}}}
function emit(){io.emit("state",pub())}
function log(type,message){state.auction.events.unshift({type,message,at:Date.now()});state.auction.events=state.auction.events.slice(0,80);emit()}
function bid(username,coins){const k=username.toLowerCase();const b=state.auction.bids[k]||{username,coins:0};b.coins+=Number(coins||0);state.auction.bids[k]=b;state.auction.leader=Object.values(state.auction.bids).sort((a,b)=>b.coins-a.coins)[0]||null;log("gift","@"+username+" +"+coins+" coins")}
async function connectLive(username){if(state.live.connection){try{state.live.connection.disconnect()}catch{}} state.live.username=String(username||"").replace(/^@/,"").trim();if(!state.live.username)throw new Error("Thiếu TikTok username");const c=new TikTokLiveConnection(state.live.username,{processInitialData:true,fetchRoomInfoOnConnect:true});state.live.connection=c;c.on(ControlEvent.CONNECTED,e=>{state.live.connected=true;state.live.roomId=e?.roomId||null;log("system","Connected @"+state.live.username)});c.on(ControlEvent.DISCONNECTED,()=>{state.live.connected=false;log("warn","LIVE disconnected")});c.on(ControlEvent.ERROR,e=>log("error",String(e?.message||e)));c.on(WebcastEvent.GIFT,d=>{const x=d.giftDetails||{};if(Number(x.giftType??d.giftType??0)===1&&!d.repeatEnd)return;const coins=Number(x.diamondCount??x.diamond_count??d.diamondCount??0)*Math.max(1,Number(d.repeatCount||1));if(coins<100)return;bid(d.user?.uniqueId||d.uniqueId||"unknown",coins)});const r=await c.connect();state.live.connected=true;state.live.roomId=r?.roomId||state.live.roomId;emit()}
let timer=null;function startRound(){if(timer)clearInterval(timer);state.auction.round++;state.auction.phase="MAIN";state.auction.secondsLeft=50;state.auction.bids={};state.auction.leader=null;log("system","Start round #"+state.auction.round);timer=setInterval(()=>{state.auction.secondsLeft--;if(state.auction.secondsLeft===0&&state.auction.phase==="MAIN"){state.auction.phase="FINAL";state.auction.secondsLeft=25;log("system","FINAL +25s");return}if(state.auction.secondsLeft<=0&&state.auction.phase==="FINAL"){clearInterval(timer);timer=null;state.auction.phase="SUMMARY";log("winner",state.auction.leader?("Winner @"+state.auction.leader.username+" - "+state.auction.leader.coins+" coins"):"No valid winner");return}emit()},1000)}
app.get("/api/state",(_q,r)=>r.json(pub()));
app.post("/api/connect",async(req,res)=>{try{await connectLive(req.body?.username);res.json({ok:true})}catch(e){res.status(400).json({ok:false,error:String(e?.message||e)})}});
app.post("/api/start",(_q,r)=>{startRound();r.json({ok:true})});
app.post("/api/test-bid",(req,res)=>{bid(String(req.body?.username||"test_user"),Number(req.body?.coins||100));res.json({ok:true})});
io.on("connection",s=>s.emit("state",pub()));
server.listen(PORT,()=>console.log("Roblox LIVE test listening on "+PORT));