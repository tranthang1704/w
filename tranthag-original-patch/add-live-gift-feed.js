'use strict';
const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) throw new Error('Usage: node add-live-gift-feed.js <extracted-app-dir>');

const serverPath = path.join(root, 'server.js');
const widgetPath = path.join(root, 'public', 'widget.js');

let s = fs.readFileSync(serverPath, 'utf8');
let w = fs.readFileSync(widgetPath, 'utf8');

if (!s.includes("io.emit('real_gift_received'")) {
  const anchor = "      processBid(decision.uniqueId, decision.nickname, decision.profilePictureUrl, decision.creditDelta, 'gift', { forwardSeparately: true });\n      autoHandleRealGift(decision);\n      forwardRealGiftToHybrid(data, decision);";
  if (!s.includes(anchor)) throw new Error('Missing real TikTok gift hook in server.js');

  const replacement = [
    "      const realCredit = processBid(decision.uniqueId, decision.nickname, decision.profilePictureUrl, decision.creditDelta, 'gift', { forwardSeparately: true });",
    "      autoHandleRealGift(decision);",
    "      io.emit('real_gift_received', {",
    "        uniqueId: decision.uniqueId,",
    "        nickname: decision.nickname,",
    "        giftName: decision.giftName,",
    "        diamondCount: decision.creditDelta,",
    "        profilePictureUrl: decision.profilePictureUrl,",
    "        totalCoins: realCredit && realCredit.totalCoins != null ? realCredit.totalCoins : null,",
    "        timestamp: Date.now()",
    "      });",
    "      forwardRealGiftToHybrid(data, decision);"
  ].join("\n");

  s = s.replace(anchor, replacement);
}

if (!w.includes('TRANTHAG_REAL_GIFT_FEED_V1')) {
  w += `

// TRANTHAG_REAL_GIFT_FEED_V1
(() => {
  function ensureFeed() {
    let feed = document.getElementById('tranthagRealGiftFeed');
    if (feed) return feed;

    const style = document.createElement('style');
    style.id = 'tranthagRealGiftFeedStyle';
    style.textContent = [
      '#tranthagRealGiftFeed{position:fixed;right:18px;bottom:18px;width:min(360px,42vw);display:flex;flex-direction:column;gap:8px;z-index:100001;pointer-events:none;font-family:Inter,Arial,sans-serif;}',
      '.tta-real-gift-row{display:grid;grid-template-columns:42px 1fr auto;align-items:center;gap:9px;padding:9px 11px;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:rgba(3,7,18,.86);color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.28);animation:ttaGiftIn .2s ease-out;backdrop-filter:blur(8px);}',
      '.tta-real-gift-row img{width:42px;height:42px;border-radius:999px;object-fit:cover;background:rgba(255,255,255,.08);}',
      '.tta-real-gift-main{min-width:0;}',
      '.tta-real-gift-main b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;}',
      '.tta-real-gift-main span{display:block;margin-top:2px;color:#cbd5e1;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.tta-real-gift-coins{color:#facc15;font-weight:900;font-size:15px;white-space:nowrap;}',
      '@keyframes ttaGiftIn{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}',
      '@media(max-width:700px){#tranthagRealGiftFeed{width:min(320px,80vw);right:10px;bottom:10px;}}'
    ].join('');

    document.head.appendChild(style);
    feed = document.createElement('div');
    feed.id = 'tranthagRealGiftFeed';
    document.body.appendChild(feed);
    return feed;
  }

  function showRealGift(gift) {
    if (!gift) return;
    const feed = ensureFeed();
    const row = document.createElement('div');
    row.className = 'tta-real-gift-row';

    const avatar = document.createElement('img');
    avatar.alt = '';
    avatar.src = gift.profilePictureUrl || '/assets/default-avatar.png';

    const main = document.createElement('div');
    main.className = 'tta-real-gift-main';

    const name = document.createElement('b');
    name.textContent = '@' + String(gift.uniqueId || gift.nickname || 'viewer');

    const detail = document.createElement('span');
    const total = gift.totalCoins != null ? ' · tổng ' + Number(gift.totalCoins || 0) + ' xu' : '';
    detail.textContent = String(gift.giftName || 'Gift') + total;

    main.appendChild(name);
    main.appendChild(detail);

    const coins = document.createElement('div');
    coins.className = 'tta-real-gift-coins';
    coins.textContent = '+' + Math.max(0, Number(gift.diamondCount || 0)) + ' xu';

    row.appendChild(avatar);
    row.appendChild(main);
    row.appendChild(coins);
    feed.prepend(row);

    while (feed.children.length > 6) feed.lastElementChild.remove();

    setTimeout(() => {
      if (!row.isConnected) return;
      row.style.transition = 'opacity .25s ease, transform .25s ease';
      row.style.opacity = '0';
      row.style.transform = 'translateY(8px)';
      setTimeout(() => row.remove(), 280);
    }, 7000);
  }

  if (typeof socket !== 'undefined') {
    socket.on('real_gift_received', showRealGift);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureFeed);
  } else {
    ensureFeed();
  }
})();
`;
}

fs.writeFileSync(serverPath, s, 'utf8');
fs.writeFileSync(widgetPath, w, 'utf8');
console.log('Live real-gift feed added to auction board.');
