import json
from pathlib import Path

from config import TRAIN_CONFIG_PATH

TRAIN_CONFIG_PATH = Path(TRAIN_CONFIG_PATH)


def read_train_config():
    if not TRAIN_CONFIG_PATH.exists():
        return {
            "path": str(TRAIN_CONFIG_PATH),
            "config": {},
        }, 200

    with open(TRAIN_CONFIG_PATH, "r", encoding="utf-8") as f:
        config = json.load(f)

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

    TRAIN_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)

    with open(TRAIN_CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)

    return {
        "status": "saved",
        "path": str(TRAIN_CONFIG_PATH),
        "config": config,
    }, 200