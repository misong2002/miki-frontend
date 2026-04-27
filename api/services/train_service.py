# miki-frontend/api/services/training_service.py

from __future__ import annotations

import json
import os
import re
import shutil
import sys
import threading
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
    TRAIN_LIVE_LOG_PATH,
    BATTLE_SCRIPT_PATH,
    BATTLE_STOP_SCRIPT_PATH,
    HISTORY_ROOT,
    SAVE_HISTORY_SCRIPT_PATH,
    PLOT_SCRIPT_PATH,
    BATTLE_RECENT_WINDOW_POINTS,
    BATTLE_GLOBAL_SNAPSHOT_MAX_POINTS,
)

MIKI_ROOT = Path(MIKI_ROOT).resolve()
TRAIN_CONFIG_PATH = Path(TRAIN_CONFIG_PATH)
TRAIN_SESSION_PATH = Path(TRAIN_SESSION_PATH)
LOSS_FILE_PATH = Path(LOSS_FILE_PATH)
TRAIN_LOG_PATH = Path(TRAIN_LOG_PATH)
TRAIN_LIVE_LOG_PATH = Path(TRAIN_LIVE_LOG_PATH)
BATTLE_SCRIPT_PATH = Path(BATTLE_SCRIPT_PATH)
BATTLE_STOP_PATH = Path(BATTLE_STOP_SCRIPT_PATH)
HISTORY_DIR = Path(HISTORY_ROOT)
SAVE_HISTORY_SCRIPT = Path(SAVE_HISTORY_SCRIPT_PATH)
PLOT_SCRIPT = Path(PLOT_SCRIPT_PATH)
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
    "misc_config",
]

SECTION_KEYS = {
    "io_config": ["dataset", "dataset_config", "flux", "output", "loss_file"],
    "model_config": [
        "model_name",
        "hidden_features",
        "hidden_layers",
        "outermost_linear",
        "first_omega_0",
        "hidden_omega_0",
        "weight_gaussian_perturbation",
    ],
    "optimization_config": [
        "batch_size",
        "checkpoint_every",
        "log_every",
        "loss_mode",
        "loss_integration_grid",
        "loss_numerical_integration",
        "loss_integration_configs",
        "lr",
        "rounds",
        "seed",
        "val_every",
    ],
    "cluster_config": ["queue", "nodes", "walltime"],
    "debug_config": ["debug_sleep_ms", "debug_steps"],
    "misc_config": [],
}



CONFIG_SECTION_FILE_MAP = {
    "io_config": "config/training_config/io.json",
    "model_config": "config/training_config/model.json",
    "optimization_config": "config/training_config/optimization.json",
    "cluster_config": "config/training_config/cluster.json",
    "debug_config": "config/training_config/debug.json",
}

OPTIMIZATION_INTEGRATION_CONFIG_FILE_MAP = {
    "bin_sum": "config/training_config/optimization/bin_sum.json",
    "adaptive": "config/training_config/optimization/adaptive.json",
    "gauss_legendre": "config/training_config/optimization/gauss_legendre.json",
}
OPTIMIZATION_INTEGRATION_CONFIG_KEYS = [
    "loss_input1_min",
    "loss_input1_max",
    "loss_input2_min",
    "loss_input2_max",
    "loss_input1_bins",
    "loss_input2_bins",
    "num_E_nu_bins",
    "adaptive_max_depth",
    "adaptive_min_events",
    "adaptive_min_cell_area",
    "adaptive_refine_mode",
    "adaptive_gradient_coarse_bins",
    "adaptive_gradient_smooth_sigma",
    "adaptive_gradient_quantile",
    "adaptive_gradient_eps",
    "gauss_legendre_input1_order",
    "gauss_legendre_input2_order",
]

