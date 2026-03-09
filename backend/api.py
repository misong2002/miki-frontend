from flask import Flask, request, jsonify, Response
from flask_cors import CORS
import json
import time
import subprocess
import os
import signal
from pathlib import Path
from config import LOSS_FILE_PATH, BATTLE_SCRIPT_PATH

app = Flask(__name__)
CORS(app)

LOSS_FILE_PATH = Path(LOSS_FILE_PATH)
BATTLE_SCRIPT_PATH = Path(BATTLE_SCRIPT_PATH)

# 全局 battle 进程句柄
battle_process = None


@app.route("/api/chat", methods=["POST"])
def chat():
    data = request.get_json()
    message = data.get("message", "")
    reply = f"我收到了你的问题：{message}"
    return jsonify({"reply": reply})


@app.route("/api/train/stream/<job_id>")
def train_stream(job_id):
    def generate():
        for step in range(1, 21):
            metric = {
                "epoch": (step - 1) // 10 + 1,
                "step": step,
                "loss": round(2.0 / step, 4),
                "status": "running"
            }
            yield f"event: metric\ndata: {json.dumps(metric)}\n\n"

            log = {
                "message": f"[{job_id}] step {step}, loss = {metric['loss']}"
            }
            yield f"event: log\ndata: {json.dumps(log)}\n\n"

            time.sleep(0.5)

        finish = {"status": "finished"}
        yield f"event: finish\ndata: {json.dumps(finish)}\n\n"

    return Response(generate(), mimetype="text/event-stream")


@app.route("/api/battle/start", methods=["POST"])
def battle_start():
    global battle_process

    data = request.get_json() or {}

    # 如果已有 battle 进程还活着，就直接返回
    if battle_process is not None and battle_process.poll() is None:
        return jsonify({
            "status": "already_running",
            "pid": battle_process.pid
        })

    if not BATTLE_SCRIPT_PATH.exists():
        return jsonify({
            "status": "error",
            "message": f"battle script not found: {BATTLE_SCRIPT_PATH}"
        }), 500

    # 用新的进程组启动，后面便于整组杀掉
    battle_process = subprocess.Popen(
        ["bash", str(BATTLE_SCRIPT_PATH)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        preexec_fn=os.setsid,
    )

    return jsonify({
        "status": "started",
        "pid": battle_process.pid,
        "config": data,
    })


@app.route("/api/battle/stop", methods=["POST"])
def battle_stop():
    global battle_process

    if battle_process is None or battle_process.poll() is not None:
        battle_process = None
        return jsonify({
            "status": "not_running"
        })

    try:
        # 杀整个进程组，避免脚本里再起子进程时漏掉
        os.killpg(os.getpgid(battle_process.pid), signal.SIGTERM)
        battle_process.wait(timeout=3)
    except subprocess.TimeoutExpired:
        os.killpg(os.getpgid(battle_process.pid), signal.SIGKILL)
    except ProcessLookupError:
        pass
    finally:
        battle_process = None

    return jsonify({
        "status": "stopped"
    })


@app.route("/api/battle/loss", methods=["GET"])
def battle_loss():
    path = LOSS_FILE_PATH
    if not path.exists():
        return jsonify({
            "path": str(path),
            "data": []
        })

    data = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue

            parts = line.split()
            if len(parts) < 2:
                continue

            try:
                epoch = float(parts[0])
                loss = float(parts[1])
            except ValueError:
                continue

            data.append({
                "epoch": epoch,
                "loss": loss
            })

    return jsonify({
        "path": str(path),
        "data": data
    })


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True, threaded=True)