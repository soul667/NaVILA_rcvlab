"""Offline test of SAP Planner-Executor-Verifier loop. Generates HTML report."""

import base64
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from server.planner import SAPController


def get_last_frame(log_dir: str) -> str:
    meta_path = os.path.join(log_dir, "meta.json")
    if os.path.exists(meta_path):
        with open(meta_path) as f:
            num_frames = json.load(f)["num_frames"]
        frame_path = os.path.join(log_dir, f"frame_{num_frames - 1:02d}.jpg")
        if os.path.exists(frame_path):
            return frame_path
    frames = sorted(Path(log_dir).glob("frame_*.jpg"))
    return str(frames[-1]) if frames else ""


def img_to_base64(path: str) -> str:
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode()


def generate_html(instruction, subtasks, steps, final_status, output_path):
    status_colors = {
        "continue": "#3b82f6",
        "done": "#22c55e",
        "stuck": "#f59e0b",
        "danger": "#ef4444",
    }
    action_colors = {
        "execute": "#6b7280",
        "next": "#22c55e",
        "retry": "#f59e0b",
        "stop": "#ef4444",
        "complete": "#22c55e",
    }

    subtask_html = ""
    for st in subtasks:
        subtask_html += f"""
        <div style="background:#1e293b;padding:12px 16px;border-radius:8px;margin-bottom:8px;">
            <span style="color:#22d3ee;font-weight:bold;">[{st['id']}]</span>
            <span style="color:#f1f5f9;">{st['instruction']}</span>
            <div style="color:#94a3b8;font-size:12px;margin-top:4px;">Done: {st['done_condition']}</div>
        </div>"""

    steps_html = ""
    for s in steps:
        verify_badge = ""
        if s.get("verify"):
            color = status_colors.get(s["verify"]["status"], "#6b7280")
            verify_badge = f"""
            <div style="margin-top:8px;padding:8px 12px;background:rgba(0,0,0,0.3);border-left:3px solid {color};border-radius:4px;">
                <span style="color:{color};font-weight:bold;text-transform:uppercase;">{s['verify']['status']}</span>
                <span style="color:#cbd5e1;margin-left:8px;">{s['verify']['reason']}</span>
            </div>"""

        action_color = action_colors.get(s["sap_action"], "#6b7280")
        img_tag = ""
        if s.get("frame_b64"):
            img_tag = f'<img src="data:image/jpeg;base64,{s["frame_b64"]}" style="width:200px;height:150px;object-fit:cover;border-radius:8px;border:1px solid #334155;"/>'

        prompt_html = ""
        if s.get("input_prompt"):
            prompt_html = f"""
            <div style="margin-top:6px;padding:6px 10px;background:#1e293b;border-radius:4px;border-left:2px solid #22d3ee;">
                <span style="color:#22d3ee;font-size:11px;font-weight:bold;">PROMPT → NaVILA:</span>
                <div style="color:#94a3b8;font-size:12px;margin-top:4px;white-space:pre-wrap;">{s['input_prompt']}</div>
            </div>"""

        steps_html += f"""
        <div style="display:flex;gap:16px;padding:16px;background:#0f172a;border-radius:8px;margin-bottom:12px;border:1px solid #1e293b;">
            <div style="flex-shrink:0;">{img_tag}</div>
            <div style="flex:1;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                    <span style="background:#334155;color:#f1f5f9;padding:2px 8px;border-radius:4px;font-size:12px;">Step {s['step']}</span>
                    <span style="background:{action_color};color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;">{s['sap_action']}</span>
                    <span style="color:#94a3b8;font-size:12px;">Subtask [{s['subtask_id']}]</span>
                </div>
                {prompt_html}
                <div style="color:#e2e8f0;font-size:14px;margin-top:6px;">Output: {s['action_desc']}</div>
                {verify_badge}
            </div>
        </div>"""

    final_color = "#22c55e" if final_status["is_complete"] else "#ef4444"
    final_text = "COMPLETE" if final_status["is_complete"] else "STOPPED"
    last_verify_html = ""
    if final_status.get("last_verify"):
        lv = final_status["last_verify"]
        lv_color = status_colors.get(lv["status"], "#6b7280")
        last_verify_html = f"""
        <div style="margin-top:12px;padding:12px;background:#1e293b;border-radius:8px;border-left:3px solid {lv_color};">
            <span style="color:{lv_color};font-weight:bold;">{lv['status'].upper()}</span>: {lv['reason']}
        </div>"""

    html = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>SAP Test Report</title>
