# miki-frontend/api/services/training_service.py

import json
import os
import subprocess
import sys
import traceback
from pathlib import Path
from typing import Any

from config import (
    MIKI_ROOT,
    TRAIN_CONFIG_PATH,
    TRAIN_SESSION_PATH,
    LOSS_FILE_PATH,
    TRAIN_LOG_PATH,
    BATTLE_SCRIPT_PATH,
    BATTLE_STOP_SCRIPT_PATH,
    BATTLE_RECENT_WINDOW_POINTS,
    BATTLE_GLOBAL_SNAPSHOT_MAX_POINTS,
)

MIKI_ROOT = Path(MIKI_ROOT).resolve()
TRAIN_CONFIG_PATH = Path(TRAIN_CONFIG_PATH)
TRAIN_SESSION_PATH = Path(TRAIN_SESSION_PATH)
LOSS_FILE_PATH = Path(LOSS_FILE_PATH)
TRAIN_LOG_PATH = Path(TRAIN_LOG_PATH)
BATTLE_SCRIPT_PATH = Path(BATTLE_SCRIPT_PATH)
BATTLE_STOP_PATH = Path(BATTLE_STOP_SCRIPT_PATH)
PATH_CONFIG_PATH = MIKI_ROOT / "config" / "path.json"
AVAILABLE_MODELS_PATH = MIKI_ROOT / "config" / "available_models.json"
sys.path.insert(0, str(MIKI_ROOT))

from scripts.utils.train_config_utils import load_train_config, save_train_config

SECTION_NAMES = [
    "io_config",
    "model_config",
    "optimization_config",
    "cluster_config",
    "debug_config",
]

SECTION_KEYS = {
    "io_config": ["dataset", "dataset_config", "flux", "output", "loss_file"],
    "model_config": [
        "model_name",
        "layer_sizes",
        "hidden_features",
        "hidden_layers",
        "outermost_linear",
        "first_omega_0",
        "hidden_omega_0",
    ],
    "optimization_config": [
        "batch_size",
        "checkpoint_every",
        "log_every",
        "loss_mode",
        "lr",
        "rounds",
        "seed",
        "val_every",
    ],
    "cluster_config": ["queue", "nodes", "walltime"],
    "debug_config": ["debug_sleep_ms", "debug_steps"],
}


def parse_layer_sizes(layer_sizes_raw: Any) -> list[int]:
    if isinstance(layer_sizes_raw, list):
        return [int(x) for x in layer_sizes_raw]

    if isinstance(layer_sizes_raw, str):
        parts = [x.strip() for x in layer_sizes_raw.split(",") if x.strip()]
        return [int(x) for x in parts]

    raise ValueError(f"Invalid layerSizes format: {layer_sizes_raw}")


