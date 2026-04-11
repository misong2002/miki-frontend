# miki-frontend/api/services/training_service.py

import json
import os
import sys
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any

from services.command_runner import command_result_payload, run_command
from services.response_service import error_payload, success_payload

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
        "loss_integration_grid",
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


def _append_frontend_manual_stop_notice() -> None:
    log_path = _get_train_log_path()
    log_path.parent.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().isoformat(timespec="seconds")
    with open(log_path, "a", encoding="utf-8") as f:
        f.write(f"INFO:frontend_manual_stop:{timestamp}: training session was stopped by the user from the frontend stop button\n")


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


def _read_train_log_tail(max_lines: int = 40) -> tuple[Path, list[str]]:
    log_path = _get_train_log_path()
    if not log_path.exists():
        return log_path, []

    try:
        lines = log_path.read_text(encoding="utf-8", errors="replace").splitlines()
    except Exception:
        return log_path, []

    tail = [line.rstrip() for line in lines if line.strip()][-max_lines:]
    return log_path, tail


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
        return success_payload(
            path=str(TRAIN_CONFIG_PATH),
            config=group_train_config({"model_name": default_model}),
            available_models=available_models,
            default_model=default_model,
        ), 200

    try:
        config = load_train_config(TRAIN_CONFIG_PATH)
        config["model_name"] = _normalize_model_name(config.get("model_name", default_model), default_model)
    except Exception as e:
        return error_payload(
            f"failed to read train config: {e}",
            path=str(TRAIN_CONFIG_PATH),
        ), 500

    return success_payload(
        path=str(TRAIN_CONFIG_PATH),
        config=group_train_config(config),
        available_models=available_models,
        default_model=default_model,
    ), 200


def write_train_config(payload):
    config = payload.get("config")
    if not isinstance(config, dict):
        return error_payload("config must be an object"), 400

    try:
        default_model, available_models = _load_available_models()
        flat_config = flatten_train_config(config)
        flat_config["model_name"] = _normalize_model_name(flat_config.get("model_name", default_model), default_model)
        TRAIN_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        saved_config = save_train_config(TRAIN_CONFIG_PATH, flat_config)

        return success_payload(
            status="saved",
            path=str(TRAIN_CONFIG_PATH),
            config=group_train_config(saved_config),
            available_models=available_models,
            default_model=default_model,
        ), 200

    except Exception as e:
        return error_payload(f"failed to write train config: {e}"), 500


def read_training_session():
    if not TRAIN_SESSION_PATH.exists():
        return success_payload(
            exists=False,
            running=False,
            status="idle",
        ), 200

    try:
        with open(TRAIN_SESSION_PATH, "r", encoding="utf-8") as f:
            import json
            session = json.load(f)
    except Exception as e:
        return error_payload(
            f"failed to read training_session.json: {e}",
            exists=False,
            running=False,
        ), 500

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
                result = run_command(["qstat", str(job_id)], cwd=MIKI_ROOT)
                running = result.returncode == 0
            except Exception:
                running = False

    else:
        return error_payload(
            f"unknown session mode: {mode}",
            exists=True,
            running=False,
            session=session,
        ), 500

    if not running:
        try:
            TRAIN_SESSION_PATH.unlink()
        except FileNotFoundError:
            pass

        return success_payload(
            exists=False,
            running=False,
            status="idle",
        ), 200

    return success_payload(
        exists=True,
        running=True,
        status="running",
        session=session,
    ), 200


def clear_loss_file() -> None:
    LOSS_FILE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(LOSS_FILE_PATH, "w", encoding="utf-8"):
        pass


def start_training(payload: dict[str, Any]):
    try:
        status_result, status_code = read_training_session()
        if status_code == 200 and status_result.get("running"):
            return success_payload(
                status="already_running",
                message="training session already running",
                session=status_result.get("session"),
            ), 200

        if not BATTLE_SCRIPT_PATH.exists():
            return error_payload(f"train script not found: {BATTLE_SCRIPT_PATH}"), 500

        config = build_train_config(payload)

        TRAIN_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        save_train_config(TRAIN_CONFIG_PATH, config)

        clear_loss_file()

        result = run_command(
            ["bash", str(BATTLE_SCRIPT_PATH), str(TRAIN_CONFIG_PATH)],
            cwd=MIKI_ROOT,
        )

        if result.returncode != 0:
            return error_payload(
                "train.sh failed",
                **command_result_payload(result),
            ), 500

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

        return success_payload(
            status="ok",
            message="training started",
            result=parsed,
            session=session_result.get("session") if isinstance(session_result, dict) else None,
        ), 200

    except Exception as e:
        traceback.print_exc()
        return error_payload(str(e)), 500


def stop_training():
    try:
        if not BATTLE_STOP_PATH.exists():
            return error_payload(f"stop script not found: {BATTLE_STOP_PATH}"), 500

        result = run_command(
            ["bash", str(BATTLE_STOP_PATH)],
            cwd=MIKI_ROOT,
        )

        if result.returncode != 0:
            return error_payload(result.stderr or result.stdout or "stop script failed"), 500

        _append_frontend_manual_stop_notice()
        return success_payload(status="ok", message=result.stdout.strip()), 200

    except Exception as e:
        traceback.print_exc()
        return error_payload(str(e)), 500


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