_AUTO_HISTORY_LOCK = threading.Lock()
_AUTO_HISTORY_SESSION_RE = re.compile(
    r"history_session=(\d{8}_\d{6}/(?:epoch\d+\(model on epoch \d+\)(?:_\d+)?|\d+))"
)
_HISTORY_SESSION_RE = re.compile(r"^\d{8}_\d{6}$")
_HISTORY_LEAF_NAME_RE = re.compile(r"^epoch\d+\(model on epoch \d+\)(?:_\d+)?$|^\d+$")


def _config_root(config_path: str | Path) -> Path:
    path = Path(config_path).resolve()
    if path.parent.name == "config":
        return path.parent.parent
    return path.parent


def _resolve_config_ref(config_path: str | Path, ref: str | Path) -> Path:
    ref_path = Path(ref)
    if ref_path.is_absolute():
        return ref_path
    return _config_root(config_path) / ref_path


def _load_json_object(path: str | Path) -> dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError(f"config must be a JSON object: {path}")
    return data


def _load_train_manifest() -> dict[str, Any]:
    if not TRAIN_CONFIG_PATH.exists():
        return {}

    try:
        return _load_json_object(TRAIN_CONFIG_PATH)
    except Exception:
        return {}


def _section_ref_from_manifest(
    manifest: dict[str, Any],
    section_name: str,
) -> str:
    raw_ref = manifest.get(section_name)
    if isinstance(raw_ref, str) and raw_ref.strip():
        return raw_ref
    return CONFIG_SECTION_FILE_MAP[section_name]


