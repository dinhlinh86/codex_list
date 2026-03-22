# codex-list

Plugin local/offline cho OpenClaw để quản lý OpenAI Codex OAuth profiles. Các command xử lý local, không gọi model AI/API để chạy flow.

## Lệnh

```text
/codex_list
/codex_list <number>
/codex_list name <number> <ten_moi>
/codexadd
/vr <callback_url>
```

## Flow nhanh

1. `/codex_list` → xem profile
2. `/codex_list 2` → đổi primary
3. `/codex_list name 2 ten_moi` → đổi tên local
4. `/codexadd` → lấy OAuth URL
5. `/vr http://localhost:1455/auth/callback?...` → verify callback

## File chính

- `openclaw.plugin.json`
- `index.js`
- `oauth-helper.py`

## Tương thích

Dùng được trên **macOS** và **Linux** nếu máy có đủ:
- `python3`
- `node`
- `expect`

Helper hiện đã có fallback khi shim `openclaw` trong PATH bị hỏng; nó có thể gọi thẳng `node .../dist/index.js`.

## Prompt cài cho OpenClaw khác

### Bản điền sẵn cho `v0.2.0`

```text
Cài plugin `codex-list` phiên bản `v0.2.0` từ repo `https://github.com/dinhlinh86/codex_list` cho máy OpenClaw này.

Yêu cầu:
1. Clone đúng tag `v0.2.0` từ repo `https://github.com/dinhlinh86/codex_list`.
2. Copy các file sau vào `~/.openclaw/extensions/codex-list/`:
   - `openclaw.plugin.json`
   - `index.js`
   - `oauth-helper.py`
   - `README.md`
3. Đảm bảo `oauth-helper.py` có quyền chạy (`chmod +x`).
4. Kiểm tra máy có đủ dependency:
   - `python3`
   - `node`
   - `expect`
5. Bật plugin `codex-list` trong `~/.openclaw/openclaw.json`:
   - thêm `codex-list` vào `plugins.allow`
   - thêm `plugins.entries.codex-list.enabled = true`
6. Restart gateway.
7. Test local commands:
   - `/codex_list`
   - `/codexadd`
   - `/vr <callback_url>`
8. Nếu có flow OAuth cũ bị treo thì dọn:
   - `~/.openclaw/extensions/codex-list/oauth-state.json`
   - `~/.openclaw/extensions/codex-list/oauth-runtime/*`
9. Xác nhận plugin chạy local/offline, không rơi sang model AI cho các command trên.

Lưu ý:
- Phải giữ nguyên command names hiện tại:
  - `/codex_list`
  - `/codexadd`
  - `/vr`
- Nếu shim `openclaw` trong PATH bị lỗi, ưu tiên fallback sang `node .../dist/index.js`.
```

### Mẫu tổng quát

```text
Cài plugin `codex-list` phiên bản <VERSION> từ repo <REPO_URL> cho máy OpenClaw này.

Yêu cầu:
1. Clone đúng version/tag/commit <VERSION>.
2. Copy các file sau vào `~/.openclaw/extensions/codex-list/`:
   - `openclaw.plugin.json`
   - `index.js`
   - `oauth-helper.py`
   - `README.md`
3. Đảm bảo `oauth-helper.py` có quyền chạy (`chmod +x`).
4. Kiểm tra máy có đủ dependency:
   - `python3`
   - `node`
   - `expect`
5. Bật plugin `codex-list` trong `~/.openclaw/openclaw.json`:
   - thêm `codex-list` vào `plugins.allow`
   - thêm `plugins.entries.codex-list.enabled = true`
6. Restart gateway.
7. Test local commands:
   - `/codex_list`
   - `/codexadd`
   - `/vr <callback_url>`
8. Nếu có flow OAuth cũ bị treo thì dọn:
   - `~/.openclaw/extensions/codex-list/oauth-state.json`
   - `~/.openclaw/extensions/codex-list/oauth-runtime/*`
9. Xác nhận plugin chạy local/offline, không rơi sang model AI cho các command trên.
```
