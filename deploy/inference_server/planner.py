"""SAP (Standardized Action Procedure) module for NaVILA.

Implements the Planner-Executor-Verifier loop:
- Planner: VLM decomposes instruction into subtask sequence
- Verifier: VLM checks subtask completion every N steps
- State machine: manages subtask transitions
"""

import json
from typing import Optional

from kiro_client import KiroClient

DECOMPOSE_SCHEMA = {
    "type": "object",
    "properties": {
        "subtasks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "integer"},
                    "instruction": {"type": "string"},
                    "done_condition": {"type": "string"}
                },
                "required": ["id", "instruction", "done_condition"]
            }
        }
    },
    "required": ["subtasks"]
}

VERIFY_SCHEMA = {
    "type": "object",
    "properties": {
        "status": {"type": "string", "enum": ["continue", "done", "stuck", "danger"]},
        "reason": {"type": "string"}
    },
    "required": ["status", "reason"]
}

PLANNER_SYSTEM = f"""You are a robot navigation task decomposer.
Given a high-level instruction and the robot's current view, break it into 2-5 sequential subtasks.

Each subtask instruction must be SPECIFIC and ACTIONABLE for a navigation robot:
- BAD: "Move toward the door" (too vague)
- GOOD: "Turn right about 30 degrees to face the doorway, then move forward until the doorway is directly ahead"

Include direction, approximate angles/distances when visible from the image.
Each subtask has a done_condition describing what the robot should observe when complete.

Output pure JSON:
{json.dumps(DECOMPOSE_SCHEMA, ensure_ascii=False)}
"""

VERIFIER_SYSTEM = f"""You are a robot navigation progress and safety verifier.
Given the current subtask, its done_condition, and recent observations (images), determine the status:
- continue: subtask in progress, robot is making progress toward done_condition
- done: done_condition is satisfied, subtask complete
- stuck: robot appears stuck (no visual change, repeated actions, no progress for multiple steps)
- danger: obstacle too close (<30cm), collision imminent, or robot heading toward wall/furniture

Safety rules (danger takes priority over all other statuses):
- Wall/obstacle occupies >70% of center frame → danger
- Robot is very close to door frame edge without alignment → danger
- Any object directly ahead at close range blocking the path → danger

Output pure JSON:
{json.dumps(VERIFY_SCHEMA, ensure_ascii=False)}
"""


def parse_json_reply(reply: str) -> Optional[dict]:
    raw = reply.strip()
    if raw.startswith("```"):
        lines = raw.split("\n")
        raw = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


class Planner:
    def __init__(self, client: Optional[KiroClient] = None):
        self.client = client or KiroClient()

    def decompose(self, instruction: str, initial_frame: Optional[str] = None) -> list[dict]:
        prompt = f"Instruction: {instruction}\nDecompose into sequential subtasks."

        if initial_frame:
            reply = self.client.chat_with_image(
                prompt, image_source=initial_frame,
                system=PLANNER_SYSTEM, max_tokens=512
            )
        else:
            reply = self.client.chat(
                prompt, system=PLANNER_SYSTEM, max_tokens=512
            )

        result = parse_json_reply(reply)
        if result and "subtasks" in result:
            return result["subtasks"]
        return []


class Verifier:
    def __init__(self, client: Optional[KiroClient] = None):
        self.client = client or KiroClient()

    def check(self, subtask: dict, recent_frames: list[str], memory: list[dict]) -> dict:
        history_lines = []
        for entry in memory[-10:]:
            if entry["type"] == "action":
                history_lines.append(f"Step {entry['step']}: {entry['action']}")
            elif entry["type"] == "verify":
                history_lines.append(f"Verify@Step {entry['step']}: {entry['status']} - {entry['reason']}")
        history_text = "\n".join(history_lines) if history_lines else "No history yet."

        prompt = f"""Current subtask: {subtask['instruction']}
Done condition: {subtask['done_condition']}

Execution history:
{history_text}

Images are recent observations (latest = last image). Determine current status."""

        reply = self.client.chat_with_image(
            prompt, image_source=recent_frames,
            system=VERIFIER_SYSTEM, max_tokens=256
        )

        result = parse_json_reply(reply)
        if result and "status" in result:
            return result
        return {"status": "continue", "reason": "verifier parse failed"}


