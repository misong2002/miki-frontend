import re
import subprocess
import sys
from pathlib import Path

from flask import Blueprint, jsonify, request

from config import (
    MIKI_ROOT,
    HISTORY_ROOT,
    TRAIN_CONFIG_PATH,
    SAVE_HISTORY_SCRIPT_PATH,
    INITIALIZE_SCRIPT_PATH,
    PLOT_SCRIPT_PATH,
)

history_bp = Blueprint("history", __name__)

PROJECT_ROOT = Path(MIKI_ROOT).resolve()
DEFAULT_TRAIN_CONFIG = Path(TRAIN_CONFIG_PATH).resolve()
SAVE_HISTORY_SCRIPT = Path(SAVE_HISTORY_SCRIPT_PATH).resolve()
INITIALIZE_SCRIPT = Path(INITIALIZE_SCRIPT_PATH).resolve()
PLOT_SCRIPT = Path(PLOT_SCRIPT_PATH).resolve()
HISTORY_DIR = Path(HISTORY_ROOT).resolve()

_HISTORY_SESSION_RE = re.compile(r"^\d{8}_\d{6}$")


def _normalize_session_id(raw_value: str) -> str:
    value = str(raw_value or "").strip()
    if value.startswith("history/"):
        value = value[len("history/") :]
    return value


def _validate_session_id(raw_value: str) -> str:
    session_id = _normalize_session_id(raw_value)
    if not _HISTORY_SESSION_RE.fullmatch(session_id):
        raise ValueError("invalid session_id, expected YYYYMMDD_HHMMSS")
    return session_id


def _get_history_session_dir(session_id: str) -> Path:
    session_dir = HISTORY_DIR / session_id

    if not session_dir.exists() or not session_dir.is_dir():
        raise FileNotFoundError(f"history session not found: {session_id}")

    return session_dir


def _get_plot_output_dir(session_id: str) -> Path:
    return _get_history_session_dir(session_id) / "plots"


def _list_history_sessions():
    if not HISTORY_DIR.exists():
        return []

    items = []
    for item in HISTORY_DIR.iterdir():
        if not item.is_dir():
            continue

        name = item.name
        if not _HISTORY_SESSION_RE.fullmatch(name):
            continue

        items.append(
            {
                "session_id": name,
                "label": f"history/{name}",
                "path": f"history/{name}",
            }
        )

    items.sort(key=lambda x: x["session_id"], reverse=True)
    return items


@history_bp.route("/save-history", methods=["POST"])
def save_training_history():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        payload = {}

    raw_train_config = payload.get("train_config")
    train_config_path = Path(raw_train_config) if raw_train_config else DEFAULT_TRAIN_CONFIG

    if not train_config_path.is_absolute():
        train_config_path = (PROJECT_ROOT / train_config_path).resolve()
    else:
        train_config_path = train_config_path.resolve()

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


def _build_command(command_name: str, session_id: str):
    if command_name == "initialize":
        if not INITIALIZE_SCRIPT.is_file():
            raise FileNotFoundError(f"initialize script not found: {INITIALIZE_SCRIPT}")
        return ["bash", str(INITIALIZE_SCRIPT), session_id]

    if command_name == "plot":
        if not PLOT_SCRIPT.is_file():
            raise FileNotFoundError(f"plot script not found: {PLOT_SCRIPT}")
        return [sys.executable, str(PLOT_SCRIPT), session_id]

    raise ValueError(f"unsupported command: {command_name}")


def _validate_plot_outputs(session_id: str):
    output_dir = _get_plot_output_dir(session_id)

    if not output_dir.exists() or not output_dir.is_dir():
        return False, output_dir, []

    files = sorted([p.name for p in output_dir.iterdir() if p.is_file()])
    return len(files) > 0, output_dir, files


def _run_history_command(command_name: str, session_id: str):
    session_id = _validate_session_id(session_id)
    _get_history_session_dir(session_id)

    command = _build_command(command_name, session_id)

    completed = subprocess.run(
        command,
        capture_output=True,
        text=True,
        cwd=str(PROJECT_ROOT),
    )

    if completed.returncode != 0:
        return jsonify(
            {
                "ok": False,
                "error": f"{command_name} command failed",
                "command": command_name,
                "session_id": session_id,
                "returncode": completed.returncode,
                "stdout": completed.stdout,
                "stderr": completed.stderr,
            }
        ), 500

    payload = {
        "ok": True,
        "command": command_name,
        "session_id": session_id,
        "returncode": completed.returncode,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
    }

    if command_name == "plot":
        has_outputs, output_dir, files = _validate_plot_outputs(session_id)

        if not has_outputs:
            return jsonify(
                {
                    "ok": False,
                    "error": f"plot command exited 0 but produced no files in {output_dir}",
                    "command": command_name,
                    "session_id": session_id,
                    "returncode": completed.returncode,
                    "stdout": completed.stdout,
                    "stderr": completed.stderr,
                    "output_dir": str(output_dir),
                    "files": files,
                }
            ), 500

        payload.update(
            {
                "message": f"plot finished for {session_id}",
                "output_dir": str(output_dir),
                "files": files,
            }
        )
        return jsonify(payload), 200

    payload["message"] = f"{command_name} finished for {session_id}"
    return jsonify(payload), 200


@history_bp.get("/sessions")
def list_history_sessions():
    try:
        sessions = _list_history_sessions()
        return jsonify(
            {
                "ok": True,
                "sessions": sessions,
            }
        )
    except Exception as err:
        return jsonify(
            {
                "ok": False,
                "error": str(err),
            }
        ), 500


@history_bp.post("/initialize")
def run_initialize_from_history():
    try:
        payload = request.get_json(silent=True) or {}
        session_id = payload.get("session_id", "")
        return _run_history_command("initialize", session_id)
    except Exception as err:
        return jsonify(
            {
                "ok": False,
                "error": str(err),
            }
        ), 400


@history_bp.post("/plot")
def run_plot_from_history():
    try:
        payload = request.get_json(silent=True) or {}
        session_id = payload.get("session_id", "")
        return _run_history_command("plot", session_id)
    except Exception as err:
        return jsonify(
            {
                "ok": False,
                "error": str(err),
            }
        ), 400