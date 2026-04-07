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

if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=5000,
        debug=True,
    )