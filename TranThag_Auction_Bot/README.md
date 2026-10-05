# TranThag TikTok LIVE Auction Bot

Backend Node.js cho TikTok LIVE auction, giữ Browser Source:

`http://localhost:3000/widget.html`

## Có sẵn

- Express HTTP server
- Socket.IO realtime
- raw WebSocket bridge tại `ws://localhost:3000/`
- `tiktok-live-connector`
- tự bắt đầu round khi LIVE kết nối
- MAIN 50 giây
- FINAL 25 giây
- gift hợp lệ >= 100 xu
- gift hợp lệ trong FINAL reset FINAL về 30 giây
- TOP BIDDER theo tổng xu
- tự chốt winner
- winner gửi `!rb RobloxUsername` trong chat
- Roblox Open Cloud MessagingService delivery
- `deliveryId` chống phát trùng
- auto next round
- acc phụ nằm riêng trong config, test-only

## Cài đặt

Yêu cầu Node.js 20+.

1. Tải project.
2. Mở thư mục `TranThag_Auction_Bot`.
3. Copy `.env.example` thành `.env`.
4. Sửa:

```env
TIKTOK_USERNAME=ten_tiktok_live_cua_ban
```

5. Chạy:

```bat
START.bat
```

hoặc:

```bash
npm install
npm start
```

6. Browser Source:

`http://localhost:3000/widget.html`

## Giữ nguyên UI RCKZ / ANBEO cũ

Không cần sửa widget cũ.

Chép nguyên resource vào:

`legacy-public/`

Ví dụ:

```text
legacy-public/
  widget.html
  css/
  js/
  images/
  sounds/
```

Server ưu tiên `legacy-public` trước widget fallback.

Nếu widget cũ đang dùng:

`ws://localhost:3000/`

thì bridge raw WebSocket vẫn hoạt động.

State envelope:

```json
{"type":"state","state":{}}
```

Event envelope:

```json
{"type":"auction:bid","data":{}}
```

Nếu source UI cũ dùng field/event khác, chỉ map lại trong:
`src/RealtimeHub.js`.

## Test gift local

Trong `.env`:

```env
ALLOW_TEST_API=true
ADMIN_TOKEN=abc123
```

POST:

`http://localhost:3000/api/test/gift`

Headers:

`x-admin-token: abc123`

Body:

```json
{"username":"test_user","coins":150}
```

Tắt `ALLOW_TEST_API` trước khi dùng LIVE thật.

## Roblox

Ban đầu để:

```env
ROBLOX_DELIVERY_ENABLED=false
ROBLOX_DRY_RUN=true
```

Sau khi test xong:

```env
ROBLOX_DELIVERY_ENABLED=true
ROBLOX_DRY_RUN=false
ROBLOX_UNIVERSE_ID=YOUR_UNIVERSE_ID
ROBLOX_OPEN_CLOUD_API_KEY=YOUR_API_KEY
ROBLOX_TOPIC=auction-awards-v1
```

Copy:

`roblox/AuctionDelivery.server.lua`

vào `ServerScriptService`.

Sau đó sửa `AwardCatalog` trong Lua và:
`config/auction-awards-v1.json`

để trùng item key trong game của bạn.

Không lưu `.ROBLOSECURITY`, password Roblox hoặc password TikTok trong config.

## Luồng

```text
TikTok LIVE connected
        |
        v
      MAIN 50s
        |
        v
     FINAL 25s
        |
        +-- gift >=100 --> FINAL reset 30s
        |
        v
    chốt TOP 1
        |
        v
winner gửi !rb RobloxUsername
        |
        v
Open Cloud publishMessage
        |
        v
Roblox SubscribeAsync
        |
        v
UpdateAsync + deliveryId receipt
        |
        v
   auto next round
```
