#根目录
MIKI_ROOT = "/home/mingzhuo/miki"#请不要用相对路径

#日志文件路径
LOSS_FILE_PATH = MIKI_ROOT + "/data/loss.txt"
TRAIN_LOG_PATH = MIKI_ROOT + "/log/train.log"
TRAIN_SESSION_PATH = MIKI_ROOT + "/data/training_session.json"

#配置文件
TRAIN_CONFIG_PATH = MIKI_ROOT + "/config/train_config.json"

#训练脚本
BATTLE_SCRIPT_PATH = MIKI_ROOT + "/scripts/training_session/train.sh"
BATTLE_STOP_SCRIPT_PATH = MIKI_ROOT + "/scripts/training_session/stop_train.sh"


#LLM配置
OPENAI_MODEL = "claude-opus-4-6"
CHAT_SESSION_MEMORY_LIMIT = 12
