import json
import os
import signal
import subprocess
from pathlib import Path
from threading import Lock
from typing import Any
import subprocess
import json
from urllib import request

from config import (
    LOSS_FILE_PATH,
    BATTLE_SCRIPT_PATH,
    MIKI_ROOT,
    TRAIN_CONFIG_PATH,
    BATTLE_STOP_SCRIPT_PATH
)

LOSS_FILE_PATH = Path(LOSS_FILE_PATH)
BATTLE_SCRIPT_PATH = Path(BATTLE_SCRIPT_PATH)
TRAIN_CONFIG_PATH = Path(TRAIN_CONFIG_PATH)
MIKI_ROOT = Path(MIKI_ROOT).resolve()
BATTLE_STOP_PATH = Path(BATTLE_STOP_SCRIPT_PATH)

_battle_process = None
_battle_lock = Lock()


def parse_layer_sizes(layer_sizes_raw: Any) -> list[int]:
    if isinstance(layer_sizes_raw, list):
        return [int(x) for x in layer_sizes_raw]

    if isinstance(layer_sizes_raw, str):
        parts = [x.strip() for x in layer_sizes_raw.split(",") if x.strip()]
        return [int(x) for x in parts]

    raise ValueError("Invalid layerSizes format")


def build_battle_config(payload: dict[str, Any]) -> dict[str, Any]:
    layer_sizes = parse_layer_sizes(payload.get("layerSizes", "2,128,128,3"))

    return {
        "model_name": payload.get("modelName", "hadron_Matrix_siren"),
        "dataset": payload.get("dataset", "data/simulation.hdf5"),
        "flux": payload.get("flux", "data/flux.dat"),
        "output": payload.get("output", "data/siren_params.npz"),
        "rounds": int(payload.get("rounds", 200)),
        "lr": float(payload.get("lr", 1e-3)),
        "layer_sizes": layer_sizes,
        "loss_file": "data/loss.txt",
    }


def write_battle_config(config: dict[str, Any]) -> None:
    TRAIN_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(TRAIN_CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)


def clear_loss_file() -> None:
    LOSS_FILE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(LOSS_FILE_PATH, "w", encoding="utf-8"):
        pass


def is_battle_running() -> bool:
    global _battle_process
    return _battle_process is not None and _battle_process.poll() is None


def battle_start(payload: dict[str, Any]):

    battle_config = {
        "model_name": payload.get("modelName", "hadron_Matrix_siren"),
        "dataset": payload.get("dataset", "data/simulation.hdf5"),
        "flux": payload.get("flux", "data/flux.dat"),
        "output": payload.get("output", "data/siren_params.npz"),
        "rounds": int(payload.get("rounds", 200)),
        "lr": float(payload.get("lr", 1e-3)),
        "layer_sizes": payload.get("layerSizes", [2, 128, 128, 3]),
        "run_mode": payload.get("runMode", "local"),
        "queue": payload.get("queue", "massive_distrib"),
        "walltime": payload.get("walltime", "06:00:00"),
        "nodes": int(payload.get("nodes", 1)),
        "ppn": int(payload.get("ppn", 1)),
    }

    with open(TRAIN_CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(battle_config, f, ensure_ascii=False, indent=2)

    if LOSS_FILE_PATH.exists():
        LOSS_FILE_PATH.unlink()

    result = subprocess.run(
        ["bash", str(BATTLE_SCRIPT_PATH), str(TRAIN_CONFIG_PATH)],
        capture_output=True,
        text=True,
        cwd=str(MIKI_ROOT),
    )

    if result.returncode != 0:
        {
            "status": "error",
            "message": result.stderr or result.stdout,
        }, 500

    stdout = result.stdout.strip()
    try:
        data = json.loads(stdout.splitlines()[-1])
    except Exception:
        data = {"raw_output": stdout}

    return {
        "status": "ok",
        "result": data,
    }


def battle_stop():
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
    }


def read_battle_loss() -> tuple[dict[str, Any], int]:
    path = LOSS_FILE_PATH

    if not path.exists():
        return {
            "path": str(path),
            "data": [],
        }, 200

    data: list[dict[str, float]] = []

    with open(path, "r", encoding="utf-8") as f:
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

            data.append({
                "epoch": epoch,
                "loss": loss,
            })

    return {
        "path": str(path),
        "data": data,
    }, 200