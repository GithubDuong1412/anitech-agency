# Anitech Agency

Đội agent mang tên nhân vật, dùng được ở hai nơi:

1. **Cursor**: mỗi nhân vật là một rule `.mdc`, gọi bằng `@` trong chat.
2. **Dashboard Next.js**: các nhân vật đứng trên bản đồ, trao đổi trong một thread để làm task bạn giao, rồi gửi kết quả cho bạn duyệt.

Cả hai đọc từ cùng một nguồn dữ liệu: `agents/roster.json` (phòng IT) và `agents/roster-social.json` (phòng Social Marketing).

## Đội

### IT

| Nhân vật | Chức vụ | Rule trong Cursor | Agent nguồn (agency-agents) |
|---|---|---|---|
| Elio | CEO, điều phối | `@ceo-elio` | `specialized/agents-orchestrator.md` + `engineering/engineering-git-workflow-master.md` |
| Sasuke | Backend | `@sasuke-backend` | `engineering/engineering-backend-architect.md` |
| Luffy | Frontend | `@luffy-frontend` | `engineering/engineering-frontend-developer.md` |
| Gojo | Senior Developer | `@gojo-senior` | `engineering/engineering-senior-developer.md` |
| Natsu | Security | `@natsu-security` | `security/security-appsec-engineer.md` |
| Levi | Testing | `@levi-testing` | `testing/testing-test-automation-engineer.md` |
| Goku | Reality Checker, người nghiệm thu | `@goku-reality` | `testing/testing-reality-checker.md` |

### Social Marketing

| Nhân vật | Chức vụ | Rule trong Cursor | Agent nguồn (agency-agents) |
|---|---|---|---|
| Dương Hạo Tử | Trưởng phòng, điều phối | `@hao-tu-lead` | `specialized/agents-orchestrator.md` |
| Quan Thế Âm | Chiến lược, người nghiệm thu | `@quan-am-director` | `marketing/marketing-social-media-strategist.md` |
| Tôn Ngộ Không | Săn xu hướng | `@ngo-khong-trend` | `product/product-trend-researcher.md` |
| Như Lai | Tạo ảnh AI | `@phat-to-image` | `design/design-image-prompt-engineer.md` |
| Bạch Long Mã | Carousel | `@bach-long-ma-carousel` | `marketing/marketing-carousel-growth-engine.md` |
| Chư Bát Giới | Quảng cáo | `@bat-gioi-ads` | `paid-media/paid-media-creative-strategist.md` |
| Sa Tăng | Cộng đồng | `@sa-tang-community` | `marketing/marketing-content-creator.md` + `support/support-analytics-reporter.md` |
| Đường Tăng | Viết nội dung | `@duong-tang-copy` | `marketing/marketing-content-creator.md` |

## Cấu trúc

```
agents/roster.json            phòng IT: id, tên, chức vụ, màu, từ khóa định tuyến, vị trí trên bản đồ, ảnh, agent upstream
agents/roster-social.json     phòng Social, cùng định dạng
agents/personas/<id>.md       persona tiếng Việt: giọng nói, phạm vi, quy tắc bàn giao
vendor/agency-agents/         bản copy cố định của các file upstream (diff được khi upstream đổi)
scripts/sync-agents.mjs       roster + persona + upstream  →  vendor/ + .cursor/rules/
scripts/import-sqlite-to-mysql.mjs   chuyển dữ liệu SQLite cũ sang MySQL
.cursor/rules/                FILE SINH RA, không sửa tay
public/characters*/<id>/      avatar.png, sprite.png
public/maps/                  ảnh bản đồ của từng phòng
src/lib/                      logic dùng chung cho client và server
src/server/                   orchestrator, LLM client, database, bảo mật (chỉ chạy trên server)
src/app/api/                  route API
src/components/               giao diện dashboard
src/i18n/                     5 ngôn ngữ: vi, en, es, fr, zh-CN
tests/                        Vitest
run_agency.py                 tranh luận Sasuke/Natsu qua LM Studio (AutoGen), chạy riêng
```

## Sử dụng

