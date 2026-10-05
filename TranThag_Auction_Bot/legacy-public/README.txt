Đặt NGUYÊN bộ widget cũ của bạn vào thư mục này.

Ví dụ:
legacy-public/widget.html
legacy-public/css/...
legacy-public/js/...
legacy-public/images/...
legacy-public/sounds/...

Server ưu tiên legacy-public trước fallback-public, nên URL vẫn:
http://localhost:3000/widget.html

Nếu widget cũ dùng raw WebSocket tại ws://localhost:3000/
bridge tương thích đã được bật sẵn.
