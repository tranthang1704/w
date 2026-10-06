const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const AuctionEngine = require('./services/auctionEngine.cjs');
const RobloxService = require('./services/robloxService.cjs');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const io = new EventEmitter();
io.emit = io.emit.bind(io);

for (const event of ['auctionUpdate','timerUpdate','phaseChange','auctionSummary']) {
  io.on(event, payload => {
    console.log('[TEST EVENT]', event, JSON.stringify(payload));
  });
}

const robloxService = new RobloxService(config);
const engine = new AuctionEngine(io, config, robloxService);

console.log('TEST-ONLY runner. This does not connect to TikTok LIVE or public chat.');
engine.startNewRound();
