import json
import os
import signal
import subprocess
from pathlib import Path
from threading import Lock
from typing import Any

from config import (
    LOSS_FILE_PATH,
    BATTLE_SCRIPT_PATH,
    BATTLE_CONFIG_PATH,
    MIKI_ROOT,
)

LOSS_FILE_PATH = Path(LOSS_FILE_PATH)
BATTLE_SCRIPT_PATH = Path(BATTLE_SCRIPT_PATH)
BATTLE_CONFIG_PATH = Path(BATTLE_CONFIG_PATH)
MIKI_ROOT = Path(MIKI_ROOT).resolve()

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
    BATTLE_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(BATTLE_CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)


def clear_loss_file() -> None:
    LOSS_FILE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(LOSS_FILE_PATH, "w", encoding="utf-8"):
        pass


def is_battle_running() -> bool:
    global _battle_process
    return _battle_process is not None and _battle_process.poll() is None


def start_battle(payload: dict[str, Any]) -> tuple[dict[str, Any], int]:
    global _battle_process

    with _battle_lock:
        if is_battle_running():
            return {
                "status": "already_running",
                "pid": _battle_process.pid,
            }, 200

        if not BATTLE_SCRIPT_PATH.exists():
            return {
                "status": "error",
                "message": f"battle script not found: {BATTLE_SCRIPT_PATH}",
            }, 500

        try:
            battle_config = build_battle_config(payload)
        except Exception as e:
            return {
                "status": "error",
                "message": f"invalid payload: {e}",
            }, 400

        write_battle_config(battle_config)
        clear_loss_file()

        try:
            _battle_process = subprocess.Popen(
                ["bash", str(BATTLE_SCRIPT_PATH.resolve()), str(BATTLE_CONFIG_PATH.resolve())],
                cwd=str(MIKI_ROOT),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                preexec_fn=os.setsid,
            )
        except Exception as e:
            _battle_process = None
            return {
                "status": "error",
                "message": f"failed to start battle process: {e}",
            }, 500

        return {
            "status": "started",
            "pid": _battle_process.pid,
            "config_path": str(BATTLE_CONFIG_PATH),
            "config": battle_config,
        }, 200


def stop_battle() -> tuple[dict[str, Any], int]:
    global _battle_process

    with _battle_lock:
        if _battle_process is None or _battle_process.poll() is not None:
            _battle_process = None
            return {"status": "not_running"}, 200

        try:
            os.killpg(os.getpgid(_battle_process.pid), signal.SIGTERM)
            _battle_process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            os.killpg(os.getpgid(_battle_process.pid), signal.SIGKILL)
        except ProcessLookupError:
            pass
        finally:
            _battle_process = None

        return {"status": "stopped"}, 200


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