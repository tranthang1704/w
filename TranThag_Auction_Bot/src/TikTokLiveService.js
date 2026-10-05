import { EventEmitter } from "node:events";
import { TikTokLiveConnection, WebcastEvent, ControlEvent } from "tiktok-live-connector";

export class TikTokLiveService extends EventEmitter {
  constructor(username){
    super();
    this.username = username;
    this.conn = null;
    this.stopped = false;
    this.retry = 0;
    this.timer = null;
    this.seen = new Set();
  }

  async start(){
    if(!this.username) throw new Error("TIKTOK_USERNAME is empty");
    this.stopped = false;
    await this.connect();
  }

  async stop(){
    this.stopped = true;
    clearTimeout(this.timer);
    try{ this.conn?.disconnect?.(); }catch{}
  }

  async connect(){
    if(this.stopped) return;

    const conn = new TikTokLiveConnection(this.username,{
      enableExtendedGiftInfo:true
    });
    this.conn = conn;

    conn.on(ControlEvent.CONNECTED,state=>{
      this.retry = 0;
      this.emit("connected",{roomId:state?.roomId || null});
    });

    conn.on(ControlEvent.DISCONNECTED,()=>{
      this.emit("disconnected");
      this.scheduleReconnect();
    });

    conn.on(ControlEvent.ERROR,err=>{
      this.emit("errorInfo",{message:err?.exception?.message || err?.message || String(err)});
    });

    conn.on(WebcastEvent.CHAT,data=>{
      const username = String(data.user?.uniqueId ?? data.uniqueId ?? "");
      const userId = String(data.user?.userId ?? data.userId ?? "");
      const comment = String(data.comment || "").trim();

      const match = comment.match(/^(?:!rb|!roblox|roblox)\s+([A-Za-z0-9_]{3,20})$/i);
      if(match){
        this.emit("robloxIdentity",{userId,username,robloxUsername:match[1]});
      }
    });

    conn.on(WebcastEvent.GIFT,data=>{
      const giftType = Number(data.giftDetails?.giftType ?? 0);
      if(giftType === 1 && !data.repeatEnd) return;

      const username = String(data.user?.uniqueId ?? data.uniqueId ?? "unknown");
      const userId = String(data.user?.userId ?? data.userId ?? username);
      const repeatCount = Math.max(1,Number(data.repeatCount || 1));
      const unitCoins = Math.max(0,Number(data.giftDetails?.diamondCount ?? data.extendedGiftInfo?.diamondCount ?? 0));
      const totalCoins = unitCoins * repeatCount;
      const key = String(data.msgId || data.common?.msgId || data.groupId || `${userId}:${data.giftId}:${repeatCount}:${data.createTime || Date.now()}`);

      if(this.seen.has(key)) return;
      this.seen.add(key);
      if(this.seen.size > 5000) this.seen.clear();

      this.emit("gift",{
        eventKey:key,
        user:{id:userId,username,nickname:String(data.user?.nickname ?? data.nickname ?? "")},
        giftId:String(data.giftId ?? ""),
        giftName:data.giftDetails?.giftName || null,
        repeatCount,
        totalCoins
      });
    });

    try{
      await conn.connect();
    }catch(err){
      this.emit("connectFailed",{message:err.message});
      this.scheduleReconnect();
    }
  }

  scheduleReconnect(){
    if(this.stopped || this.timer) return;
    const delay = Math.min(30000,2000 * 2 ** this.retry++);
    this.timer = setTimeout(async()=>{
      this.timer = null;
      await this.connect();
    },delay);
  }
}
