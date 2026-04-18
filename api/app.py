import os

from flask import Flask
from flask_cors import CORS

from routes.battle_routes import battle_bp
from routes.chat_routes import chat_bp
from routes.memory_routes import memory_bp
from routes.history_routes import history_bp


def create_app() -> Flask:
    app = Flask(__name__)
    CORS(app)

    app.register_blueprint(battle_bp)
    app.register_blueprint(chat_bp)
    app.register_blueprint(memory_bp)
    app.register_blueprint(history_bp, url_prefix="/api/history")

    return app


app = create_app()


def _env_flag(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


if __name__ == "__main__":
    debug = _env_flag("MIKI_BACKEND_DEBUG", default=True)
    app.run(
        host="0.0.0.0",
        port=int(os.environ.get("MIKI_BACKEND_PORT", "38674")),
        debug=debug,
        use_reloader=_env_flag("MIKI_BACKEND_RELOAD", default=debug),
    )
