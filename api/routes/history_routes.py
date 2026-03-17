# api/routes/history_routes.py
import subprocess
from pathlib import Path




from flask import Blueprint, jsonify, request

#将../放入路径
import sys
sys.path.append(str(Path(__file__).parent.parent.parent.parent.parent.parent))  # Adjust the number of parent() calls based on the actual location of this file relative to MIKI_ROOT

from config import MIKI_ROOT

history_bp = Blueprint("history", __name__)

PROJECT_ROOT = Path(MIKI_ROOT).resolve()
SAVE_HISTORY_SCRIPT = PROJECT_ROOT / "scripts" / "training_session" / "save_history.sh"
DEFAULT_TRAIN_CONFIG = PROJECT_ROOT / "config" / "train_config.json"


@history_bp.route("/api/training/save-history", methods=["POST"])
def save_training_history():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        payload = {}

    raw_train_config = payload.get("train_config")
    train_config_path = Path(raw_train_config) if raw_train_config else DEFAULT_TRAIN_CONFIG

    # 允许传相对路径，但统一解析到项目根目录下
    if not train_config_path.is_absolute():
        train_config_path = (PROJECT_ROOT / train_config_path).resolve()
    else:
        train_config_path = train_config_path.resolve()

    # 防止相对路径跳出项目根目录
    try:
        train_config_path.relative_to(PROJECT_ROOT)
    except ValueError:
        return jsonify(
            {
                "ok": False,
                "error": f"train config escapes project root: {train_config_path}",
            }
        ), 400

    if not SAVE_HISTORY_SCRIPT.is_file():
        return jsonify(
            {
                "ok": False,
                "error": f"save_history.sh not found: {SAVE_HISTORY_SCRIPT}",
            }
        ), 500

    if not train_config_path.is_file():
        return jsonify(
            {
                "ok": False,
                "error": f"train config not found: {train_config_path}",
            }
        ), 400

    try:
        result = subprocess.run(
            ["bash", str(SAVE_HISTORY_SCRIPT), str(train_config_path)],
            cwd=str(PROJECT_ROOT),
            capture_output=True,
            text=True,
            check=True,
        )

        return jsonify(
            {
                "ok": True,
                "stdout": result.stdout,
                "stderr": result.stderr,
                "script": str(SAVE_HISTORY_SCRIPT),
                "train_config": str(train_config_path),
            }
        )
    except subprocess.CalledProcessError as err:
        return jsonify(
            {
                "ok": False,
                "error": "save_history script failed",
                "returncode": err.returncode,
                "stdout": err.stdout,
                "stderr": err.stderr,
            }
        ), 500