"""Sasuke và Natsu tranh luận qua LM Studio bằng AutoGen GroupChat.

Cần LM Studio local server (mặc định http://localhost:1234/v1) và model đã load.
Context nên khoảng 16384 vì system prompt gồm persona cộng file kỹ năng.
"""

import os
import sys
from pathlib import Path

from autogen import AssistantAgent, GroupChat, GroupChatManager

ROOT = Path(__file__).resolve().parent
RULES = ROOT / "vendor" / "agency-agents"
PERSONAS = ROOT / "agents" / "personas"

DEFAULT_TOPIC = (
    "Hãy thiết kế cơ chế Authentication dùng JWT cho ứng dụng. "
    "Đưa ra giải pháp chi tiết để AppSec Engineer phản biện."
)

DEBATE_RULES = """
## Cách tranh luận
- Trả lời bằng tiếng Việt.
- Phản hồi đúng ý người vừa nói. Không nhắc lại nguyên văn vai trò của mình.
- Sasuke đề xuất thiết kế cụ thể: luồng, nơi lưu khóa, thời hạn token, refresh.
- Natsu phản biện theo mức Critical/High/Medium/Low và cách sửa.
- Ở lượt cuối, nếu đã đủ ý, kết bằng hai mục: "Phương án chốt" và "Rủi ro còn lại".
""".strip()


def load_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def strip_frontmatter(text: str) -> str:
    if not text.startswith("---"):
        return text
    end = text.find("\n---", 3)
    if end == -1:
        return text
    return text[end + 4 :].lstrip()


def system_message(persona_file: str, skill_file: str) -> str:
    persona = load_text(PERSONAS / persona_file).strip()
    skill = strip_frontmatter(load_text(RULES / skill_file)).strip()
    return f"{persona}\n\n## Kỹ năng\n\n{skill}\n\n{DEBATE_RULES}\n"


def llm_config() -> dict:
    return {
        "config_list": [
            {
                "model": os.environ.get("LMSTUDIO_MODEL", "qwen2.5-coder-14b"),
                "base_url": os.environ.get("LMSTUDIO_BASE_URL", "http://localhost:1234/v1"),
                "api_key": "lm-studio",
                "price": [0, 0],
            }
        ],
        "temperature": 0.7,
    }


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    topic = " ".join(sys.argv[1:]).strip() or DEFAULT_TOPIC
    config = llm_config()

    sasuke = AssistantAgent(
        name="Sasuke",
        description="Backend Architect. Đề xuất thiết kế API, schema và cơ chế xác thực.",
        system_message=system_message(
            "sasuke.md",
            "engineering/engineering-backend-architect.md",
        ),
        llm_config=config,
    )
    natsu = AssistantAgent(
        name="Natsu",
        description="Application Security Engineer. Phản biện lỗ hổng và mức độ rủi ro.",
        system_message=system_message(
            "natsu.md",
            "security/security-appsec-engineer.md",
        ),
        llm_config=config,
    )

    group_chat = GroupChat(
        agents=[sasuke, natsu],
        messages=[],
        max_round=6,
        speaker_selection_method="round_robin",
        allow_repeat_speaker=False,
    )
    manager = GroupChatManager(groupchat=group_chat, llm_config=config)

    sasuke.initiate_chat(manager, message=topic)


if __name__ == "__main__":
    main()