def _load_config_sections_from_files(
    manifest: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    sections: dict[str, dict[str, Any]] = {}

    for section_name in CONFIG_SECTION_FILE_MAP:
        ref = _section_ref_from_manifest(manifest, section_name)
        section_path = _resolve_config_ref(TRAIN_CONFIG_PATH, ref)
        if not section_path.exists():
            sections[section_name] = {}
            continue
        sections[section_name] = _load_json_object(section_path)

    optimization = sections.get("optimization_config")
    if isinstance(optimization, dict):
        integration_refs = optimization.get("loss_integration_configs")
        if not isinstance(integration_refs, dict):
            integration_refs = OPTIMIZATION_INTEGRATION_CONFIG_FILE_MAP

        integration_configs = {}
        for mode, default_ref in OPTIMIZATION_INTEGRATION_CONFIG_FILE_MAP.items():
            ref = integration_refs.get(mode, default_ref)
            if not isinstance(ref, str) or not ref.strip():
                ref = default_ref
            integration_path = _resolve_config_ref(TRAIN_CONFIG_PATH, ref)
            integration_configs[mode] = (
                _load_json_object(integration_path)
                if integration_path.exists()
                else {}
            )
        optimization["loss_integration_configs"] = integration_configs

    return sections


def _write_config_sections_to_files(config: dict[str, Any]) -> dict[str, Any]:
    sections = config.get("sections")
    if not isinstance(sections, dict):
        raise ValueError("config.sections must be an object")

    existing_manifest = _load_train_manifest()
    manifest: dict[str, Any] = {
        key: value
        for key, value in existing_manifest.items()
        if key not in CONFIG_SECTION_FILE_MAP and key != "run_mode"
    }
    manifest.setdefault("version", existing_manifest.get("version", 2))
    manifest["run_mode"] = config.get(
        "run_mode",
        existing_manifest.get("run_mode", "local"),
    )

    TRAIN_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)

    for section_name in CONFIG_SECTION_FILE_MAP:
        ref = _section_ref_from_manifest(existing_manifest, section_name)
        section_data = sections.get(section_name, {})
        if section_data is None:
            section_data = {}
        if not isinstance(section_data, dict):
            raise ValueError(f"{section_name} must be an object")

        integration_configs = None
        if section_name == "optimization_config":
            section_data = dict(section_data)
            raw_integration_configs = section_data.pop("loss_integration_configs", {})
            integration_configs = (
                raw_integration_configs
                if isinstance(raw_integration_configs, dict)
                else {}
            )
            section_data["loss_integration_configs"] = OPTIMIZATION_INTEGRATION_CONFIG_FILE_MAP

        section_path = _resolve_config_ref(TRAIN_CONFIG_PATH, ref)
        section_path.parent.mkdir(parents=True, exist_ok=True)
        with open(section_path, "w", encoding="utf-8") as f:
            json.dump(section_data, f, ensure_ascii=False, indent=2)
            f.write("\n")

        if integration_configs is not None:
            for mode, integration_ref in OPTIMIZATION_INTEGRATION_CONFIG_FILE_MAP.items():
                integration_path = _resolve_config_ref(TRAIN_CONFIG_PATH, integration_ref)
                if mode in integration_configs:
                    integration_data = integration_configs.get(mode, {})
                else:
                    integration_data = (
                        _load_json_object(integration_path)
                        if integration_path.exists()
                        else {}
                    )
                if integration_data is None:
                    integration_data = {}
                if not isinstance(integration_data, dict):
                    raise ValueError(f"loss_integration_configs.{mode} must be an object")

                integration_path.parent.mkdir(parents=True, exist_ok=True)
                with open(integration_path, "w", encoding="utf-8") as f:
                    json.dump(integration_data, f, ensure_ascii=False, indent=2)
                    f.write("\n")

        manifest[section_name] = ref

    with open(TRAIN_CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
        f.write("\n")

    return manifest


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


def _get_train_live_log_path() -> Path:
    return TRAIN_LIVE_LOG_PATH


def _leaf_sort_key(leaf_name: str) -> tuple[int, int, int]:
    if leaf_name.isdigit():
        return int(leaf_name), -1, 0

    match = re.fullmatch(
        r"epoch(?P<loss>\d+)\(model on epoch (?P<model>\d+)\)(?:_(?P<suffix>\d+))?",
        leaf_name,
    )
    if match:
        return (
            int(match.group("loss")),
            int(match.group("model")),
            int(match.group("suffix") or 0),
        )

    return -1, -1, -1


def _list_history_session_ids() -> list[str]:
    if not HISTORY_DIR.exists():
        return []

    items = []
    for item in HISTORY_DIR.iterdir():
        if not item.is_dir():
            continue

        timestamp = item.name
        if not _HISTORY_SESSION_RE.fullmatch(timestamp):
            continue

        for child in item.iterdir():
            if not child.is_dir() or not _HISTORY_LEAF_NAME_RE.fullmatch(child.name):
                continue
            items.append(f"{timestamp}/{child.name}")

    items.sort(
        key=lambda session_id: (
            session_id.split("/", 1)[0],
            *_leaf_sort_key(session_id.split("/", 1)[1]),
        ),
        reverse=True,
    )
    return items


def _latest_history_session_id() -> str:
    sessions = _list_history_session_ids()
    return sessions[0] if sessions else ""


def _latest_auto_history_session_id() -> str:
    if not HISTORY_DIR.exists():
        return ""

    candidates: list[str] = []
    for marker in HISTORY_DIR.rglob(".auto"):
        try:
            resolved_marker = marker.resolve()
            resolved_marker.relative_to(HISTORY_DIR.resolve())
            session_path = marker.parent.resolve()
            session_path.relative_to(HISTORY_DIR.resolve())
        except Exception:
            continue

        if not marker.is_file() and not marker.is_symlink():
            continue

        relative_path = session_path.relative_to(HISTORY_DIR.resolve())
        session_id = str(relative_path).replace(os.sep, "/")
        if "/" not in session_id:
            continue
        candidates.append(session_id)

    if not candidates:
        return ""

    candidates.sort(
        key=lambda session_id: (
            session_id.split("/", 1)[0],
            *_leaf_sort_key(session_id.split("/", 1)[1]),
        ),
        reverse=True,
    )
    return candidates[0]


def _model_epoch_from_session_id(session_id: str) -> int | None:
    if not session_id or "/" not in session_id:
        return None

    leaf_name = session_id.split("/", 1)[1]
    match = re.fullmatch(
        r"epoch\d+\(model on epoch (?P<model>\d+)\)(?:_\d+)?",
        leaf_name,
    )
    if match:
        return int(match.group("model"))

    return None


def _current_model_epoch() -> int | None:
    try:
        config = load_train_config(TRAIN_CONFIG_PATH)
    except Exception:
        return None

    output = config.get("output")
    if not output:
        return None

    best_path = Path(output)
    if not best_path.is_absolute():
        best_path = MIKI_ROOT / best_path
    latest_path = Path(str(best_path).removesuffix(".npz") + ".latest.npz")

    for model_path in (latest_path, best_path):
        if not model_path.is_file():
            continue
        try:
            import numpy as np

            data = np.load(model_path, allow_pickle=True)
            if "epoch" not in data.files:
                continue
            value = data["epoch"]
            if getattr(value, "shape", ()):
                value = value.reshape(-1)[0]
            else:
                value = value.item()
            return int(value)
        except Exception:
            continue

    return None


def _should_refresh_auto_history_on_battle_start() -> bool:
    current_model_epoch = _current_model_epoch()
    latest_auto_session_id = _latest_auto_history_session_id()
    latest_auto_model_epoch = _model_epoch_from_session_id(latest_auto_session_id)

    if current_model_epoch is None:
        return not latest_auto_session_id

    if not latest_auto_session_id:
        return True

    return latest_auto_model_epoch != current_model_epoch


def _remove_auto_history_sessions() -> list[str]:
    removed = []
    if not HISTORY_DIR.exists():
        return removed

    for marker in HISTORY_DIR.rglob(".auto"):
        try:
            resolved_marker = marker.resolve()
            resolved_marker.relative_to(HISTORY_DIR.resolve())
            session_path = marker.parent.resolve()
            session_path.relative_to(HISTORY_DIR.resolve())
        except Exception:
            continue

        if not marker.is_file() and not marker.is_symlink():
            continue

        shutil.rmtree(session_path)
        removed.append(str(session_path))

    return removed


def _mark_auto_history_session(session_id: str) -> Path | None:
    if not session_id:
        return None

    session_path = (HISTORY_DIR / session_id).resolve()
    try:
        session_path.relative_to(HISTORY_DIR.resolve())
    except ValueError:
        return None

    if not session_path.is_dir():
        return None

    marker_path = session_path / ".auto"
    marker_path.touch()
    return marker_path


def _plot_auto_history_session(session_id: str) -> dict[str, Any]:
    if not session_id:
        return {
            "ok": False,
            "error": "history_session was not returned by save_history.sh",
        }

    if not PLOT_SCRIPT.is_file():
        return {
            "ok": False,
            "error": f"plot script not found: {PLOT_SCRIPT}",
        }

    result = run_command(
        [sys.executable, str(PLOT_SCRIPT), session_id],
        cwd=MIKI_ROOT,
    )

    return {
        "ok": result.returncode == 0,
        **command_result_payload(result),
    }


def _save_auto_history_for_live_log() -> dict[str, Any]:
    with _AUTO_HISTORY_LOCK:
        removed_sessions = _remove_auto_history_sessions()
        previous_session_id = _latest_history_session_id()
        previous_model_epoch = _model_epoch_from_session_id(previous_session_id)

        if not SAVE_HISTORY_SCRIPT.is_file():
            return {
                "ok": False,
                "error": f"save_history.sh not found: {SAVE_HISTORY_SCRIPT}",
                "removed_auto_sessions": removed_sessions,
                "previous_history_session": previous_session_id,
                "previous_model_epoch": previous_model_epoch,
            }

        result = run_command(
            ["bash", str(SAVE_HISTORY_SCRIPT), str(TRAIN_CONFIG_PATH)],
            cwd=MIKI_ROOT,
            check=True,
        )

        stdout = getattr(result, "stdout", "") or ""
        match = _AUTO_HISTORY_SESSION_RE.search(stdout)
        history_session = match.group(1) if match else ""
        current_model_epoch = _model_epoch_from_session_id(history_session)
        should_plot = not (
            previous_model_epoch is not None
            and current_model_epoch is not None
            and previous_model_epoch == current_model_epoch
        )
        marker_path = _mark_auto_history_session(history_session)
        plot_result = (
            _plot_auto_history_session(history_session)
            if should_plot
            else {
                "ok": True,
                "skipped": True,
                "message": "skipped plot because model epoch did not change",
            }
        )

        return {
            "ok": True,
            "history_session": history_session,
            "session_id": history_session,
            "previous_history_session": previous_session_id,
            "previous_model_epoch": previous_model_epoch,
            "model_epoch": current_model_epoch,
            "should_plot": should_plot,
            "auto_marker": str(marker_path) if marker_path is not None else "",
            "removed_auto_sessions": removed_sessions,
            "plot": plot_result,
            **command_result_payload(result),
        }


def _try_save_auto_history_for_live_log() -> dict[str, Any]:
    try:
        return _save_auto_history_for_live_log()
    except Exception as e:
        return {
            "ok": False,
            "error": "auto save_history failed",
            **command_result_payload(e),
        }


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
    run_mode = remaining.pop("run_mode", "local")
    grouped_sections: dict[str, dict[str, Any]] = {}

    for section_name in SECTION_NAMES:
        section = {}
        for key in SECTION_KEYS.get(section_name, []):
            if key in remaining:
                section[key] = remaining.pop(key)
        grouped_sections[section_name] = section

    optimization = grouped_sections.get("optimization_config", {})
    if isinstance(optimization, dict):
        selected_mode = str(optimization.get("loss_numerical_integration", "bin_sum")).strip()
        selected_mode = "gauss_legendre" if selected_mode == "gauss-legendre" else selected_mode
        integration_config = {}
        for key in OPTIMIZATION_INTEGRATION_CONFIG_KEYS:
            if key in remaining:
                integration_config[key] = remaining.pop(key)
        if integration_config:
            optimization["loss_integration_configs"] = {
                selected_mode: integration_config,
            }

    grouped_sections["misc_config"].update(remaining)

    default_model, _available_models = _load_available_models()

    model_section = grouped_sections.get("model_config", {})
    if isinstance(model_section, dict):
        model_section["model_name"] = _normalize_model_name(
            model_section.get("model_name", default_model),
            default_model,
        )

    return {
        "run_mode": run_mode,
        "sections": grouped_sections,
    }


def flatten_train_config(config: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(config, dict):
        raise ValueError("config must be an object")

    sections = config.get("sections")
    if not isinstance(sections, dict):
        flat = dict(config)
        flat.setdefault("run_mode", "local")
        return flat

    flat: dict[str, Any] = {
        "run_mode": config.get("run_mode", "local"),
    }

    ordered_section_names = [
        *SECTION_NAMES,
        *[name for name in sections.keys() if name not in SECTION_NAMES],
    ]

    for section_name in ordered_section_names:
        section = sections.get(section_name, {})
        if not isinstance(section, dict):
            continue
        if section_name == "optimization_config":
            selected_mode = str(section.get("loss_numerical_integration", "bin_sum")).strip()
            integration_configs = section.get("loss_integration_configs")
            if isinstance(integration_configs, dict):
                selected_config = integration_configs.get(selected_mode)
                if selected_config is None and selected_mode == "gauss-legendre":
                    selected_config = integration_configs.get("gauss_legendre")
                if isinstance(selected_config, dict):
                    flat.update(selected_config)
        for key, value in section.items():
            if section_name == "optimization_config" and key == "loss_integration_configs":
                continue
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

    config.pop("layer_sizes", None)
    config.setdefault("rounds", 200)
    config.setdefault("lr", 1e-3)
    config.setdefault("hidden_features", 128)
    config.setdefault("hidden_layers", 3)
    config.setdefault("run_mode", "local")
    config["model_name"] = _normalize_model_name(config.get("model_name", default_model), default_model)

    return config


def read_train_config():
    default_model, available_models = _load_available_models()

    if not TRAIN_CONFIG_PATH.exists():
        return success_payload(
            path=str(TRAIN_CONFIG_PATH),
            config={
                "run_mode": "local",
                "sections": {
                    section_name: {}
                    for section_name in CONFIG_SECTION_FILE_MAP
                },
            },
            available_models=available_models,
            default_model=default_model,
        ), 200

    try:
        manifest = _load_json_object(TRAIN_CONFIG_PATH)
        has_section_refs = any(
            isinstance(manifest.get(section_name), str)
            for section_name in CONFIG_SECTION_FILE_MAP
        )

        if has_section_refs:
            sections = _load_config_sections_from_files(manifest)
            config = {
                "run_mode": manifest.get("run_mode", "local"),
                "sections": sections,
            }
        else:
            config = group_train_config(load_train_config(TRAIN_CONFIG_PATH))
    except Exception as e:
        return error_payload(
            f"failed to read train config: {e}",
            path=str(TRAIN_CONFIG_PATH),
        ), 500

    return success_payload(
        path=str(TRAIN_CONFIG_PATH),
        config=config,
        available_models=available_models,
        default_model=default_model,
    ), 200


def write_train_config(payload):
    config = payload.get("config")
    if not isinstance(config, dict):
        return error_payload("config must be an object"), 400

    try:
        default_model, available_models = _load_available_models()

        if isinstance(config.get("sections"), dict):
            _write_config_sections_to_files(config)
            read_result, read_status = read_train_config()
            if read_status != 200:
                return read_result, read_status
            return success_payload(
                status="saved",
                path=str(TRAIN_CONFIG_PATH),
                config=read_result.get("config"),
                available_models=available_models,
                default_model=default_model,
            ), 200

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

        if isinstance(payload.get("sections"), dict):
            write_result, write_status = write_train_config({"config": payload})
            if write_status != 200:
                return write_result, write_status
            build_train_config({})
        else:
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


def read_training_live_log(offset: int | None = None):
    live_log_path = _get_train_live_log_path()

    if not live_log_path.exists():
        auto_history = (
            _try_save_auto_history_for_live_log()
            if offset is None and _should_refresh_auto_history_on_battle_start()
            else None
        )
        return success_payload(
            path=str(live_log_path),
            exists=False,
            offset=0,
            next_offset=0,
            lines=[],
            truncated=False,
            auto_history=auto_history,
        ), 200

    try:
        file_size = live_log_path.stat().st_size
        start_offset = file_size if offset is None else max(0, int(offset))
        truncated = start_offset > file_size
        if truncated:
            start_offset = 0

        with open(live_log_path, "rb") as f:
            f.seek(start_offset)
            chunk = f.read()
            next_offset = f.tell()

        text = chunk.decode("utf-8", errors="replace")
        lines = text.splitlines()
        auto_history = (
            _try_save_auto_history_for_live_log()
            if lines or (offset is None and _should_refresh_auto_history_on_battle_start())
            else None
        )

        return success_payload(
            path=str(live_log_path),
            exists=True,
            offset=start_offset,
            next_offset=next_offset,
            lines=lines,
            truncated=truncated,
            auto_history=auto_history,
        ), 200
    except Exception as e:
        return error_payload(
            f"failed to read train.live.log: {e}",
            path=str(live_log_path),
            exists=live_log_path.exists(),
            offset=offset,
            next_offset=offset,
            lines=[],
            truncated=False,
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