```bash
npm install
cp .env.example .env.local   # rồi điền giá trị, xem mục Cấu hình
npm run sync:agents          # sinh lại .cursor/rules/*.mdc
npm run dev                  # dashboard tại http://localhost:3000
npm test                     # Vitest
npm run typecheck
npm run lint
npm run build
```

### Dùng đội trong Cursor

`00-anitech-team.mdc` luôn được áp dụng: nó cho Cursor biết đội có ai và cách giao việc. Gọi từng nhân vật bằng `@` trong chat, ví dụ `@ceo-elio sửa lỗi đăng nhập` để Elio chia việc, hoặc `@levi-testing viết test Playwright cho checkout`.

### Sửa đội

1. Sửa `agents/roster*.json` (thêm/đổi nhân vật, từ khóa, agent upstream) hoặc `agents/personas/<id>.md`.
2. Chạy `npm run sync:agents`.
3. Không sửa tay `.cursor/rules/*.mdc` vì chúng bị ghi đè.

`sync-agents` đọc upstream từ biến môi trường `AGENCY_AGENTS_DIR` (mặc định `C:/laragon/www/agency-agents`), copy các file cần dùng vào `vendor/agency-agents/`, rồi ghép: frontmatter Cursor → persona → `## Kỹ năng: <tên agent>` → nội dung upstream (bỏ frontmatter của upstream). Nếu không có upstream thì dùng bản trong `vendor/`. Định dạng `.mdc` giống `convert_cursor` trong `agency-agents/scripts/convert.sh`.

## Dashboard

Mỗi phòng có bản đồ, hàng đợi task, thùng rác và hub hội thoại riêng. Thông tin nhân vật (tên, màu, ảnh, vị trí, từ khóa) đọc từ roster qua `src/lib/roster.ts`.

### Một task chạy thế nào

`src/server/orchestrator.ts` chạy task qua các bước:

1. **Giao việc**: `src/lib/routing.ts` gợi ý owner và tối đa 3 người liên quan theo từ khóa trong roster. Từ khóa khớp ở đầu từ; người khớp nhiều từ khóa nhất thắng, hòa thì theo thứ tự trong roster; không khớp ai thì giao cho người mặc định của phòng (IT: Gojo, Social: Đường Tăng).
2. **Kế hoạch**: owner viết plan và có thể gọi tên đồng đội cần hỏi.
3. **Thảo luận**: từng đồng đội bổ sung ý theo đúng vai, tối đa 2 lượt mỗi người. Trưởng phòng và người nghiệm thu không nói ở bước này.
4. **Tổng kết**: owner chốt kết quả.
5. **Nghiệm thu**: Goku (IT) hoặc Quan Thế Âm (Social) review, task chuyển sang `review`.
6. **Duyệt**: bạn phê duyệt (task `complete`, thread đóng) hoặc yêu cầu sửa (owner viết lại, review lại). Trưởng phòng ghi quyết định.

Tổng số lượt nói mỗi task bị giới hạn bởi `LLM_MAX_TURNS`. Mỗi agent dùng rule `.mdc` của chính mình làm system prompt (`src/server/persona.ts`). Nội dung task chỉ nằm trong user message và được bỏ ký tự `<` `>` để không thoát khỏi thẻ.

Nếu model lỗi, task chuyển sang `failed` và thread hiện thông báo lỗi. Nút **Retry** chạy tiếp trên cùng thread và bỏ qua các bước đã có.

Task xóa sẽ vào **thùng rác** (phải gõ đúng `delete task` để xác nhận). Từ thùng rác có thể khôi phục hoặc xóa hẳn cả task lẫn thread.

### Chế độ AI và chế độ demo

- **AI**: khi có `LLM_API_KEY` và phòng đó nằm trong `LLM_DEPARTMENTS` (hoặc biến này để trống). Dùng được mọi endpoint tương thích OpenAI, kể cả LM Studio.
- **Demo**: khi không có key. Pipeline vẫn y như trên nhưng câu trả lời lấy từ câu viết sẵn trong i18n, và vẫn được lưu vào database.

