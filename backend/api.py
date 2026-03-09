from flask import Flask, request, jsonify, Response
from flask_cors import CORS
import json
import time
import subprocess
import os
import signal
from pathlib import Path
from config import LOSS_FILE_PATH, BATTLE_SCRIPT_PATH, BATTLE_CONFIG_PATH, MIKI_ROOT
from flask import Response, request
import json
app = Flask(__name__)
CORS(app)

LOSS_FILE_PATH = Path(LOSS_FILE_PATH)
BATTLE_SCRIPT_PATH = Path(BATTLE_SCRIPT_PATH)
BATTLE_CONFIG_PATH = Path(BATTLE_CONFIG_PATH)
MIKI_ROOT = Path(MIKI_ROOT).resolve()

battle_process = None
from flask import Flask, request, jsonify, Response
from flask_cors import CORS

from services.llm_service import client
from services.memory_service import get_recent_messages,append_message
from services.persona_service import get_system_prompt

app = Flask(__name__)
CORS(app)

def parse_layer_sizes(layer_sizes_raw):
    if isinstance(layer_sizes_raw, list):
        return [int(x) for x in layer_sizes_raw]

    if isinstance(layer_sizes_raw, str):
        parts = [x.strip() for x in layer_sizes_raw.split(",") if x.strip()]
        return [int(x) for x in parts]

    raise ValueError("Invalid layerSizes format")


@app.route("/api/battle/start", methods=["POST"])
def battle_start():
    global battle_process

    payload = request.get_json() or {}

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

    try:
        layer_sizes = parse_layer_sizes(payload.get("layerSizes", "2,128,128,3"))
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": f"invalid layerSizes: {e}"
        }), 400

    battle_config = {
        "model_name": payload.get("modelName", "hadron_Matrix_siren"),
        "dataset": payload.get("dataset", "data/simulation.hdf5"),
        "flux": payload.get("flux", "data/flux.dat"),
        "output": payload.get("output", "data/siren_params.npz"),
        "rounds": int(payload.get("rounds", 200)),
        "lr": float(payload.get("lr", 1e-3)),
        "layer_sizes": layer_sizes,
        "loss_file": "data/loss.txt",
    }

    BATTLE_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(BATTLE_CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(battle_config, f, ensure_ascii=False, indent=2)

    # 清空旧 loss，避免战斗界面读到上次残留
    LOSS_FILE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(LOSS_FILE_PATH, "w", encoding="utf-8") as f:
        pass

    battle_process = subprocess.Popen(
        ["bash", str(BATTLE_SCRIPT_PATH.resolve()), str(BATTLE_CONFIG_PATH.resolve())],
        cwd=str(MIKI_ROOT),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        preexec_fn=os.setsid,
    )

    return jsonify({
        "status": "started",
        "pid": battle_process.pid,
        "config_path": str(BATTLE_CONFIG_PATH),
        "config": battle_config,
    })


@app.route("/api/battle/stop", methods=["POST"])
def battle_stop():
    global battle_process

    if battle_process is None or battle_process.poll() is not None:
        battle_process = None
        return jsonify({"status": "not_running"})

    try:
        os.killpg(os.getpgid(battle_process.pid), signal.SIGTERM)
        battle_process.wait(timeout=3)
    except subprocess.TimeoutExpired:
        os.killpg(os.getpgid(battle_process.pid), signal.SIGKILL)
    except ProcessLookupError:
        pass
    finally:
        battle_process = None

    return jsonify({"status": "stopped"})


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



@app.route("/api/chat", methods=["POST"])
def chat():
    data = request.get_json() or {}
    session_id = data.get("session_id", "default-session")
    user_message = data.get("message", "").strip()

    if not user_message:
        return jsonify({"error": "empty message"}), 400

    history = get_recent_messages(session_id, limit=12)

    messages = [
        {"role": "system", "content": get_system_prompt()}
    ]

    for msg in history:
        messages.append({
            "role": msg["role"],
            "content": msg["content"]
        })

    messages.append({
        "role": "user",
        "content": user_message
    })

    try:
        stream = client.chat.completions.create(
            model="gpt-5.4",
            messages=messages,
            temperature=0.7,
            max_tokens=512,
            stream=True,
        )
    except Exception as e:
        print("LLM stream init error:", e, flush=True)
        return jsonify({"error": f"LLM stream init failed: {e}"}), 500

    def generate():
        full_reply = ""

        try:
            for chunk in stream:
                if not chunk.choices:
                    continue

                delta = chunk.choices[0].delta
                token = getattr(delta, "content", None)

                if token is None:
                    continue

                full_reply += token
                yield json.dumps({"token": token}, ensure_ascii=False) + "\n"

            # 流正常结束后再写入记忆
            append_message(session_id, "user", user_message)
            append_message(session_id, "assistant", full_reply)

        except Exception as e:
            print("LLM stream runtime error:", e, flush=True)
            yield json.dumps(
                {"error": f"stream runtime failed: {str(e)}"},
                ensure_ascii=False
            ) + "\n"

    return Response(generate(), mimetype="text/plain; charset=utf-8")

if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=5000,
        debug=True
    )