# codex_list

Plugin local/offline cho OpenClaw để quản lý profile **OpenAI Codex OAuth** ngay trong Telegram, **không gọi model AI/API** để xử lý command.

## Có gì trong bản 0.2.0
- `/codex_list` → xem toàn bộ profile Codex local
- `/codex_list <number>` → đổi profile primary
- `➕ ADD` / `/codex_list add` → mở flow OAuth local để thêm profile mới
- `✏️ NAME` / `/codex_list name` → hiện hướng dẫn đổi tên profile an toàn

## Flow nhanh
```text
/codex_list
/codex_list 2
/codex_list add
/codex_list name
/codex_list name 2 ten_cua_ban
```

## Ghi chú rename
- Chỉ rename được profile không phải profile đang active
- Nếu đang dùng đúng profile đó, hãy switch sang profile khác rồi quay lại đổi tên

## Cài nhanh
```bash
mkdir -p ~/.openclaw/extensions/codex-list
cp openclaw.plugin.json index.js ~/.openclaw/extensions/codex-list/
```

Bật plugin trong `~/.openclaw/openclaw.json`:

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

Restart gateway:
```bash
openclaw gateway restart
```

## Test tay
- [ ] `/codex_list` in đủ profile
- [ ] `/codex_list <number>` switch được primary
- [ ] Có nút `ADD` và `NAME` trên Telegram
- [ ] `/codex_list add` trả hướng dẫn OAuth local
- [ ] `/codex_list name` trả đúng ghi chú rename

## Files chính
- `openclaw.plugin.json`
- `index.js`
- `README.md`
- `install.sh`