`GET /api/health` cho biết từng phòng đang chạy chế độ nào, dùng model gì và đang dùng database nào. Route này không trả về khóa.

### Lưu trữ

- **MySQL** (khuyên dùng, Laragon): khi `DB_HOST` có giá trị. Một database chung cho mọi phòng, các dòng tách theo `department_id`. Schema ở `src/server/mysql.schema.sql`.
- **SQLite** (dự phòng): khi `DB_HOST` để trống. Mỗi phòng một file `data/<id>.db`, hoặc trong `DATA_DIR` nếu có đặt.

Mọi tin nhắn được lưu trước khi stream (NDJSON) về trình duyệt, nên đóng tab giữa chừng thì task vẫn chạy tiếp và tải lại trang sẽ thấy kết quả.

### Bảo mật

Các route ghi dữ liệu chỉ nhận request cùng origin, giới hạn 12 task mỗi phút cho mỗi client, chỉ cho một task chạy cùng lúc trong mỗi phòng, và giới hạn kích thước body. Bộ giới hạn tần suất và khóa nằm trong bộ nhớ, chỉ đúng khi chạy một process.

## Cấu hình

Copy `.env.example` thành `.env.local`. Các biến chính:

| Biến | Ý nghĩa | Mặc định |
|---|---|---|
| `LLM_API_KEY` | Khóa API. Để trống thì chạy chế độ demo | |
| `LLM_BASE_URL` | Endpoint tương thích OpenAI | `https://api.openai.com/v1` |
| `LLM_MODEL` | Model dùng chung | `gpt-4o-mini` |
| `LLM_MODEL_<PHÒNG>` | Model riêng cho một phòng, ví dụ `LLM_MODEL_SOCIAL`. Không có thì dùng `LLM_MODEL` | |
| `LLM_DEPARTMENTS` | Danh sách phòng được gọi model, ví dụ `it,social`. Để trống là mọi phòng | |
| `LLM_JSON_MODE` | Đặt `false` nếu provider không nhận `response_format` | `true` |
| `LLM_MAX_TOKENS` | Token tối đa mỗi lượt (tối đa 4000) | `700` |
| `LLM_TIMEOUT_MS` | Timeout mỗi request (tối đa 120000) | `45000` |
| `LLM_MAX_TURNS` | Tổng lượt nói mỗi task (3 đến 16) | `8` |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Kết nối MySQL | `3306`, `root`, rỗng, `anitech_agency` |
| `DATA_DIR` | Thư mục SQLite khi không dùng MySQL | `./data` |

Ví dụ dùng LM Studio trên máy này:

```env
LLM_API_KEY=lm-studio
LLM_BASE_URL=http://127.0.0.1:1234/v1
LLM_MODEL=qwen2.5-coder-14b
LLM_MODEL_SOCIAL=meta-llama-3.1-8b-instruct
LLM_JSON_MODE=false
LLM_DEPARTMENTS=it,social
```

Đã có dữ liệu trong SQLite và muốn chuyển sang MySQL thì chạy `npm run db:import`.

## Tranh luận local (LM Studio)

`run_agency.py` là runtime riêng, không gắn vào dashboard. Sasuke (Backend) và Natsu (AppSec) tranh luận tối đa 6 lượt qua LM Studio. System prompt của mỗi người là persona trong `agents/personas/` cộng file kỹ năng trong `vendor/agency-agents/`.

1. Mở LM Studio, load model, bật local server cổng **1234**. Context nên khoảng **16384** vì prompt gồm cả file kỹ năng.
2. Tạo môi trường và cài thư viện (một lần):

```bash
python -m venv venv
source venv/Scripts/activate   # Git Bash
# PowerShell: .\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

3. Chạy. Không truyền đối số thì đề tài mặc định là thiết kế JWT:

```bash
python run_agency.py
python run_agency.py "đề tài khác"
```

Model mặc định là `qwen2.5-coder-14b`. Đổi model hoặc URL bằng `LMSTUDIO_MODEL` và `LMSTUDIO_BASE_URL`. Các biến này chỉ dùng cho `run_agency.py`; dashboard dùng các biến `LLM_*` ở mục Cấu hình.
