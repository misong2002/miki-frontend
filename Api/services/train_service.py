# miki-frontend/Api/services/training_service.py

import json
import os
import subprocess
import traceback
from pathlib import Path
from typing import Any

from config import (
    MIKI_ROOT,
    TRAIN_CONFIG_PATH,
    TRAIN_SESSION_PATH,
    LOSS_FILE_PATH,
    BATTLE_SCRIPT_PATH,
    BATTLE_STOP_SCRIPT_PATH,
)

MIKI_ROOT = Path(MIKI_ROOT).resolve()
TRAIN_CONFIG_PATH = Path(TRAIN_CONFIG_PATH)
TRAIN_SESSION_PATH = Path(TRAIN_SESSION_PATH)
LOSS_FILE_PATH = Path(LOSS_FILE_PATH)
BATTLE_SCRIPT_PATH = Path(BATTLE_SCRIPT_PATH)
BATTLE_STOP_PATH = Path(BATTLE_STOP_SCRIPT_PATH)


def parse_layer_sizes(layer_sizes_raw: Any) -> list[int]:
    if isinstance(layer_sizes_raw, list):
        return [int(x) for x in layer_sizes_raw]

    if isinstance(layer_sizes_raw, str):
        parts = [x.strip() for x in layer_sizes_raw.split(",") if x.strip()]
        return [int(x) for x in parts]

    raise ValueError(f"Invalid layerSizes format: {layer_sizes_raw}")


def build_train_config(payload):
    config = {}

    # 1 先读取旧配置
    if TRAIN_CONFIG_PATH.exists():
        with open(TRAIN_CONFIG_PATH, "r", encoding="utf-8") as f:
            config = json.load(f)

    # 2 payload 字段映射（前端命名 → 后端命名）
    key_map = {
        "modelName": "model_name",
        "layerSizes": "layer_sizes",
        "runMode": "run_mode",
    }

    # 3 覆盖更新 payload
    for key, value in payload.items():
        mapped_key = key_map.get(key, key)

        if mapped_key == "layer_sizes":
            value = parse_layer_sizes(value)

        config[mapped_key] = value

    # 4 默认值（只在不存在时补）
    config.setdefault("rounds", 200)
    config.setdefault("lr", 1e-3)
    config.setdefault("layer_sizes", [2, 128, 128, 3])
    config.setdefault("run_mode", "local")

    return config


def read_train_config():
    if not TRAIN_CONFIG_PATH.exists():
        return {
            "path": str(TRAIN_CONFIG_PATH),
            "config": {},
        }, 200

    try:
        with open(TRAIN_CONFIG_PATH, "r", encoding="utf-8") as f:
            config = json.load(f)
    except Exception as e:
        return {
            "status": "error",
            "message": f"failed to read train config: {e}",
            "path": str(TRAIN_CONFIG_PATH),
        }, 500

    return {
        "path": str(TRAIN_CONFIG_PATH),
        "config": config,
    }, 200


def write_train_config(payload):
    config = payload.get("config")
    if not isinstance(config, dict):
        return {
            "status": "error",
            "message": "config must be an object",
        }, 400

    try:
        TRAIN_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)

        with open(TRAIN_CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(config, f, ensure_ascii=False, indent=2)

        return {
            "status": "saved",
            "path": str(TRAIN_CONFIG_PATH),
            "config": config,
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

    if mode == "local" or mode == 'debug':
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
                running = (result.returncode == 0)
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
        with open(TRAIN_CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(config, f, ensure_ascii=False, indent=2)

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
    keep_recent: int = 200,
    max_history_samples: int = 1000,
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

        # 去重，避免 int 截断导致重复索引
        deduped = []
        last_epoch = None
        for item in sampled_history:
            epoch = item["epoch"]
            if epoch != last_epoch:
                deduped.append(item)
                last_epoch = epoch
        sampled_history = deduped

    return sampled_history + recent



def read_training_loss():
    if not LOSS_FILE_PATH.exists():
        return {
            "path": str(LOSS_FILE_PATH),
            "data": [],
            "meta": {
                "total_points": 0,
                "returned_points": 0,
                "downsampled": False,
            },
        }, 200

    raw_data: list[dict[str, float]] = []

    try:
        with open(LOSS_FILE_PATH, "r", encoding="utf-8") as f:
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
            keep_recent=100,
            max_history_samples=1000,
        )

        return {
            "path": str(LOSS_FILE_PATH),
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
            "path": str(LOSS_FILE_PATH),
            "data": [],
            "meta": {
                "total_points": 0,
                "returned_points": 0,
                "downsampled": False,
            },
        }, 500