def _load_path_config() -> dict[str, Any]:
    if not PATH_CONFIG_PATH.exists():
        return {}

    try:
        with open(PATH_CONFIG_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return {}

    return data if isinstance(data, dict) else {}


def _resolve_runtime_path(path_key: str, fallback: Path) -> Path:
    path_config = _load_path_config()
    raw_value = path_config.get(path_key)
    if not raw_value:
        return fallback

    ref = Path(str(raw_value))
    if ref.is_absolute():
        return ref

    project_root = path_config.get("project_root")
    if project_root:
        return Path(project_root).resolve() / ref

    return MIKI_ROOT / ref


def _get_loss_file_path() -> Path:
    return _resolve_runtime_path("loss_file", LOSS_FILE_PATH)


def _get_train_log_path() -> Path:
    return _resolve_runtime_path("log_file", TRAIN_LOG_PATH)


LEGACY_MODEL_NAME_MAP = {
    "hadron_Matrix_siren": "HMsiren",
}


def _normalize_model_name(model_name: Any, default_model: str = "HMsiren") -> str:
    raw_name = str(model_name or "").strip()
    if not raw_name:
        return default_model
    return LEGACY_MODEL_NAME_MAP.get(raw_name, raw_name)


def _load_available_models() -> tuple[str, list[str]]:
    default_model = "HMsiren"
    available_models = [default_model]

    if AVAILABLE_MODELS_PATH.exists():
        try:
            with open(AVAILABLE_MODELS_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            models = []
            for item in data.get("models", []):
                if not isinstance(item, dict):
                    continue
                name = str(item.get("name", "")).strip()
                if name:
                    models.append(name)
            if models:
                available_models = models
            configured_default = str(data.get("default_model", "")).strip()
            if configured_default:
                default_model = configured_default
        except Exception:
            pass

    normalized_models = []
    for name in available_models:
        normalized = _normalize_model_name(name, default_model)
        if normalized not in normalized_models:
            normalized_models.append(normalized)

    default_model = _normalize_model_name(default_model, normalized_models[0] if normalized_models else "HMsiren")
    if default_model not in normalized_models:
        normalized_models.insert(0, default_model)

    return default_model, normalized_models


def _extract_training_error_summary(max_lines: int = 40) -> str:
    log_path = _get_train_log_path()
    if not log_path.exists():
        return ""

    try:
        lines = log_path.read_text(encoding="utf-8", errors="replace").splitlines()
    except Exception:
        return ""

    tail = [line.rstrip() for line in lines if line.strip()][-max_lines:]
    if not tail:
        return ""

    error_markers = (
        "traceback",
        "error",
        "exception",
        "failed",
        "interrupted system call",
        "nan",
        "inf",
        "floatingpointerror",
        "valueerror",
        "runtimeerror",
        "typeerror",
        "assertionerror",
    )

    has_error = any(marker in line.casefold() for line in tail for marker in error_markers)
    if not has_error:
        return ""

    summary_lines = [
        "我们刚刚完成了一段训练，但训练日志里出现了错误。请优先评论这个错误，不要再分析 loss 曲线：",
        f"训练日志路径：{log_path}",
        "```text",
        *tail,
        "```",
    ]
    return "\n".join(summary_lines)


def group_train_config(flat_config: dict[str, Any]) -> dict[str, Any]:
    remaining = dict(flat_config)
    grouped_sections: dict[str, dict[str, Any]] = {}

    for section_name in SECTION_NAMES:
        section = {}
        for key in SECTION_KEYS.get(section_name, []):
            if key in remaining:
                section[key] = remaining.pop(key)
        grouped_sections[section_name] = section

    default_model, _available_models = _load_available_models()

    model_section = grouped_sections.get("model_config", {})
    if isinstance(model_section, dict):
        model_section["model_name"] = _normalize_model_name(
            model_section.get("model_name", default_model),
            default_model,
        )

    return {
        "run_mode": flat_config.get("run_mode", "local"),
        "sections": grouped_sections,
    }


def flatten_train_config(config: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(config, dict):
        raise ValueError("config must be an object")

    sections = config.get("sections")
    if not isinstance(sections, dict):
        flat = dict(config)
        if "layer_sizes" in flat:
            flat["layer_sizes"] = parse_layer_sizes(flat["layer_sizes"])
        flat.setdefault("run_mode", "local")
        return flat

    flat: dict[str, Any] = {
        "run_mode": config.get("run_mode", "local"),
    }

    for section_name in SECTION_NAMES:
        section = sections.get(section_name, {})
        if not isinstance(section, dict):
            continue
        for key, value in section.items():
            if key == "layer_sizes":
                value = parse_layer_sizes(value)
            flat[key] = value

    return flat


def build_train_config(payload):
    config = {}
    default_model, _available_models = _load_available_models()

    if TRAIN_CONFIG_PATH.exists():
        config = load_train_config(TRAIN_CONFIG_PATH)
        config["model_name"] = _normalize_model_name(config.get("model_name", default_model), default_model)

    if payload:
        incoming = flatten_train_config(payload)
        incoming["model_name"] = _normalize_model_name(incoming.get("model_name", default_model), default_model)
        config.update(incoming)

    config.setdefault("rounds", 200)
    config.setdefault("lr", 1e-3)
    config.setdefault("layer_sizes", [2, 128, 128, 3])
    config.setdefault("run_mode", "local")
    config["model_name"] = _normalize_model_name(config.get("model_name", default_model), default_model)

    return config


def read_train_config():
    default_model, available_models = _load_available_models()

    if not TRAIN_CONFIG_PATH.exists():
        return {
            "path": str(TRAIN_CONFIG_PATH),
            "config": group_train_config({"model_name": default_model}),
            "available_models": available_models,
            "default_model": default_model,
        }, 200

    try:
        config = load_train_config(TRAIN_CONFIG_PATH)
        config["model_name"] = _normalize_model_name(config.get("model_name", default_model), default_model)
    except Exception as e:
        return {
            "status": "error",
            "message": f"failed to read train config: {e}",
            "path": str(TRAIN_CONFIG_PATH),
        }, 500

    return {
        "path": str(TRAIN_CONFIG_PATH),
        "config": group_train_config(config),
        "available_models": available_models,
        "default_model": default_model,
    }, 200


def write_train_config(payload):
    config = payload.get("config")
    if not isinstance(config, dict):
        return {
            "status": "error",
            "message": "config must be an object",
        }, 400

    try:
        default_model, available_models = _load_available_models()
        flat_config = flatten_train_config(config)
        flat_config["model_name"] = _normalize_model_name(flat_config.get("model_name", default_model), default_model)
        TRAIN_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        saved_config = save_train_config(TRAIN_CONFIG_PATH, flat_config)

        return {
            "status": "saved",
            "path": str(TRAIN_CONFIG_PATH),
            "config": group_train_config(saved_config),
            "available_models": available_models,
            "default_model": default_model,
        }, 200

    except Exception as e:
        return {
            "status": "error",
            "message": f"failed to write train config: {e}",
        }, 500


def read_training_session():
    if not TRAIN_SESSION_PATH.exists():
        return {
            "exists": False,
            "running": False,
            "status": "idle",
        }, 200

    try:
        with open(TRAIN_SESSION_PATH, "r", encoding="utf-8") as f:
            import json
            session = json.load(f)
    except Exception as e:
        return {
            "exists": False,
            "running": False,
            "status": "error",
            "message": f"failed to read training_session.json: {e}",
        }, 500

    mode = session.get("mode")
    pid = session.get("pid")
    pgid = session.get("pgid")
    job_id = session.get("job_id")

    running = False

    if mode == "local" or mode == "debug":
        if pgid is not None:
            try:
                os.killpg(int(pgid), 0)
                running = True
            except Exception:
                running = False
        elif pid is not None:
            try:
                os.kill(int(pid), 0)
                running = True
            except Exception:
                running = False

    elif mode == "cluster":
        if job_id:
            try:
                result = subprocess.run(
                    ["qstat", str(job_id)],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    check=False,
                )
                running = result.returncode == 0
            except Exception:
                running = False

    else:
        return {
            "exists": True,
            "running": False,
            "status": "error",
            "message": f"unknown session mode: {mode}",
            "session": session,
        }, 500

    if not running:
        try:
            TRAIN_SESSION_PATH.unlink()
        except FileNotFoundError:
            pass

        return {
            "exists": False,
            "running": False,
            "status": "idle",
        }, 200

    return {
        "exists": True,
        "running": True,
        "status": "running",
        "session": session,
    }, 200


def clear_loss_file() -> None:
    LOSS_FILE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(LOSS_FILE_PATH, "w", encoding="utf-8"):
        pass


def start_training(payload: dict[str, Any]):
    try:
        status_result, status_code = read_training_session()
        if status_code == 200 and status_result.get("running"):
            return {
                "status": "already_running",
                "message": "training session already running",
                "session": status_result.get("session"),
            }, 200

        if not BATTLE_SCRIPT_PATH.exists():
            return {
                "status": "error",
                "message": f"train script not found: {BATTLE_SCRIPT_PATH}",
            }, 500

        config = build_train_config(payload)

        TRAIN_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        save_train_config(TRAIN_CONFIG_PATH, config)

        clear_loss_file()

        result = subprocess.run(
            ["bash", str(BATTLE_SCRIPT_PATH), str(TRAIN_CONFIG_PATH)],
            capture_output=True,
            text=True,
            cwd=str(MIKI_ROOT),
        )

        if result.returncode != 0:
            return {
                "status": "error",
                "message": "train.sh failed",
                "stdout": result.stdout,
                "stderr": result.stderr,
            }, 500

        stdout = result.stdout.strip()
        last_line = stdout.splitlines()[-1] if stdout else ""

        try:
            import json
            parsed = json.loads(last_line) if last_line else {}
        except Exception:
            parsed = {
                "raw_stdout": stdout,
                "raw_stderr": result.stderr,
            }

        session_result, _ = read_training_session()

        return {
            "status": "ok",
            "message": "training started",
            "result": parsed,
            "session": session_result.get("session") if isinstance(session_result, dict) else None,
        }, 200

    except Exception as e:
        traceback.print_exc()
        return {
            "status": "error",
            "message": str(e),
        }, 500


def stop_training():
    try:
        if not BATTLE_STOP_PATH.exists():
            return {
                "status": "error",
                "message": f"stop script not found: {BATTLE_STOP_PATH}",
            }, 500

        result = subprocess.run(
            ["bash", str(BATTLE_STOP_PATH)],
            capture_output=True,
            text=True,
            cwd=str(MIKI_ROOT),
        )

        if result.returncode != 0:
            return {
                "status": "error",
                "message": result.stderr or result.stdout,
            }, 500

        return {
            "status": "ok",
            "message": result.stdout.strip(),
        }, 200

    except Exception as e:
        traceback.print_exc()
        return {
            "status": "error",
            "message": str(e),
        }, 500


def downsample_loss_data(
    data: list[dict[str, float]],
    keep_recent: int = BATTLE_RECENT_WINDOW_POINTS,
    max_history_samples: int = BATTLE_GLOBAL_SNAPSHOT_MAX_POINTS,
) -> list[dict[str, float]]:
    n = len(data)

    if n <= keep_recent + max_history_samples:
        return data

    split_index = max(0, n - keep_recent)
    history = data[:split_index]
    recent = data[split_index:]

    if len(history) <= max_history_samples:
        sampled_history = history
    else:
        step = len(history) / max_history_samples
        sampled_history = []
        for i in range(max_history_samples):
            idx = int(i * step)
            if idx >= len(history):
                idx = len(history) - 1
            sampled_history.append(history[idx])

        deduped = []
        last_epoch = None
        for item in sampled_history:
            epoch = item["epoch"]
            if epoch != last_epoch:
                deduped.append(item)
                last_epoch = epoch
        sampled_history = deduped

    return sampled_history + recent



def _parse_loss_rows_with_val():
    rows = []

    loss_file_path = _get_loss_file_path()
    if not loss_file_path.exists():
        return rows

    with open(loss_file_path, "r", encoding="utf-8") as f:
        for raw_line in f:
            line = raw_line.strip()
            if not line:
                continue

            parts = line.split()
            if len(parts) < 3:
                continue

            try:
                epoch = float(parts[0])
                train_loss = float(parts[1])
                val_loss = float(parts[2])
            except ValueError:
                continue

            rows.append({
                "epoch": epoch,
                "train_loss": train_loss,
                "val_loss": val_loss,
            })

    return rows



def _downsample_rows_evenly(rows, max_points=1000):
    if len(rows) <= max_points:
        return rows

    step = (len(rows) - 1) / (max_points - 1)
    sampled = []
    seen = set()

    for i in range(max_points):
        idx = int(round(i * step))
        idx = max(0, min(idx, len(rows) - 1))
        if idx in seen:
            continue
        sampled.append(rows[idx])
        seen.add(idx)

    if sampled[-1] is not rows[-1]:
        sampled[-1] = rows[-1]

    return sampled



def build_training_loss_summary_prompt(max_points=1000):
    config = {}

    if TRAIN_CONFIG_PATH.exists():
        try:
            config = load_train_config(TRAIN_CONFIG_PATH)
        except Exception:
            config = {}

    run_mode = str(config.get("run_mode", "local")).strip().lower()
    if run_mode == "debug":
        return ""

    error_summary = _extract_training_error_summary()
    if error_summary:
        return error_summary

    rows = _parse_loss_rows_with_val()
    if not rows:
        return ""

    sampled_rows = _downsample_rows_evenly(rows, max_points=max_points)
    expected_epochs = config.get("rounds")
    actual_epochs = rows[-1]["epoch"] if rows else None
    lines = ["epoch train_loss val_loss"]

    for row in sampled_rows:
        lines.append(
            f"{row['epoch']:g} {row['train_loss']:.8g} {row['val_loss']:.8g}"
        )

    summary_lines = [
        "我们刚刚完成了一段训练，这是training loss和val loss的曲线：",
        f"配置里的预期 epoch 数：{expected_epochs if expected_epochs is not None else 'unknown'}",
        f"loss.txt 最后一行对应的实际 epoch 数：{actual_epochs:g}" if actual_epochs is not None else "loss.txt 最后一行对应的实际 epoch 数：unknown",
        "```text",
        *lines,
        "```",
    ]

    return "\n".join(summary_lines)

def read_training_loss_summary_prompt():
    try:
        prompt = build_training_loss_summary_prompt()
        return {
            "path": str(_get_loss_file_path()),
            "prompt": prompt,
            "has_prompt": bool(prompt.strip()),
        }, 200
    except Exception as e:
        return {
            "status": "error",
            "message": f"failed to build training loss summary prompt: {e}",
            "path": str(_get_loss_file_path()),
            "prompt": "",
            "has_prompt": False,
        }, 500


def read_training_loss():
    loss_file_path = _get_loss_file_path()
    if not loss_file_path.exists():
        return {
            "path": str(loss_file_path),
            "data": [],
            "meta": {
                "total_points": 0,
                "returned_points": 0,
                "downsampled": False,
            },
        }, 200

    raw_data: list[dict[str, float]] = []

    try:
        with open(loss_file_path, "r", encoding="utf-8") as f:
            for raw_line in f:
                line = raw_line.strip()
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

                raw_data.append({
                    "epoch": epoch,
                    "loss": loss,
                })

        sampled_data = downsample_loss_data(
            raw_data,
            keep_recent=BATTLE_RECENT_WINDOW_POINTS,
            max_history_samples=BATTLE_GLOBAL_SNAPSHOT_MAX_POINTS,
        )

        return {
            "path": str(loss_file_path),
            "data": sampled_data,
            "meta": {
                "total_points": len(raw_data),
                "returned_points": len(sampled_data),
                "downsampled": len(sampled_data) < len(raw_data),
            },
        }, 200

    except Exception as e:
        return {
            "status": "error",
            "message": f"failed to read loss file: {e}",
            "path": str(loss_file_path),
            "data": [],
            "meta": {
                "total_points": 0,
                "returned_points": 0,
                "downsampled": False,
            },
        }, 500
