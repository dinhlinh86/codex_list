# codex-list

Plugin local cho OpenClaw để quản lý **OpenAI Codex OAuth profiles**.

Mục tiêu của plugin này là:
- list / switch profile Codex nhanh
- rename / delete profile local
- add profile mới bằng OAuth
- chạy **local/offline cho phần command flow**, không cần gọi model AI để xử lý logic command
- **không phụ thuộc `expect`**

## Tính năng

- `/codex_list` — xem danh sách profile Codex local
- `/codex_list <number>` — đổi profile primary
- `/codexname <number> <ten_moi>` — đổi tên profile local
- `/codexdel <number>` — xóa profile local theo số thứ tự
- `/codexadd` — bắt đầu flow add OAuth
- `/vr <callback_url>` — hoàn tất verify callback OAuth

## Lưu ý hiện tại

- `HEALTH` đang **tạm tắt** để chỉnh lại cho chuẩn hơn, nên README này **không xem health là tính năng stable**.
- Plugin hiện dùng flow **OAuth code exchange trực tiếp qua HTTP**, không bơm callback ngược vào terminal interactive.

## Flow OAuth hiện tại

### 1. Bắt đầu add

```text
/codexadd
```

Plugin sẽ tạo OAuth URL và đồng thời ghi fallback file tại:

```text
~/.openclaw/extensions/codex-list/oauth-runtime/codexadd-oauth-link.txt
```

Nếu chat render link không đẹp, chỉ cần mở file đó để lấy link.

### 2. Login trên browser local

Sau khi login xong, browser sẽ redirect về dạng:

```text
http://localhost:1455/auth/callback?code=...&state=...
```

### 3. Gửi callback lại cho plugin

```text
/vr http://localhost:1455/auth/callback?code=...&state=...
```

Plugin sẽ:
- parse `code` + `state`
- exchange token tại `https://auth.openai.com/oauth/token`
- ghi profile mới vào `~/.openclaw/agents/<agent>/agent/auth-profiles.json`

## Các lệnh

```text
/codex_list
/codex_list <number>
/codexname <number> <ten_moi>
/codexdel <number>
/codexadd
/vr <callback_url>
```

### Ví dụ

```text
/codex_list
/codex_list 2
/codexname 2 team_main
/codexdel 5
/codexadd
/vr http://localhost:1455/auth/callback?code=...&state=...
```

## Cài đặt

Copy các file sau vào:

```text
~/.openclaw/extensions/codex-list/
```

Files cần có:
- `openclaw.plugin.json`
- `index.js`
- `oauth-helper.py`
- `README.md`

Cấp quyền chạy cho helper:

```bash
chmod +x ~/.openclaw/extensions/codex-list/oauth-helper.py
```

Bật plugin trong `~/.openclaw/openclaw.json`:
- thêm `codex-list` vào `plugins.allow`
- bật `plugins.entries.codex-list.enabled = true`

Sau đó restart gateway.

## Yêu cầu môi trường

- `node`
- `python3`
- OpenClaw đã chạy được bình thường

**Không cần:**
- `expect`
- `tmux`
- sudo chỉ để dùng plugin

## File runtime

Plugin dùng thêm các file runtime sau:

- `~/.openclaw/extensions/codex-list/oauth-state.json`
- `~/.openclaw/extensions/codex-list/oauth-runtime/`
- `~/.openclaw/extensions/codex-list/oauth-runtime/codexadd-oauth-link.txt`

## Hành vi rename / delete

### Rename
- chỉ rename profile **không phải profile đang active**
- command:

```text
/codexname <number> <ten_moi>
```

### Delete
- chỉ xóa profile **không phải profile đang active**
- command:

```text
/codexdel <number>
```

## Khả năng tương thích

Đã được thiết kế theo hướng chạy trên:
- macOS
- Ubuntu / Linux
- môi trường nghèo kiểu VPS / Docker

Điểm quan trọng là plugin **không còn phụ thuộc `expect`** như hướng cũ.

## Ghi chú kỹ thuật

Flow hiện tại dùng:
- PKCE (`code_verifier` / `code_challenge`)
- OAuth authorize URL từ `auth.openai.com`
- token exchange trực tiếp qua HTTP
- local auth store của OpenClaw

Điều này giúp flow ổn định hơn so với cách giữ terminal interactive sống rồi feed callback ngược vào CLI.

## Trạng thái project

Bản hiện tại phù hợp để public repo và tiếp tục iterate.

Các hướng còn có thể làm tiếp:
- HEALTH / quota đẹp hơn
- import / export profile
- cleanup tools cho profile cũ / stale
