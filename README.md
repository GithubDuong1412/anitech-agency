# Anitech Agency

Một đội agent mang tên nhân vật cho **Cursor**, cùng một dashboard Next.js để xem đội làm việc.
Cả hai được sinh ra từ **một nguồn dữ liệu duy nhất**: `agents/roster.json`.

| Nhân vật | Chức vụ | Rule trong Cursor | Agent nguồn (agency-agents) |
|---|---|---|---|
| Elio | CEO, điều phối | `@ceo-elio` | `specialized/agents-orchestrator.md` + `engineering/engineering-git-workflow-master.md` |
| Sasuke | Backend | `@sasuke-backend` | `engineering/engineering-backend-architect.md` |
| Luffy | Frontend | `@luffy-frontend` | `engineering/engineering-frontend-developer.md` |
| Gojo | Senior Developer | `@gojo-senior` | `engineering/engineering-senior-developer.md` |
| Natsu | Security | `@natsu-security` | `security/security-appsec-engineer.md` |
| Levi | Testing | `@levi-testing` | `testing/testing-test-automation-engineer.md` |
| Goku | Reality Checker | `@goku-reality` | `testing/testing-reality-checker.md` |

## Cấu trúc

```
agents/roster.json          nguồn duy nhất: id, tên, chức vụ, màu, từ khóa định tuyến, vị trí trên bản đồ, ảnh, agent upstream
agents/personas/<id>.md     persona tiếng Việt: giọng nói, phạm vi, quy tắc bàn giao
vendor/agency-agents/       bản copy cố định của 8 file upstream (diff được khi upstream đổi)
scripts/sync-agents.mjs     roster + persona + upstream  →  vendor/ + .cursor/rules/
.cursor/rules/              FILE SINH RA, không sửa tay
public/characters/<id>/     avatar.png, sprite.png
public/maps/                temple.png, center.png
src/                        dashboard (Next.js, Tailwind v4)
tests/                      Vitest
```

## Sử dụng

```bash
npm install
npm run sync:agents   # sinh lại .cursor/rules/*.mdc
npm run dev           # dashboard tại http://localhost:3000
npm test              # Vitest
npm run lint
npm run build
```

### Dùng đội trong Cursor

`00-anitech-team.mdc` luôn được áp dụng: nó cho Cursor biết đội có ai và cách giao việc. Gọi từng nhân vật bằng `@` trong chat, ví dụ `@ceo-elio sửa lỗi đăng nhập` để Elio chia việc, hoặc `@levi-testing viết test Playwright cho checkout`.

### Sửa đội

1. Sửa `agents/roster.json` (thêm/đổi nhân vật, từ khóa, agent upstream) hoặc `agents/personas/<id>.md`.
2. Chạy `npm run sync:agents`.
3. Không sửa tay `.cursor/rules/*.mdc` vì chúng bị ghi đè.

`sync-agents` đọc upstream từ biến môi trường `AGENCY_AGENTS_DIR` (mặc định `C:/laragon/www/agency-agents`), copy các file cần dùng vào `vendor/agency-agents/`, rồi ghép: frontmatter Cursor → persona → `## Kỹ năng: <tên agent>` → nội dung upstream (bỏ frontmatter của upstream). Nếu không có upstream thì dùng bản trong `vendor/`. Định dạng `.mdc` giống `convert_cursor` trong `agency-agents/scripts/convert.sh`.

## Dashboard

Dashboard là **bản mô phỏng**: hub, hội thoại giữa các agent và luồng duyệt việc chạy trên dữ liệu giả. Chỉ dùng Cursor thì không có LLM runtime để gọi. Mọi thông tin nhân vật (tên, màu, ảnh, vị trí trên bản đồ, từ khóa định tuyến) đều đọc từ `agents/roster.json` qua `src/lib/roster.ts`.

- `src/lib/routing.ts`: gợi ý người phụ trách (`recommendAgent`) và người liên quan (`relevantAgents`) từ từ khóa trong roster. Từ khóa khớp ở đầu từ; người nhiều từ khóa khớp nhất thắng, hòa thì theo thứ tự trong roster; không khớp thì giao cho Senior Developer.
- `src/lib/tasks.ts`, `src/lib/hub.ts`: vòng đời task và hub mô phỏng.
- `src/i18n`: 5 ngôn ngữ (vi, en, es, fr, zh-CN).
