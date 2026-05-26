"""Compare NaVILA output: original instruction vs SAP subtask instruction."""

import base64
import json
import os
import sys
import time
from pathlib import Path

import requests

NAVILA_URL = "http://localhost:8000/infer"

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from server.planner import Planner


def get_last_frame_b64(log_dir: str) -> str:
    meta_path = os.path.join(log_dir, "meta.json")
    with open(meta_path) as f:
        num_frames = json.load(f)["num_frames"]
    frame_path = os.path.join(log_dir, f"frame_{num_frames - 1:02d}.jpg")
    with open(frame_path, "rb") as f:
        return base64.b64encode(f.read()).decode()


def get_frames_b64(log_dir: str) -> list[str]:
    meta_path = os.path.join(log_dir, "meta.json")
    with open(meta_path) as f:
        num_frames = json.load(f)["num_frames"]
    frames = []
    for i in range(num_frames):
        fp = os.path.join(log_dir, f"frame_{i:02d}.jpg")
        with open(fp, "rb") as f:
            frames.append(base64.b64encode(f.read()).decode())
    return frames


def infer(frames_b64: list[str], instruction: str) -> dict:
    resp = requests.post(NAVILA_URL, json={
        "frames": frames_b64,
        "instruction": instruction,
    })
    return resp.json()


def main():
    if len(sys.argv) < 2:
        print("Usage: python compare_instructions.py <exported_json_path>")
        sys.exit(1)

    with open(sys.argv[1]) as f:
        data = json.load(f)

    log_dirs = data["log_dirs"]
    original_instruction = data["instruction"]

    initial_frame_path = os.path.join(log_dirs[0], f"frame_{json.load(open(os.path.join(log_dirs[0], 'meta.json')))['num_frames']-1:02d}.jpg")
    planner = Planner()
    subtasks = planner.decompose(original_instruction, initial_frame_path)

    print(f"Original instruction: {original_instruction}")
    print(f"\nSAP subtasks:")
    for st in subtasks:
        print(f"  [{st['id']}] {st['instruction']}")

    print(f"\n{'='*80}")
    print(f"{'Step':<6}{'Original Action':<40}{'SAP Action':<40}")
    print(f"{'='*80}")

    html_rows = []

    for i in range(min(len(log_dirs), 6)):
        frames = get_frames_b64(log_dirs[i])

        result_original = infer(frames, original_instruction)
        time.sleep(0.1)

        sap_instruction = subtasks[0]["instruction"] if subtasks else original_instruction
        result_sap = infer(frames, sap_instruction)

        orig_action = result_original["raw_output"]
        sap_action = result_sap["raw_output"]
        same = "✓" if orig_action == sap_action else "✗"

        print(f"{i+1:<6}{orig_action:<40}{sap_action:<40} {same}")

        last_frame_b64 = frames[-1]
        html_rows.append({
            "step": i + 1,
            "frame_b64": last_frame_b64,
            "original_instruction": original_instruction,
            "sap_instruction": sap_instruction,
            "original_action": orig_action,
            "sap_action": sap_action,
            "same": orig_action == sap_action,
        })

    output_html = sys.argv[1].replace(".json", "_compare.html")
    generate_compare_html(original_instruction, subtasks, html_rows, output_html)


def generate_compare_html(instruction, subtasks, rows, output_path):
    rows_html = ""
    for r in rows:
        border_color = "#22c55e" if r["same"] else "#f59e0b"
        rows_html += f"""
        <div style="display:flex;gap:16px;padding:16px;background:#0f172a;border-radius:8px;margin-bottom:12px;border-left:3px solid {border_color};">
            <img src="data:image/jpeg;base64,{r['frame_b64']}" style="width:160px;height:120px;object-fit:cover;border-radius:8px;"/>
            <div style="flex:1;">
                <div style="margin-bottom:8px;">
                    <span style="background:#334155;color:#f1f5f9;padding:2px 8px;border-radius:4px;font-size:12px;">Step {r['step']}</span>
                    <span style="color:{'#22c55e' if r['same'] else '#f59e0b'};margin-left:8px;font-size:12px;">{'Same' if r['same'] else 'Different'}</span>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                    <div>
                        <div style="color:#94a3b8;font-size:11px;margin-bottom:4px;">ORIGINAL INSTRUCTION</div>
                        <div style="color:#64748b;font-size:12px;padding:4px 8px;background:#1e293b;border-radius:4px;margin-bottom:4px;">{r['original_instruction'][:80]}</div>
                        <div style="color:#f1f5f9;font-size:13px;">→ {r['original_action']}</div>
                    </div>
                    <div>
                        <div style="color:#22d3ee;font-size:11px;margin-bottom:4px;">SAP SUBTASK INSTRUCTION</div>
                        <div style="color:#22d3ee;font-size:12px;padding:4px 8px;background:#1e293b;border-radius:4px;margin-bottom:4px;">{r['sap_instruction'][:80]}</div>
                        <div style="color:#f1f5f9;font-size:13px;">→ {r['sap_action']}</div>
                    </div>
                </div>
            </div>
        </div>"""

    subtask_html = "".join(
        f'<span style="background:#1e293b;padding:4px 10px;border-radius:4px;color:#22d3ee;font-size:12px;">[{st["id"]}] {st["instruction"]}</span>'
        for st in subtasks
    )

    html = f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>SAP vs Original Comparison</title></head>
<body style="font-family:-apple-system,sans-serif;background:#0a0e1a;color:#e2e8f0;margin:0;padding:32px;">
<div style="max-width:1100px;margin:0 auto;">
    <h1 style="color:#22d3ee;">Original vs SAP Instruction Comparison</h1>
    <p style="color:#94a3b8;">Task: {instruction}</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:24px;">{subtask_html}</div>
    {rows_html}
    <div style="color:#475569;font-size:12px;margin-top:32px;">Generated at {time.strftime('%Y-%m-%d %H:%M:%S')}</div>
</div>
</body>
</html>"""

    with open(output_path, "w") as f:
        f.write(html)
    print(f"\nComparison HTML saved to: {output_path}")


if __name__ == "__main__":
    main()
