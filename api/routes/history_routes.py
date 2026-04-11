import re
import sys
from pathlib import Path

from flask import Blueprint, jsonify, request

from services.command_runner import command_result_payload, run_command
from services.response_service import error_payload, success_payload

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
        return jsonify(error_payload(
            f"train config escapes project root: {train_config_path}"
        )), 400

    if not SAVE_HISTORY_SCRIPT.is_file():
        return jsonify(error_payload(
            f"save_history.sh not found: {SAVE_HISTORY_SCRIPT}"
        )), 500

    if not train_config_path.is_file():
        return jsonify(error_payload(
            f"train config not found: {train_config_path}"
        )), 400

    try:
        result = run_command(
            ["bash", str(SAVE_HISTORY_SCRIPT), str(train_config_path)],
            cwd=PROJECT_ROOT,
            check=True,
        )

        return jsonify(success_payload(
            message="history saved",
            script=str(SAVE_HISTORY_SCRIPT),
            train_config=str(train_config_path),
            **command_result_payload(result),
        ))
    except Exception as err:
        return jsonify(error_payload(
            "save_history script failed",
            **command_result_payload(err),
        )), 500


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

    completed = run_command(
        command,
        cwd=PROJECT_ROOT,
    )

    if completed.returncode != 0:
        return jsonify(error_payload(
            f"{command_name} command failed",
            command=command_name,
            session_id=session_id,
            **command_result_payload(completed),
        )), 500

    payload = success_payload(
        command=command_name,
        session_id=session_id,
        **command_result_payload(completed),
    )

    if command_name == "plot":
        has_outputs, output_dir, files = _validate_plot_outputs(session_id)

        if not has_outputs:
            return jsonify(error_payload(
                f"plot command exited 0 but produced no files in {output_dir}",
                command=command_name,
                session_id=session_id,
                output_dir=str(output_dir),
                files=files,
                **command_result_payload(completed),
            )), 500

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
        return jsonify(success_payload(sessions=sessions))
    except Exception as err:
        return jsonify(error_payload(str(err))), 500


@history_bp.post("/initialize")
def run_initialize_from_history():
    try:
        payload = request.get_json(silent=True) or {}
        session_id = payload.get("session_id", "")
        return _run_history_command("initialize", session_id)
    except Exception as err:
        return jsonify(error_payload(str(err))), 400


@history_bp.post("/plot")
def run_plot_from_history():
    try:
        payload = request.get_json(silent=True) or {}
        session_id = payload.get("session_id", "")
        return _run_history_command("plot", session_id)
    except Exception as err:
        return jsonify(error_payload(str(err))), 400
