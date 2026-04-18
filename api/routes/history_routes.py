import re
import sys
from pathlib import Path

import numpy as np
from flask import Blueprint, jsonify, request, send_from_directory, url_for

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
sys.path.insert(0, str(PROJECT_ROOT))

from scripts.utils.train_config_utils import load_train_config

DEFAULT_TRAIN_CONFIG = Path(TRAIN_CONFIG_PATH).resolve()
SAVE_HISTORY_SCRIPT = Path(SAVE_HISTORY_SCRIPT_PATH).resolve()
INITIALIZE_SCRIPT = Path(INITIALIZE_SCRIPT_PATH).resolve()
PLOT_SCRIPT = Path(PLOT_SCRIPT_PATH).resolve()
HISTORY_DIR = Path(HISTORY_ROOT).resolve()

_HISTORY_SESSION_RE = re.compile(r"^\d{8}_\d{6}$")
_HISTORY_LEAF_NAME_RE = re.compile(r"^epoch\d+\(model on epoch \d+\)(?:_\d+)?$|^\d+$")
_HISTORY_LEAF_SESSION_RE = re.compile(r"^\d{8}_\d{6}/(?:epoch\d+\(model on epoch \d+\)(?:_\d+)?|\d+)$")
_PLOT_IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".pdf"}



def _normalize_session_id(raw_value: str) -> str:
    value = str(raw_value or "").strip()
    if value.startswith("history/"):
        value = value[len("history/") :]
    return value


def _validate_session_id(raw_value: str) -> str:
    session_id = _normalize_session_id(raw_value)
    if not (
        _HISTORY_SESSION_RE.fullmatch(session_id)
        or _HISTORY_LEAF_SESSION_RE.fullmatch(session_id)
    ):
        raise ValueError("invalid session_id, expected YYYYMMDD_HHMMSS or YYYYMMDD_HHMMSS/epoch<loss>(model on epoch <model>)")
    return session_id


def _is_history_leaf(path: Path) -> bool:
    return path.is_dir() and (path / "config" / "train_config.json").is_file()


def _latest_leaf_under_timestamp(session_dir: Path) -> Path | None:
    if not session_dir.is_dir():
        return None
    leaves = [
        p for p in session_dir.iterdir()
        if p.is_dir() and _HISTORY_LEAF_NAME_RE.fullmatch(p.name) and _is_history_leaf(p)
    ]
    if not leaves:
        return None
    return sorted(leaves, key=lambda p: (*_leaf_sort_key(p.name), p.name))[-1]


def _get_history_session_dir(session_id: str) -> Path:
    session_id = _validate_session_id(session_id)
    session_dir = HISTORY_DIR / session_id

    if _is_history_leaf(session_dir):
        return session_dir

    nested = _latest_leaf_under_timestamp(session_dir)
    if nested is not None:
        return nested

    raise FileNotFoundError(f"history session not found: {session_id}")

