import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

export class AuctionEngine extends EventEmitter {
  constructor({config,awardResolver,deliveryService,simulationGhost=null}){
    super();
    this.config = config;
    this.awardResolver = awardResolver;
    this.deliveryService = deliveryService;
    this.simulationGhost = simulationGhost;
    this.timer = null;
    this.nextTimer = null;
    this.liveConnected = false;
    this.identityMap = new Map();

    this.state = {
      phase:"WAITING_LIVE",
      roundId:null,
      secondsLeft:0,
      deadlineAt:null,
      bids:[],
      winner:null,
      activeAward:this.awardResolver.getActiveAward(),
      lastDelivery:null,
      tiktok:{connected:false,roomId:null}
    };
  }

  snapshot(){ return JSON.parse(JSON.stringify(this.state)); }
  emitState(reason){ this.emit("state",this.snapshot(),reason); }

  onTikTokConnected(info={}){
    this.liveConnected = true;
    this.state.tiktok = {connected:true,roomId:info.roomId || null};
    this.startRound("tiktok-connected");
  }

  onTikTokDisconnected(){
    this.liveConnected = false;
    this.state.tiktok.connected = false;
    this.clearTimers();
    this.state.phase = "WAITING_LIVE";
    this.state.secondsLeft = 0;
    this.emitState("tiktok-disconnected");
  }

  startRound(reason="manual"){
    this.clearTimers();
    this.state.phase = "MAIN";
    this.state.roundId = `round_${Date.now()}_${randomUUID().slice(0,8)}`;
    this.state.secondsLeft = this.config.mainSeconds;
    this.state.deadlineAt = Date.now() + this.config.mainSeconds*1000;
    this.state.bids = [];
    this.state.winner = null;
    this.state.lastDelivery = null;
    this.state.activeAward = this.awardResolver.getActiveAward();

    this.emit("event",{
      name:"auction:round-started",
      data:{reason,roundId:this.state.roundId,activeAward:this.state.activeAward}
    });
    this.emitState("round-started");
    this.timer = setInterval(()=>this.tick(),250);
  }

  tick(){
    if(!["MAIN","FINAL"].includes(this.state.phase)) return;

    const remaining = this.state.deadlineAt - Date.now();
    this.state.secondsLeft = Math.max(0,Math.ceil(remaining/1000));

    if(this.simulationGhost){
      this.simulationGhost.maybeCreateNoBidWinner(this);
    }

    this.emitState("tick");
    if(remaining > 0) return;

    if(this.state.phase === "MAIN"){
      this.state.phase = "FINAL";
      this.state.secondsLeft = this.config.finalSeconds;
      this.state.deadlineAt = Date.now() + this.config.finalSeconds*1000;
      this.emit("event",{name:"auction:final-started",data:{roundId:this.state.roundId}});
      this.emitState("final-started");
      return;
    }

    this.finishRound();
  }

  addGift(gift){
    if(!["MAIN","FINAL"].includes(this.state.phase)){
      return {accepted:false,reason:"auction-not-active"};
    }

    const coins = Math.floor(Number(gift.totalCoins || 0));
    if(coins < this.config.minGiftCoins){
      return {accepted:false,reason:"below-minimum"};
    }

    const id = String(gift.user?.id || gift.user?.username || "unknown");
    let bidder = this.state.bids.find(x=>x.userId===id);

    if(!bidder){
      bidder = {
        userId:id,
        username:String(gift.user?.username || "unknown"),
        nickname:String(gift.user?.nickname || ""),
        totalCoins:0,
        giftCount:0,
        firstBidAt:Date.now(),
        lastBidAt:Date.now(),
        isDummy:false,
        source:String(gift.source || "TIKTOK")
      };
      this.state.bids.push(bidder);
    }

    bidder.totalCoins += coins;
    bidder.giftCount += 1;
    bidder.lastBidAt = Date.now();

    this.state.bids.sort(
      (a,b)=>b.totalCoins-a.totalCoins || a.firstBidAt-b.firstBidAt
    );

    if(this.state.phase === "FINAL"){
      this.state.secondsLeft = this.config.finalResetSeconds;
      this.state.deadlineAt = Date.now() + this.config.finalResetSeconds*1000;
    }

    const rank = this.state.bids.findIndex(x=>x.userId===id)+1;

    this.emit("event",{
      name:"auction:bid",
      data:{roundId:this.state.roundId,rank,bidder:{...bidder}}
    });

    if(this.simulationGhost){
      this.simulationGhost.maybeFollowTestBid(this,{
        source:String(gift.source || "TIKTOK"),
        bidder:{...bidder},
        rank
      });
    }

    this.emitState("bid");
    return {accepted:true,rank};
  }

