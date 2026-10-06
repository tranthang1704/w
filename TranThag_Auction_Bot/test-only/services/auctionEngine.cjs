class AuctionEngine {
    constructor(io, config, robloxService) {
        this.io = io;
        this.config = config;
        this.robloxService = robloxService;
        
        this.currentRound = 0;
        this.timer = config.auction.mainRoundDuration;
        this.phase = 'MAIN'; // 'MAIN' | 'FINAL' | 'SUMMARY'
        this.isFinalActive = false;
        this.interval = null;

        this.minCoinThreshold = config.auction.minCoinThreshold || 100;
        this.subAccounts = config.subAccounts || [];

        // Trạng thái người dẫn đầu hiện tại
        this.currentLeader = {
            username: 'Chưa có',
            nickname: 'System',
            coins: 0,
            isDummy: true,
            robloxUsername: null
        };
        this.bidsHistory = [];
    }

    startNewRound() {
        this.currentRound++;
        this.timer = this.config.auction.mainRoundDuration;
        this.phase = 'MAIN';
        this.isFinalActive = false;
        this.bidsHistory = [];

        // Chọn ngẫu nhiên 1 trong 4 acc phụ làm mồi nhử khởi tạo đầu vòng
        const randomDummy = this.getRandomSubAccount();
        this.currentLeader = {
            username: randomDummy.username,
            nickname: 'Dummy Bidder',
            coins: 50,
            isDummy: true,
            robloxUsername: randomDummy.robloxUsername
        };

        console.log(`[Auction Engine] Bắt đầu Vòng #${this.currentRound}. Acc phụ [${this.currentLeader.username} - Roblox: ${this.currentLeader.robloxUsername}] khởi tạo giữ nhịp.`);
        this.io.emit('auctionUpdate', this.getState());

        this.startTimer();
    }

    getRandomSubAccount() {
        if (!this.subAccounts || this.subAccounts.length === 0) {
            return { username: 'Default_Bot', robloxUsername: 'DefaultRobloxName' };
        }
        const randomIndex = Math.floor(Math.random() * this.subAccounts.length);
        return this.subAccounts[randomIndex];
    }

    startTimer() {
        if (this.interval) clearInterval(this.interval);

        this.interval = setInterval(() => {
            this.timer--;

            // Khi KHÔNG có ai gift >= 100 xu, đến mốc 20 giây chọn ngẫu nhiên 1 trong 4 acc phụ đẩy bid tạo winner giả
            if (this.timer === 20 && this.currentLeader.isDummy) {
                this.executeDummyWinnerSelection();
            }

            // Kích hoạt vòng FINAL khi còn 10 giây cuối
            if (this.timer === 10 && !this.isFinalActive) {
                this.activateFinalPhase();
            }

            // Hết giờ vòng đấu giá -> Tổng kết
            if (this.timer <= 0) {
                clearInterval(this.interval);
                this.concludeRound();
            }

            this.io.emit('timerUpdate', { timer: this.timer, phase: this.phase });
        }, 1000);
    }

    activateFinalPhase() {
        this.isFinalActive = true;
        this.phase = 'FINAL';
        this.timer += this.config.auction.finalRoundDuration; // Cộng thêm 25 giây vòng FINAL
        console.log(`[Auction Engine] Chuyển sang VÒNG FINAL (+25s chốt đơn)!`);
        this.io.emit('phaseChange', { phase: 'FINAL', timer: this.timer });
    }

    // Xử lý khi có người chơi thật gift >= 100 xu
    handleRealBid(bidData) {
        if (bidData.coins < this.minCoinThreshold) {
            console.log(`[Filter] Bỏ qua gift ${bidData.giftName} từ ${bidData.username} vì dưới ${this.minCoinThreshold} xu (${bidData.coins} xu).`);
            return;
        }

        console.log(`[Real Bid Valid] Nhận bid thật từ ${bidData.username}: ${bidData.coins} xu (${bidData.giftName})`);

        const existingBidIndex = this.bidsHistory.findIndex(b => b.username === bidData.username);
        let totalUserCoins = bidData.coins;

        if (existingBidIndex !== -1) {
            this.bidsHistory[existingBidIndex].coins += bidData.coins;
            totalUserCoins = this.bidsHistory[existingBidIndex].coins;
        } else {
            this.bidsHistory.push(bidData);
        }

        this.currentLeader = {
            username: bidData.username,
            nickname: bidData.nickname || bidData.username,
            coins: totalUserCoins,
            isDummy: false,
            robloxUsername: null
        };

        if (this.timer < 15 && !this.isFinalActive) {
            this.activateFinalPhase();
        }

        this.io.emit('auctionUpdate', this.getState());
    }

    // Chọn ngẫu nhiên 1 trong 4 acc phụ làm winner giả khi thiếu gift thật
    executeDummyWinnerSelection() {
        const dummy = this.getRandomSubAccount();
        const increment = Math.floor(Math.random() * 200) + 150; // Tăng ngẫu nhiên 150-350 xu

        this.currentLeader = {
            username: dummy.username,
            nickname: 'Top Supporter',
            coins: this.currentLeader.coins + increment,
            isDummy: true,
            robloxUsername: dummy.robloxUsername
        };

        console.log(`[Dummy Engine] Không có gift thật >= 100 xu. Chọn ngẫu nhiên acc phụ [${dummy.username}] thắng giả với ${this.currentLeader.coins} xu.`);
        
        // Tự động kích hoạt comment tên Ingame Roblox của acc phụ lên live chat
        this.robloxService.simulateIngameComment(dummy);

        this.io.emit('auctionUpdate', this.getState());
    }

    async concludeRound() {
        this.phase = 'SUMMARY';
        console.log(`[Auction Engine] Tổng kết Vòng #${this.currentRound}. Người thắng: ${this.currentLeader.username} (${this.currentLeader.coins} xu) - Là Dummy: ${this.currentLeader.isDummy}`);
        
        this.io.emit('auctionSummary', this.getState());

        // Phân phối phần thưởng và kích hoạt Vouch / Comment xác nhận
        if (this.currentLeader.isDummy) {
            await this.robloxService.handleDummyWinnerVouch(this.currentLeader);
        } else {
            await this.robloxService.deliverReward(this.currentLeader, this.currentLeader.coins);
        }

        // Tự động chuyển sang vòng tiếp theo sau 5 giây tổng kết
        setTimeout(() => {
            this.startNewRound();
        }, 5000);
    }

    getState() {
        return {
            round: this.currentRound,
            timer: this.timer,
            phase: this.phase,
            leader: this.currentLeader,
            bidsHistory: this.bidsHistory
        };
    }
}

module.exports = AuctionEngine;
