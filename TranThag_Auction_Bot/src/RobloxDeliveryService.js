function sleep(ms){ return new Promise(r => setTimeout(r,ms)); }

export class RobloxDeliveryService {
  constructor(config){ this.config = config; }

  async deliver({deliveryId,roundId,award,winner,robloxUsername}){
    const payload = {
      version:"auction-award-v1",
      deliveryId,
      roundId,
      catalogKey:award.catalogKey,
      quantity:award.quantity,
      robloxUsername,
      tiktokUsername:winner.username,
      winningCoins:winner.totalCoins,
      issuedAt:new Date().toISOString()
    };

    if(!this.config.enabled || this.config.dryRun){
      console.log("[ROBLOX DRY RUN]",payload);
      return {ok:true,status:"DRY_RUN",payload};
    }

    if(!this.config.universeId) throw new Error("ROBLOX_UNIVERSE_ID missing");
    if(!this.config.apiKey) throw new Error("ROBLOX_OPEN_CLOUD_API_KEY missing");

    const url = `https://apis.roblox.com/cloud/v2/universes/${encodeURIComponent(this.config.universeId)}:publishMessage`;
    let lastError;

    for(let attempt=1; attempt<=this.config.maxAttempts; attempt++){
      try{
        const controller = new AbortController();
        const timer = setTimeout(()=>controller.abort(),this.config.requestTimeoutMs);
        const res = await fetch(url,{
          method:"POST",
          headers:{
            "x-api-key":this.config.apiKey,
            "content-type":"application/json"
          },
          body:JSON.stringify({
            topic:this.config.topic,
            message:JSON.stringify(payload)
          }),
          signal:controller.signal
        }).finally(()=>clearTimeout(timer));

        if(!res.ok) throw new Error(`Roblox HTTP ${res.status}: ${await res.text()}`);
        return {ok:true,status:"PUBLISHED",attempt,payload};
      }catch(err){
        lastError = err;
        if(attempt < this.config.maxAttempts) await sleep(500 * 2 ** (attempt-1));
      }
    }
    throw lastError;
  }
}