<style>
body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0e1a; color: #e2e8f0; margin: 0; padding: 32px; }}
.container {{ max-width: 1000px; margin: 0 auto; }}
h1 {{ color: #22d3ee; margin-bottom: 4px; }}
h2 {{ color: #94a3b8; font-size: 16px; font-weight: normal; margin-top: 0; }}
.section {{ margin-bottom: 32px; }}
.section-title {{ color: #f1f5f9; font-size: 18px; font-weight: bold; margin-bottom: 12px; border-bottom: 1px solid #1e293b; padding-bottom: 8px; }}
</style>
</head>
<body>
<div class="container">
    <h1>SAP Planner-Executor-Verifier Report</h1>
    <h2>{instruction}</h2>

    <div class="section">
        <div class="section-title">Task Decomposition ({len(subtasks)} subtasks)</div>
        {subtask_html}
    </div>

    <div class="section">
        <div class="section-title">Execution Timeline ({len(steps)} steps)</div>
        {steps_html}
    </div>

    <div class="section">
        <div class="section-title">Final Status</div>
        <div style="background:#0f172a;padding:16px;border-radius:8px;border:1px solid #1e293b;">
            <span style="color:{final_color};font-size:20px;font-weight:bold;">{final_text}</span>
            <span style="color:#94a3b8;margin-left:12px;">Subtask {final_status['current_index']+1}/{len(subtasks)}</span>
            {last_verify_html}
        </div>
    </div>

    <div style="color:#475569;font-size:12px;margin-top:32px;">Generated at {time.strftime('%Y-%m-%d %H:%M:%S')}</div>
</div>
</body>
</html>"""

    with open(output_path, "w") as f:
        f.write(html)
    print(f"\nHTML report saved to: {output_path}")


def main():
    if len(sys.argv) < 2:
        print("Usage: python test_sap.py <exported_json_path> [output.html]")
        sys.exit(1)

    export_path = sys.argv[1]
    output_html = sys.argv[2] if len(sys.argv) > 2 else export_path.replace(".json", "_sap_report.html")

    with open(export_path) as f:
        data = json.load(f)

    log_dirs = data["log_dirs"]
    instruction = data["instruction"]

    initial_frame = get_last_frame(log_dirs[0])
    print(f"Instruction: {instruction}")
    print(f"Log dirs: {len(log_dirs)}")

    print("\n=== PLANNER: Task Decomposition ===\n")
    sap = SAPController(verify_interval=2, max_retries=3)
    sap.start(instruction, initial_frame)

    if not sap.active:
        print("Planner failed to decompose task.")
        return

    for st in sap.subtasks:
        print(f"  [{st['id']}] {st['instruction']}")

    print("\n=== EXECUTOR + VERIFIER ===\n")
    step_records = []

    # log[i] 的图像是动作执行前的观测
    # 所以：log[i] 的动作 + log[i+1] 的帧 = 动作执行后的观测
    for i in range(len(log_dirs) - 1):
        current_dir = log_dirs[i]
        next_dir = log_dirs[i + 1]

        meta_path = os.path.join(current_dir, "meta.json")
        with open(meta_path) as f:
            meta = json.load(f)
        action_desc = meta["result"]["raw_output"]

        # 动作执行后的观测 = 下一个 log 的最后一帧
        observation_frame = get_last_frame(next_dir)
        if not observation_frame:
            continue

        sap.record_action(action_desc)
        current_prompt = sap.current_instruction
        result = sap.step([observation_frame])

        record = {
            "step": i + 1,
            "action_desc": action_desc,
            "input_prompt": current_prompt,
            "sap_action": result["action"],
            "subtask_id": sap.current_index + 1,
            "verify": result.get("verify"),
            "frame_b64": img_to_base64(observation_frame),
        }
        step_records.append(record)

        status_str = ""
        if result["verify"]:
            status_str = f" | {result['verify']['status']}: {result['verify']['reason'][:60]}"
        print(f"  Step {i+1}: {action_desc} → {result['action']}{status_str}")

        if result["action"] in ("complete", "stop"):
            print(f"\n  >>> {result['action'].upper()}")
            break

    final_status = sap.get_status()
    print(f"\n  Result: {'COMPLETE' if final_status['is_complete'] else 'STOPPED'} at subtask {final_status['current_index']+1}/{len(sap.subtasks)}")

    generate_html(instruction, sap.subtasks, step_records, final_status, output_html)


if __name__ == "__main__":
    main()