  bindRobloxIdentity({userId,username,robloxUsername}){
    const clean = String(robloxUsername || "").trim();
    if(!/^[A-Za-z0-9_]{3,20}$/.test(clean)){
      throw new Error("Invalid Roblox username");
    }

    if(userId) this.identityMap.set(String(userId),clean);
    if(username) this.identityMap.set("name:"+String(username).toLowerCase(),clean);

    if(this.state.phase === "RESULT" && this.state.winner && !this.state.winner.isDummy){
      const w = this.state.winner;
      if(
        String(w.userId)===String(userId) ||
        w.username.toLowerCase()===String(username||"").toLowerCase()
      ){
        void this.deliverWinner();
      }
    }
  }

  async finishRound(){
    clearInterval(this.timer);
    this.timer = null;

    this.state.bids.sort(
      (a,b)=>b.totalCoins-a.totalCoins || a.firstBidAt-b.firstBidAt
    );

    this.state.phase = "RESULT";
    this.state.secondsLeft = 0;
    this.state.winner = this.state.bids[0] ? {...this.state.bids[0]} : null;

    this.emit("event",{
      name:"auction:winner",
      data:{
        roundId:this.state.roundId,
        winner:this.state.winner,
        activeAward:this.state.activeAward,
        simulation:Boolean(this.state.winner?.isDummy)
      }
    });

    this.emitState("winner");

    if(this.state.winner && !this.state.winner.isDummy){
      void this.deliverWinner();
    }else if(this.state.winner?.isDummy){
      this.state.lastDelivery = {
        ok:false,
        status:"SIMULATION_NO_DELIVERY",
        tiktokUsername:this.state.winner.username
      };
      this.emitState("simulation-no-delivery");
    }

    if(this.liveConnected){
      this.nextTimer = setTimeout(
        ()=>this.startRound("auto-next"),
        this.config.nextRoundDelaySeconds*1000
      );
    }
  }

  async deliverWinner(){
    const w = this.state.winner;
    if(!w || w.isDummy) return;

    const robloxUsername =
      this.identityMap.get(String(w.userId)) ||
      this.identityMap.get("name:"+w.username.toLowerCase());

    if(!robloxUsername){
      this.state.lastDelivery = {
        ok:false,
        status:"WAITING_ROBLOX_USERNAME",
        tiktokUsername:w.username
      };
      this.emitState("waiting-roblox-username");
      return;
    }

    const deliveryId = `award_${this.state.roundId}_${w.userId}`;

    try{
      this.state.lastDelivery = await this.deliveryService.deliver({
        deliveryId,
        roundId:this.state.roundId,
        award:this.state.activeAward,
        winner:w,
        robloxUsername
      });
    }catch(err){
      this.state.lastDelivery = {
        ok:false,
        status:"FAILED",
        deliveryId,
        error:err.message
      };
    }

    this.emit("event",{name:"delivery:status",data:this.state.lastDelivery});
    this.emitState("delivery-status");
  }

  stop(){
    this.clearTimers();
    this.state.phase = "STOPPED";
    this.state.secondsLeft = 0;
    this.emitState("stopped");
  }

  clearTimers(){
    clearInterval(this.timer);
    clearTimeout(this.nextTimer);
    this.timer = null;
    this.nextTimer = null;
  }
}
