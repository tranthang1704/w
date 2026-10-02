(function () {
  if (window.__TRAN_THAG_AUTO_AUCTION_PANEL__) return;
  window.__TRAN_THAG_AUTO_AUCTION_PANEL__ = true;
  if (typeof io !== "function") return;

  var s = io();
  var state = null;
  var wrap = document.createElement("div");
  wrap.id = "tranthagAutoAuctionPanel";
  wrap.innerHTML = [
    '<style>',
    '#tranthagAutoAuctionPanel{position:fixed;right:16px;bottom:16px;z-index:99999;width:390px;background:#09101d;color:#e8eef8;border:1px solid #2b3a55;border-radius:14px;box-shadow:0 18px 60px #000a;font:12px/1.4 system-ui,Segoe UI,sans-serif}',
    '#tranthagAutoAuctionPanel *{box-sizing:border-box}#aaHead{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid #22304a}',
    '#aaHead b{font-size:14px;color:#5ff0bf}#aaToggle{background:#162238;color:#fff;border:1px solid #334661;border-radius:7px;padding:5px 9px;cursor:pointer}',
    '#aaBody{padding:12px;max-height:68vh;overflow:auto}.aaGrid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.aaField{display:grid;gap:4px;margin-bottom:8px}.aaField span{color:#8fa0bb}',
    '#tranthagAutoAuctionPanel input,#tranthagAutoAuctionPanel textarea{width:100%;background:#070c14;color:#fff;border:1px solid #293951;border-radius:7px;padding:7px}',
    '#tranthagAutoAuctionPanel textarea{min-height:86px;resize:vertical}.aaRow{display:flex;gap:7px}.aaBtn{border:1px solid #31506b;background:#13273a;color:#fff;border-radius:7px;padding:7px 10px;cursor:pointer;font-weight:700}.aaBtn.primary{background:#0c725a;border-color:#20b989}.aaBtn.warn{background:#503818;border-color:#8d672c}',
    '#aaStatus{margin:8px 0;padding:8px;background:#080e18;border:1px solid #223149;border-radius:8px;color:#9fb0c9;white-space:pre-wrap}.aaOk{color:#65f0bd}.aaWarn{color:#ffd26f}.aaErr{color:#ff8c8c}.aaHint{color:#71829d;font-size:10px;margin-top:5px}',
    '</style>',
    '<div id="aaHead"><b>AUTO AUCTION · TIKTOK → ROBLOX</b><button id="aaToggle">Ẩn</button></div>',
    '<div id="aaBody">',
    '<div class="aaGrid">',
    '<label class="aaField"><span>Round (s)</span><input id="aaRound" type="number" value="50"></label>',
    '<label class="aaField"><span>Final delay (s)</span><input id="aaDelay" type="number" value="25"></label>',
    '<label class="aaField"><span>Gift thật kích hoạt overtime</span><input id="aaThreshold" type="number" value="100"></label>',
    '<label class="aaField"><span>Overtime reset (s)</span><input id="aaOvertime" type="number" value="30"></label>',
    '<label class="aaField"><span>Next round delay (s)</span><input id="aaNextDelay" type="number" value="8"></label>',
    '<label class="aaField"><span>Reward Coins</span><input id="aaReward" type="number" value="0"></label>',
    '</div>',
    '<label class="aaField"><span>Roblox Item ID</span><input id="aaItemId" placeholder="AETHERON"></label>',
    '<label class="aaField"><span>Roblox Item Name</span><input id="aaItemName" placeholder="Aetheron Pet"></label>',
    '<label class="aaField"><span>Winner accounts — TikTok | Roblox | câu trạng thái</span><textarea id="aaAccounts" placeholder="@accphu01 | QuanRoblox123 | received {item}, tysm"></textarea></label>',
    '<label class="aaField"><span>Broadcaster comment sau giao thành công</span><input id="aaDeliveryMsg" value="@{winner} prize delivered, tysm"></label>',
    '<div class="aaHint">Biến: {winner} {roblox} {item} {coins}. Auto Tie cũ luôn được tắt.</div>',
    '<div id="aaStatus">Đang chờ state...</div>',
    '<div class="aaRow"><button class="aaBtn primary" id="aaSave">LƯU</button><button class="aaBtn" id="aaStart">START VÁN</button><button class="aaBtn warn" id="aaReset">RESET</button></div>',
    '</div>'
  ].join("");
  document.body.appendChild(wrap);

  function el(id) { return document.getElementById(id); }

  function parseAccounts() {
    return el("aaAccounts").value.split(/\r?\n/).map(function (line) {
      var parts = line.trim().split("|").map(function (x) { return x.trim(); });
      return {
        tiktok: (parts[0] || "").replace(/^@/, ""),
        roblox: parts[1] || "",
        receivedMessage: parts.slice(2).join(" | ") || ""
      };
    }).filter(function (x) { return x.tiktok; });
  }

  function renderAccounts(rows) {
    if (!Array.isArray(rows)) return;
    el("aaAccounts").value = rows.map(function (x) {
      return [
        x.tiktok ? "@" + String(x.tiktok).replace(/^@/, "") : "",
        x.roblox || "",
        x.receivedMessage || ""
      ].join(" | ");
    }).join("\n");
  }

  function setStatus(extra) {
    if (!state) return;
    var top = Array.isArray(state.biddersList) && state.biddersList[0] ? state.biddersList[0] : null;
    var d = state.autoDelivery || {};
    var conn = state.connection || {};
    el("aaStatus").innerHTML =
      'TikTok: <span class="' + (conn.status === "connected" ? "aaOk" : "aaWarn") + '">' + (conn.status || "?") + " " + (conn.username || "") + "</span>\n" +
      "Phase: " + state.status + " · " + state.timeRemaining + "s · " + (state.highGiftOvertimeActive ? '<span class="aaWarn">OVERTIME</span>' : "normal") + "\n" +
      "Top: " + (top ? "@" + top.uniqueId + " · " + top.coins + " xu" : "—") + "\n" +
      "Delivery: " + (d.status || "idle") + (d.robloxUsername ? " → " + d.robloxUsername : "") + "\n" +
      (extra || "");
  }

  s.on("state_update", function (st) {
    state = st;
    var c = st.config || {};
    if (!(document.activeElement && document.activeElement.closest && document.activeElement.closest("#tranthagAutoAuctionPanel"))) {
      el("aaRound").value = c.initialTime == null ? 50 : c.initialTime;
      el("aaDelay").value = c.delay == null ? 25 : c.delay;
      el("aaThreshold").value = c.highGiftThreshold == null ? 100 : c.highGiftThreshold;
      el("aaOvertime").value = c.overtimeSeconds == null ? 30 : c.overtimeSeconds;
      el("aaNextDelay").value = c.nextRoundDelay == null ? 8 : c.nextRoundDelay;
      el("aaReward").value = c.robloxRewardCoins == null ? 0 : c.robloxRewardCoins;
      el("aaItemId").value = c.robloxItemId || "";
      el("aaItemName").value = c.robloxItemName || "";
      el("aaDeliveryMsg").value = c.deliveryMessageTemplate || "@{winner} prize delivered, tysm";
      renderAccounts(c.winnerAccounts || []);
    }
    setStatus("");
  });

  s.on("auto_auction_overtime", function (ev) {
    setStatus("Gift thật @" + ev.username + " +" + ev.coins + " xu → reset " + ev.overtime + "s");
  });
  s.on("auto_auction_delivery", function (ev) {
    setStatus(ev.ok ? "Roblox delivery OK." : "Roblox delivery ERROR: " + (ev.message || ""));
  });
  s.on("auto_auction_comment", function (ev) {
    setStatus(ev.ok ? "Broadcaster comment: " + ev.text : "Comment chưa gửi được: " + (ev.error || ""));
  });

  el("aaSave").onclick = function () {
    s.emit("update_config", {
      initialTime: Math.max(5, Number(el("aaRound").value) || 50),
      delay: Math.max(0, Number(el("aaDelay").value) || 25),
      highGiftOvertimeEnabled: true,
      highGiftThreshold: Math.max(1, Number(el("aaThreshold").value) || 100),
      overtimeSeconds: Math.max(1, Number(el("aaOvertime").value) || 30),
      autoNextRound: true,
      nextRoundDelay: Math.max(1, Number(el("aaNextDelay").value) || 8),
      robloxAwardEndpoint: "https://tranthag-auto-auction-test.floot.app/_api/roblox-award",
      robloxItemId: el("aaItemId").value.trim(),
      robloxItemName: el("aaItemName").value.trim(),
      robloxRewardCoins: Math.max(0, Number(el("aaReward").value) || 0),
      winnerAccounts: parseAccounts(),
      deliveryMessageTemplate: el("aaDeliveryMsg").value.trim(),
      autoTieEnabled: false
    });
    setStatus("Đã lưu cấu hình.");
  };

  el("aaStart").onclick = function () { s.emit("start_auction"); };
  el("aaReset").onclick = function () { s.emit("restart_auction"); };
  el("aaToggle").onclick = function () {
    var body = el("aaBody");
    var hidden = body.style.display === "none";
    body.style.display = hidden ? "" : "none";
    el("aaToggle").textContent = hidden ? "Ẩn" : "Hiện";
  };
})();