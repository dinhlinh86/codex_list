# codex_list

Offline local plugin cho OpenClaw để:
- liệt kê toàn bộ `openai-codex:*` trong local auth store
- đổi profile primary ngay từ Telegram bằng `/codex_list <number>`
- không gọi model AI để xử lý command

## Tính năng

- `/codex_list` → in danh sách profile Codex local
- `/codex_list <number>` → đẩy profile đã chọn lên đầu auth order
- Telegram inline buttons khi channel hỗ trợ
- Đọc dữ liệu từ local file `~/.openclaw/agents/<agent>/agent/auth-profiles.json`
- Switch bằng local CLI `openclaw models auth order set ...`

## Cấu trúc project

- `openclaw.plugin.json` — manifest plugin
- `index.js` — logic plugin

## Cách cài nhanh trên máy OpenClaw khác

### 1) Copy plugin vào extension folder

```bash
mkdir -p ~/.openclaw/extensions/codex-list
cp openclaw.plugin.json index.js ~/.openclaw/extensions/codex-list/
```

### 2) Bật plugin trong `~/.openclaw/openclaw.json`

Đảm bảo có:

```json
{
  "plugins": {
    "allow": ["telegram", "codex-list"],
    "entries": {
      "codex-list": { "enabled": true }
    }
  }
}
```

> Nếu máy đang có `plugins.allow`, chỉ cần thêm `codex-list` vào mảng hiện tại; đừng xoá plugin khác đang dùng.

### 3) Restart gateway

```bash
openclaw gateway restart
```

### 4) Test

Trong Telegram DM với bot:

```text
/codex_list
```

Đổi profile primary:

```text
/codex_list 2
```

## Prompt cài đặt cho OpenClaw khác

Có thể đưa prompt này cho một OpenClaw khác:

```text
Tạo plugin local tên codex-list cho OpenClaw, cài vào ~/.openclaw/extensions/codex-list.
Yêu cầu:
- command /codex_list chạy hoàn toàn local/offline, không gọi model AI
- đọc ~/.openclaw/agents/main/agent/auth-profiles.json
- liệt kê mọi key openai-codex:*
- hiển thị số thứ tự, profile id, account/email, trạng thái token, đánh dấu profile primary
- nếu là Telegram thì thêm inline buttons
- hỗ trợ /codex_list <number> để gọi local CLI:
  openclaw models auth order set --provider openai-codex <selected> <others...>
- bật plugin trong ~/.openclaw/openclaw.json rồi restart gateway
- test lại bằng /codex_list
```

## Ghi chú triển khai

- Plugin này không dùng API ngoài.
- Logic list dựa trên file auth local + auth order local.
- Nếu Telegram menu không hiện đúng command, kiểm tra thêm command scope cũ của bot (`all_private_chats`).

## Checklist test tay

- [ ] Có file `auth-profiles.json`
- [ ] `/codex_list` in đủ profile
- [ ] Nút Telegram hiện đúng
- [ ] `/codex_list <number>` switch được primary
- [ ] Chạy lại `/codex_list` thấy thứ tự đổi đúng