def _session_id_from_leaf(timestamp_dir: Path, leaf_dir: Path) -> str:
    return f"{timestamp_dir.name}/{leaf_dir.name}"


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

        if _is_history_leaf(item):
            items.append(
                {
                    "session_id": name,
                    "label": f"history/{name}",
                    "path": f"history/{name}",
                }
            )

        for child in item.iterdir():
            if (
                not child.is_dir()
                or not _HISTORY_LEAF_NAME_RE.fullmatch(child.name)
                or not _is_history_leaf(child)
            ):
                continue
            session_id = _session_id_from_leaf(item, child)
            items.append(
                {
                    "session_id": session_id,
                    "label": f"history/{session_id}",
                    "path": f"history/{session_id}",
                    "timestamp": name,
                    "epoch": child.name,
                }
            )

    def sort_key(item):
        session_id = item["session_id"]
        if "/" in session_id:
            timestamp, epoch = session_id.split("/", 1)
            return timestamp, *_leaf_sort_key(epoch)
        return session_id, -1

    items.sort(key=sort_key, reverse=True)
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
        previous_session_id = _latest_history_session_id()
        previous_model_epoch = _model_epoch_from_session_id(previous_session_id)

        result = run_command(
            ["bash", str(SAVE_HISTORY_SCRIPT), str(train_config_path)],
            cwd=PROJECT_ROOT,
            check=True,
        )

        stdout = getattr(result, "stdout", "") or ""
        match = re.search(
            r"history_session=(\d{8}_\d{6}/(?:epoch\d+\(model on epoch \d+\)(?:_\d+)?|\d+))",
            stdout,
        )
        history_session = match.group(1) if match else ""
        current_model_epoch = _model_epoch_from_session_id(history_session)
        should_plot = not (
            previous_model_epoch is not None
            and current_model_epoch is not None
            and previous_model_epoch == current_model_epoch
        )

        return jsonify(success_payload(
            message="history saved",
            script=str(SAVE_HISTORY_SCRIPT),
            train_config=str(train_config_path),
            history_session=history_session,
            session_id=history_session,
            previous_history_session=previous_session_id,
            previous_model_epoch=previous_model_epoch,
            model_epoch=current_model_epoch,
            should_plot=should_plot,
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


def _is_plot_image_file(path: Path) -> bool:
    return path.is_file() and path.suffix.lower() in _PLOT_IMAGE_SUFFIXES


def _validate_plot_image_filename(raw_value: str) -> str:
    value = str(raw_value or "").strip()
    if not value or Path(value).name != value or value in {".", ".."}:
        raise ValueError("invalid plot image file")

    if Path(value).suffix.lower() not in _PLOT_IMAGE_SUFFIXES:
        raise ValueError("unsupported plot image file type")

    return value


def _list_plot_image_files(session_id: str):
    output_dir = _get_plot_output_dir(session_id)

    if not output_dir.exists() or not output_dir.is_dir():
        return output_dir, []

    files = []
    for item in sorted(output_dir.iterdir(), key=lambda p: p.name):
        if not _is_plot_image_file(item):
            continue

        stat = item.stat()
        files.append({
            "name": item.name,
            "url": url_for(
                "history.history_plot_file",
                session_id=session_id,
                file=item.name,
            ),
            "size": stat.st_size,
            "mtime": stat.st_mtime,
        })

    return output_dir, files


def _latest_history_session_id() -> str:
    sessions = _list_history_sessions()
    return sessions[0]["session_id"] if sessions else ""


def _oldest_history_session_id_for_model_epoch(model_epoch: int) -> str:
    matching = [
        item["session_id"]
        for item in _list_history_sessions()
        if _model_epoch_from_session_id(item["session_id"]) == model_epoch
    ]
    if not matching:
        return ""

    def sort_key(session_id: str):
        if "/" in session_id:
            timestamp, leaf_name = session_id.split("/", 1)
            return timestamp, *_leaf_sort_key(leaf_name)
        return session_id, -1, -1, -1

    return sorted(matching, key=sort_key)[0]


def _current_model_epoch() -> int | None:
    try:
        config = load_train_config(DEFAULT_TRAIN_CONFIG)
    except Exception:
        return None

    output = config.get("output")
    if not output:
        return None

    best_path = Path(output)
    if not best_path.is_absolute():
        best_path = PROJECT_ROOT / best_path
    latest_path = Path(str(best_path).removesuffix(".npz") + ".latest.npz")

    for model_path in (latest_path, best_path):
        if not model_path.is_file():
            continue
        try:
            data = np.load(model_path, allow_pickle=True)
            if "epoch" not in data.files:
                continue
            value = np.asarray(data["epoch"])
            if value.shape:
                value = value.reshape(-1)[0]
            else:
                value = value.item()
            return int(value)
        except Exception:
            continue

    return None


def _leaf_sort_key(name: str):
    match = re.fullmatch(r"epoch(?P<loss>\d+)\(model on epoch (?P<model>\d+)\)(?:_(?P<suffix>\d+))?", name)
    if match:
        return int(match.group("loss")), int(match.group("model")), int(match.group("suffix") or 0)
    if name.isdigit():
        return int(name), 0, 0
    return -1, -1, -1


def _model_epoch_from_session_id(session_id: str) -> int | None:
    if not session_id or "/" not in session_id:
        return None
    leaf_name = session_id.split("/", 1)[1]
    match = re.fullmatch(r"epoch\d+\(model on epoch (?P<model>\d+)\)(?:_\d+)?", leaf_name)
    if match:
        return int(match.group("model"))
    if leaf_name.isdigit():
        return 0
    return None


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


@history_bp.get("/plots")
def list_history_plot_images():
    try:
        session_id = _validate_session_id(request.args.get("session_id", ""))
        output_dir, files = _list_plot_image_files(session_id)
        return jsonify(success_payload(
            session_id=session_id,
            output_dir=str(output_dir),
            files=files,
            count=len(files),
        )), 200
    except FileNotFoundError as err:
        return jsonify(error_payload(str(err))), 404
    except ValueError as err:
        return jsonify(error_payload(str(err))), 400
    except Exception as err:
        return jsonify(error_payload(str(err))), 500


@history_bp.get("/plots/latest")
def list_latest_history_plot_images():
    try:
        model_epoch = _current_model_epoch()
        session_id = (
            _oldest_history_session_id_for_model_epoch(model_epoch)
            if model_epoch is not None
            else ""
        )
        if not session_id:
            return jsonify(success_payload(
                session_id="",
                output_dir="",
                files=[],
                count=0,
                model_epoch=model_epoch,
                message=(
                    "current model epoch not found"
                    if model_epoch is None
                    else f"no history plots found for model epoch {model_epoch}"
                ),
            )), 200

        output_dir, files = _list_plot_image_files(session_id)
        return jsonify(success_payload(
            session_id=session_id,
            model_epoch=model_epoch,
            output_dir=str(output_dir),
            files=files,
            count=len(files),
        )), 200
    except Exception as err:
        return jsonify(error_payload(str(err))), 500


@history_bp.get("/plot-file")
def history_plot_file():
    try:
        session_id = _validate_session_id(request.args.get("session_id", ""))
        filename = _validate_plot_image_filename(request.args.get("file", ""))
        output_dir = _get_plot_output_dir(session_id)
        target = (output_dir / filename).resolve()
        target.relative_to(output_dir.resolve())

        if not _is_plot_image_file(target):
            return jsonify(error_payload("plot image not found")), 404

        return send_from_directory(output_dir, filename)
    except FileNotFoundError as err:
        return jsonify(error_payload(str(err))), 404
    except ValueError as err:
        return jsonify(error_payload(str(err))), 400
    except Exception as err:
        return jsonify(error_payload(str(err))), 500
