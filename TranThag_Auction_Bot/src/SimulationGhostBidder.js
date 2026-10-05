export class SimulationGhostBidder {
  constructor(config){
    this.config = config;
    this.cursor = 0;
    this.firedNoBidRound = null;
  }

  isEnabled({tiktokConnected}){
    return Boolean(
      this.config?.enabled &&
      this.config?.dummyBidder?.enabled &&
      !tiktokConnected
    );
  }

  maybeFollowTestBid(engine, bid){
    if(!this.isEnabled({tiktokConnected:engine.state.tiktok.connected})) return;
    if(!this.config.dummyBidder.followTestBids) return;
    if(bid?.source !== "TEST") return;

    const leader = engine.state.bids[0];
    if(!leader || leader.isDummy) return;

    const step = Math.max(1,Number(this.config.dummyBidder.pushStepCoins || 100));
    this.pushDummy(engine, leader.totalCoins + step, "follow-test-bid");
  }

  maybeCreateNoBidWinner(engine){
    if(!this.isEnabled({tiktokConnected:engine.state.tiktok.connected})) return;
    if(engine.state.phase !== "FINAL") return;
    if(engine.state.roundId === this.firedNoBidRound) return;

    const threshold = Math.max(
      0,
      Number(this.config.dummyBidder.autoNoBidAtSecondsLeft ?? 10)
    );

    if(engine.state.secondsLeft > threshold) return;

    const hasRealOrTest = engine.state.bids.some(x => !x.isDummy);
    if(hasRealOrTest) return;

    this.firedNoBidRound = engine.state.roundId;
    this.pushDummy(
      engine,
      Math.max(engine.config.minGiftCoins,Number(this.config.dummyBidder.pushStepCoins || 100)),
      "no-bid-simulation"
    );
  }

  pushDummy(engine, targetCoins, reason){
    const names = this.config.dummyBidder.usernames?.length
      ? this.config.dummyBidder.usernames
      : ["DUMMY_TEST"];

    const username = names[this.cursor % names.length];
    this.cursor += 1;

    const id = `dummy:${username.toLowerCase()}`;
    let bidder = engine.state.bids.find(x => x.userId === id);

    if(!bidder){
      bidder = {
        userId:id,
        username,
        nickname:`${username} [TEST]`,
        totalCoins:0,
        giftCount:0,
        firstBidAt:Date.now(),
        lastBidAt:Date.now(),
        isDummy:true,
        source:"SIMULATION"
      };
      engine.state.bids.push(bidder);
    }

    bidder.totalCoins = Math.max(bidder.totalCoins,Math.floor(Number(targetCoins || 0)));
    bidder.giftCount += 1;
    bidder.lastBidAt = Date.now();

    engine.state.bids.sort(
      (a,b) => b.totalCoins-a.totalCoins || a.firstBidAt-b.firstBidAt
    );

    engine.emit("event",{
      name:"simulation:dummy-bid",
      data:{
        roundId:engine.state.roundId,
        bidder:{...bidder},
        reason,
        simulation:true
      }
    });

    engine.emitState("simulation-dummy-bid");
  }
}
