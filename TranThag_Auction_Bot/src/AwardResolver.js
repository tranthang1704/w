export class AwardResolver {
  constructor(config){ this.config = config; }
  getActiveAward(){
    const award = this.config.awards.find(
      x => x.id === this.config.activeAwardId && x.enabled !== false
    );
    if(!award) throw new Error("Active award not found");
    return {
      id: award.id,
      displayName: award.displayName,
      catalogKey: award.catalogKey,
      quantity: Math.max(1, Number(award.quantity || 1))
    };
  }
}