def _parse_loss_rows():
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
            if len(parts) < 2:
                continue

            try:
                epoch = float(parts[0])
                train_loss = float(parts[1])
                val_loss = float(parts[2]) if len(parts) >= 3 else None
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
        return list(rows)

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

    if sampled and sampled[-1] is not rows[-1]:
        sampled[-1] = rows[-1]

    return sampled



def _sample_loss_rows_for_summary(rows, max_points=1000):
    if len(rows) <= max_points:
        return sorted(rows, key=lambda row: row["epoch"])

    val_rows = [row for row in rows if row["val_loss"] is not None]
    if len(val_rows) >= max_points:
        return sorted(_downsample_rows_evenly(val_rows, max_points=max_points), key=lambda row: row["epoch"])

    selected = {id(row): row for row in val_rows}
    remaining_slots = max_points - len(selected)
    train_only_rows = [row for row in rows if row["val_loss"] is None]
    sampled_train_only = _downsample_rows_evenly(train_only_rows, max_points=remaining_slots)
    for row in sampled_train_only:
        selected[id(row)] = row

    combined = list(selected.values())
    return sorted(combined, key=lambda row: row["epoch"])



def build_training_loss_summary_prompt(max_points=1000):
    config = {}
    config_path = TRAIN_CONFIG_PATH

    if config_path.exists():
        try:
            config = load_train_config(config_path)
        except Exception:
            config = {}

    run_mode = str(config.get("run_mode", "local")).strip().lower()
    if run_mode == "debug":
        return ""

    rows = _parse_loss_rows()
    loss_file_path = _get_loss_file_path()
    train_log_path, train_log_tail = _read_train_log_tail()

    try:
        loss_mtime = loss_file_path.stat().st_mtime
    except Exception:
        loss_mtime = None

    try:
        log_mtime = train_log_path.stat().st_mtime
    except Exception:
        log_mtime = None

    sampled_rows = _sample_loss_rows_for_summary(rows, max_points=max_points) if rows else []
    expected_epochs = config.get("rounds")
    actual_epochs = rows[-1]["epoch"] if rows else None
    loss_lines = ["epoch train_loss val_loss"]

    for row in sampled_rows:
        val_loss = row["val_loss"]
        val_text = f"{val_loss:.8g}" if val_loss is not None else "none"
        loss_lines.append(
            f"{row['epoch']:g} {row['train_loss']:.8g} {val_text}"
        )

    summary_lines = [
        "这是我刚刚结束的一次战斗训练记录。请把它当成我亲身经历的训练结果，不要用第三者口吻评论我。",
        "请综合下面两部分信息一起评论我的训练结果，不要因为日志里有报错关键词就忽略 loss 曲线。",
        f"信息来源 1：downsample 后的 loss 曲线，来自当前运行时的 loss.txt：{loss_file_path}",
        f"loss.txt 最后修改时间：{loss_mtime:g}" if loss_mtime is not None else "loss.txt 最后修改时间：unknown",
        f"信息来源 2：训练日志最后几行，来自当前运行时的 train.log：{train_log_path}",
        f"train.log 最后修改时间：{log_mtime:g}" if log_mtime is not None else "train.log 最后修改时间：unknown",
        f"当前读取的 train_config 路径：{config_path}",
        f"配置里的预期 epoch 数：{expected_epochs if expected_epochs is not None else 'unknown'}",
        f"loss.txt 最后一行对应的实际 epoch 数：{actual_epochs:g}" if actual_epochs is not None else "loss.txt 最后一行对应的实际 epoch 数：unknown",
        "loss.txt 摘要：",
        "```text",
        *(loss_lines if len(loss_lines) > 1 else ["loss.txt 不存在或没有可解析的 loss 行"]),
        "```",
        "train.log 尾部：",
        "```text",
        *(train_log_tail if train_log_tail else ["train.log 不存在或尾部为空"]),
        "```",
    ]

    return "\n".join(summary_lines)

def read_training_loss_summary_prompt():
    try:
        prompt = build_training_loss_summary_prompt()
        return success_payload(
            path=str(_get_loss_file_path()),
            prompt=prompt,
            has_prompt=bool(prompt.strip()),
        ), 200
    except Exception as e:
        return error_payload(
            f"failed to build training loss summary prompt: {e}",
            path=str(_get_loss_file_path()),
            prompt="",
            has_prompt=False,
        ), 500


def read_training_loss():
    loss_file_path = _get_loss_file_path()
    if not loss_file_path.exists():
        return success_payload(
            path=str(loss_file_path),
            data=[],
            meta={
                "total_points": 0,
                "returned_points": 0,
                "downsampled": False,
            },
        ), 200

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

        return success_payload(
            path=str(loss_file_path),
            data=sampled_data,
            meta={
                "total_points": len(raw_data),
                "returned_points": len(sampled_data),
                "downsampled": len(sampled_data) < len(raw_data),
            },
        ), 200

    except Exception as e:
        return error_payload(
            f"failed to read loss file: {e}",
            path=str(loss_file_path),
            data=[],
            meta={
                "total_points": 0,
                "returned_points": 0,
                "downsampled": False,
            },
        ), 500