class SAPController:
    """State machine managing the Planner-Executor-Verifier loop with memory."""

    def __init__(self, verify_interval: int = 3, max_retries: int = 3):
        self.verify_interval = verify_interval
        self.max_retries = max_retries

        self.planner = Planner()
        self.verifier = Verifier()

        self.subtasks: list[dict] = []
        self.current_index: int = 0
        self.step_count: int = 0
        self.retry_count: int = 0
        self.danger_count: int = 0
        self.max_danger: int = 2
        self.active: bool = False
        self.last_verify: Optional[dict] = None
        self.memory: list[dict] = []

    @property
    def current_subtask(self) -> Optional[dict]:
        if self.active and self.current_index < len(self.subtasks):
            return self.subtasks[self.current_index]
        return None

    @property
    def current_instruction(self) -> str:
        st = self.current_subtask
        return st["instruction"] if st else ""

    @property
    def is_complete(self) -> bool:
        return self.active and self.current_index >= len(self.subtasks)

    def start(self, instruction: str, initial_frame: Optional[str] = None):
        self._original_instruction = instruction
        self.subtasks = self.planner.decompose(instruction, initial_frame)
        self.current_index = 0
        self.step_count = 0
        self.retry_count = 0
        self.danger_count = 0
        self.active = bool(self.subtasks)
        self.last_verify = None
        self.memory = []

    def record_action(self, action_text: str, frame_b64: str = ""):
        self.memory.append({
            "type": "action",
            "step": self.step_count,
            "subtask_id": self.current_index + 1,
            "action": action_text,
            "frame_b64": frame_b64,
        })

    def _replan_current(self, recent_frames: list[str]):
        """Replan current subtask by calling VLM with failure context."""
        history_summary = " → ".join(
            e["action"] for e in self.memory[-5:] if e["type"] == "action"
        )
        last_reason = self.last_verify["reason"] if self.last_verify else ""
        original_instruction = self.subtasks[self.current_index]["instruction"]
        done_condition = self.subtasks[self.current_index]["done_condition"]

        replan_prompt = f"""The robot failed to complete a subtask safely.

Original subtask: {original_instruction}
Done condition: {done_condition}
Failure reason: {last_reason}
Recent actions taken: {history_summary}

Based on the current observation (image), generate a NEW specific instruction for the robot to safely achieve the same goal.
The instruction must be concrete and actionable (e.g. "Turn left 20 degrees to avoid the wall, then move forward slowly toward the doorway").
Do NOT repeat the failed approach. Output ONLY the new instruction text, nothing else."""

        if recent_frames:
            new_instruction = self.planner.client.chat_with_image(
                replan_prompt, image_source=recent_frames[-1],
                system="You are a robot navigation replanner. Output only a single concrete instruction.",
                max_tokens=128
            )
        else:
            new_instruction = self.planner.client.chat(
                replan_prompt,
                system="You are a robot navigation replanner. Output only a single concrete instruction.",
                max_tokens=128
            )

        new_instruction = new_instruction.strip().strip('"')
        self.subtasks[self.current_index] = {
            **self.subtasks[self.current_index],
            "instruction": new_instruction,
        }
        self.memory.append({
            "type": "replan",
            "step": self.step_count,
            "subtask_id": self.current_index + 1,
            "old_instruction": original_instruction,
            "new_instruction": new_instruction,
            "reason": last_reason,
        })
        self.step_count = 0

    def step(self, recent_frames: list[str]) -> dict:
        """Called after each NaVILA inference step.

        Returns:
            dict with keys:
            - action: "execute" | "next" | "retry" | "stop" | "complete"
            - subtask: current subtask dict
            - verify: verification result (if checked this step)
        """
        if not self.active or self.is_complete:
            return {"action": "complete", "subtask": None, "verify": None}

        self.step_count += 1
        verify_result = None

        if self.step_count % self.verify_interval == 0 and recent_frames:
            verify_result = self.verifier.check(self.current_subtask, recent_frames, self.memory)
            self.last_verify = verify_result
            self.memory.append({
                "type": "verify",
                "step": self.step_count,
                "subtask_id": self.current_index + 1,
                "status": verify_result["status"],
                "reason": verify_result["reason"],
            })

            if verify_result["status"] == "done":
                self.current_index += 1
                self.step_count = 0
                self.retry_count = 0
                if self.is_complete:
                    return {"action": "complete", "subtask": None, "verify": verify_result}
                return {"action": "next", "subtask": self.current_subtask, "verify": verify_result}

            elif verify_result["status"] == "stuck":
                self.retry_count += 1
                if self.retry_count >= self.max_retries:
                    return {"action": "stop", "subtask": self.current_subtask, "verify": verify_result}
                self._replan_current(recent_frames)
                return {"action": "replan", "subtask": self.current_subtask, "verify": verify_result}

            elif verify_result["status"] == "danger":
                self.danger_count += 1
                if self.danger_count >= self.max_danger:
                    return {"action": "stop", "subtask": self.current_subtask, "verify": verify_result}
                self._replan_current(recent_frames)
                return {"action": "replan", "subtask": self.current_subtask, "verify": verify_result}

        return {"action": "execute", "subtask": self.current_subtask, "verify": verify_result}

    def get_status(self) -> dict:
        return {
            "active": self.active,
            "subtasks": self.subtasks,
            "current_index": self.current_index,
            "current_subtask": self.current_subtask,
            "step_count": self.step_count,
            "retry_count": self.retry_count,
            "is_complete": self.is_complete,
            "last_verify": self.last_verify,
            "memory": self.memory[-20:],
        }
