from __future__ import annotations

import copy
import json
import re
from typing import Any

from services.response_service import error_payload, success_payload
from services.train_service import read_train_config, write_train_config


CONFIG_PATH_RE = re.compile(r"^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$")
ALLOWED_ROOTS = {"run_mode", "sections"}
CONFIG_TYPE_HINTS = {
    "run_mode": {"type": "enum", "values": {"local", "cluster", "debug"}},
    "sections.io_config.dataset_type": {"type": "enum", "values": {"local", "Doraemon"}},
    "sections.io_config.output": {"type": "string"},
    "sections.io_config.flux": {"type": "string"},
    "sections.local_dataset_config.dataset": {"type": "string"},
    "sections.local_dataset_config.dataset_config": {"type": "string"},
    "sections.local_dataset_config.loss_file": {"type": "string"},
    "sections.doraemon_dataset_config.doraemon_generator": {"type": "string"},
    "sections.doraemon_dataset_config.doraemon_oscillation": {"type": "enum", "values": {"osc", "unosc"}},
    "sections.doraemon_dataset_config.doraemon_flavor": {
        "type": "enum",
        "values": {"numu", "numubar", "nue", "nuebar"},
    },
    "sections.doraemon_dataset_config.doraemon_beam_mode": {
        "type": "enum",
        "values": {"FHC", "RHC"},
    },
    "sections.model_config.model_name": {"type": "string"},
    "sections.model_config.hidden_features": {"type": "int"},
    "sections.model_config.hidden_layers": {"type": "int"},
    "sections.model_config.outermost_linear": {"type": "bool"},
    "sections.model_config.first_omega_0": {"type": "number"},
    "sections.model_config.hidden_omega_0": {"type": "number"},
    "sections.model_config.weight_gaussian_perturbation": {"type": "number"},
    "sections.optimization_config.batch_size": {"type": "int"},
    "sections.optimization_config.checkpoint_every": {"type": "int"},
    "sections.optimization_config.log_every": {"type": "int"},
    "sections.optimization_config.loss_mode": {"type": "string"},
    "sections.optimization_config.loss_integration_grid": {"type": "int"},
    "sections.optimization_config.loss_numerical_integration": {
        "type": "enum",
        "values": {"bin_sum", "adaptive", "gauss_legendre"},
    },
    "sections.optimization_config.lr": {"type": "number"},
    "sections.optimization_config.rounds": {"type": "int"},
    "sections.optimization_config.seed": {"type": "int"},
    "sections.optimization_config.val_every": {"type": "int"},
    "sections.cluster_config.queue": {"type": "string"},
    "sections.cluster_config.nodes": {"type": "int"},
    "sections.cluster_config.walltime": {"type": "string"},
    "sections.debug_config.debug_sleep_ms": {"type": "int"},
    "sections.debug_config.debug_steps": {"type": "int"},
}


def _parse_value(value: Any) -> Any:
    if not isinstance(value, str):
        return value

    raw = value.strip()
    if not raw:
        return ""

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    lower = raw.lower()
    if lower == "true":
        return True
    if lower == "false":
        return False
    if lower == "null":
        return None

    try:
        if any(ch in raw for ch in [".", "e", "E"]):
            return float(raw)
        return int(raw)
    except ValueError:
        return raw


def _set_path(target: dict[str, Any], path: str, value: Any) -> None:
    if not CONFIG_PATH_RE.fullmatch(path):
        raise ValueError("invalid config path")

    parts = path.split(".")
    if parts[0] not in ALLOWED_ROOTS:
        raise ValueError("config path must start with run_mode or sections")

    node: Any = target
    for part in parts[:-1]:
        if not isinstance(node, dict):
            raise ValueError(f"cannot set nested path through non-object: {part}")
        if part not in node:
            node[part] = {}
        if not isinstance(node[part], dict):
            raise ValueError(f"cannot set nested path through non-object: {part}")
        node = node[part]

    if not isinstance(node, dict):
        raise ValueError("target parent is not an object")
    node[parts[-1]] = value


def _get_path(target: dict[str, Any], path: str) -> Any:
    node: Any = target
    for part in path.split("."):
        if not isinstance(node, dict) or part not in node:
            return None
        node = node[part]
    return node


def _validate_type(path: str, value: Any, current_value: Any) -> None:
    hint = CONFIG_TYPE_HINTS.get(path)
    expected = hint.get("type") if hint else None

    if expected is None and current_value is not None:
        if isinstance(current_value, bool):
            expected = "bool"
        elif isinstance(current_value, int) and not isinstance(current_value, bool):
            expected = "int"
        elif isinstance(current_value, float):
            expected = "number"
        elif isinstance(current_value, str):
            expected = "string"

    if expected == "enum":
        values = hint.get("values", set()) if hint else set()
        if value not in values:
            raise ValueError(f"{path} must be one of: {', '.join(sorted(values))}")
        return

    if expected == "bool" and not isinstance(value, bool):
        raise ValueError(f"{path} must be a boolean")

    if expected == "int":
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError(f"{path} must be an integer")

    if expected == "number":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"{path} must be a number")

    if expected == "string" and not isinstance(value, str):
        raise ValueError(f"{path} must be a string")


def patch_train_config_payload(payload: dict[str, Any]) -> tuple[dict[str, Any], int]:
    path = str(payload.get("path") or "").strip()
    value = _parse_value(payload.get("value"))

    if not path:
        return error_payload("path is required"), 400

    read_result, read_status = read_train_config()
    if read_status != 200:
        return read_result, read_status

    config = copy.deepcopy(read_result.get("config"))
    if not isinstance(config, dict):
        return error_payload("current config is not an object"), 500

    try:
        current_value = _get_path(config, path)
        _validate_type(path, value, current_value)
        _set_path(config, path, value)
    except ValueError as exc:
        return error_payload(str(exc)), 400

    write_result, write_status = write_train_config({"config": config})
    if write_status != 200:
        return write_result, write_status

    return success_payload(
        status="saved",
        patch={
            "path": path,
            "value": value,
        },
        config=write_result.get("config"),
        available_models=write_result.get("available_models"),
        default_model=write_result.get("default_model"),
        path=write_result.get("path"),
    ), 200
