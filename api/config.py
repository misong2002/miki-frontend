import json
from pathlib import Path

# 根目录
MIKI_ROOT = "/home/mingzhuo/miki"  # 请不要用相对路径
API_DIR = Path(__file__).resolve().parent
FRONTEND_ROOT = API_DIR.parent
SHARED_CONFIG_PATH = FRONTEND_ROOT / "shared" / "battle_chart_config.json"

with SHARED_CONFIG_PATH.open("r", encoding="utf-8") as f:
    _BATTLE_CHART_CONFIG = json.load(f)

# 日志文件路径
LOSS_FILE_PATH = MIKI_ROOT + "/data/loss.txt"
TRAIN_LOG_PATH = MIKI_ROOT + "/log/train.log"
TRAIN_LIVE_LOG_PATH = MIKI_ROOT + "/log/train.live.log"
TRAIN_SESSION_PATH = MIKI_ROOT + "/data/training_session.json"

# 配置文件
TRAIN_CONFIG_PATH = MIKI_ROOT + "/config/train_config.json"

# 训练脚本
BATTLE_SCRIPT_PATH = MIKI_ROOT + "/scripts/training_session/train.sh"
BATTLE_STOP_SCRIPT_PATH = MIKI_ROOT + "/scripts/training_session/stop_train.sh"

# 历史目录
HISTORY_ROOT = MIKI_ROOT + "/history"

# 历史工具脚本
SAVE_HISTORY_SCRIPT_PATH = MIKI_ROOT + "/scripts/training_session/save_history.sh"
INITIALIZE_SCRIPT_PATH = MIKI_ROOT + "/scripts/training_session/initialize.sh"
PLOT_SCRIPT_PATH = MIKI_ROOT + "/scripts/plot/plot.py"


# LLM配置
OPENAI_FAST_MODEL = "deepseek-v4-flash"
OPENAI_THINKING_MODEL = "deepseek-v4-pro"
OPENAI_MODEL = OPENAI_THINKING_MODEL
CHAT_SESSION_MEMORY_LIMIT = 12
PROFILE_BUNDLE_MAX_FACTS = 20

# Battle / loss sampling
BATTLE_RECENT_WINDOW_POINTS = int(_BATTLE_CHART_CONFIG["recentWindowPoints"])
BATTLE_GLOBAL_SNAPSHOT_MAX_POINTS = int(
    _BATTLE_CHART_CONFIG["globalSnapshotMaxPoints"]
)
