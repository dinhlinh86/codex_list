# codex-list

Plugin local cho OpenClaw để quản lý **OpenAI Codex OAuth profiles**.

🍎 macOS · 🐧 Linux · 🐳 Docker

## Demo

![codex-list demo](assets/codex-list-demo-white-v2.jpg)

## Công dụng

- xem danh sách profile Codex local
- đổi profile primary nhanh
- đổi tên profile local
- xóa profile local
- add profile mới bằng OAuth
- verify callback OAuth ngay trong chat

## Lệnh

```text
/codex_list
/codex_list <number>
/codexname <number> <ten_moi>
/codexdel <number>
/codexadd
/vr <callback_url>
```

> Ghi chú: `HEALTH` đang tạm tắt để sửa tiếp.

## Cài bằng prompt cho OpenClaw khác

Dán nguyên prompt này cho máy OpenClaw cần cài:

```text
Cài plugin `codex-list` từ repo `https://github.com/dinhlinh86/codex_list` cho máy OpenClaw này.

Yêu cầu:
1. Clone repo về máy local.
2. Copy các file sau vào `~/.openclaw/extensions/codex-list/`:
   - `openclaw.plugin.json`
   - `index.js`
   - `oauth-helper.py`
   - `README.md`
3. Đảm bảo `oauth-helper.py` có quyền chạy:
   chmod +x ~/.openclaw/extensions/codex-list/oauth-helper.py
4. Bật plugin `codex-list` trong `~/.openclaw/openclaw.json`:
   - thêm `codex-list` vào `plugins.allow`
   - thêm `plugins.entries.codex-list.enabled = true`
5. Restart gateway.
6. Test các lệnh:
   - `/codex_list`
   - `/codexadd`
   - `/vr <callback_url>`
   - `/codexname <number> <ten_moi>`
   - `/codexdel <number>`
7. Nếu có file runtime cũ bị kẹt thì dọn:
   - `~/.openclaw/extensions/codex-list/oauth-state.json`
   - `~/.openclaw/extensions/codex-list/oauth-runtime/`

Lưu ý:
- Plugin này không phụ thuộc `expect`.
- Flow OAuth hiện tại dùng HTTP token exchange trực tiếp.
- `HEALTH` hiện đang tạm tắt.
```
