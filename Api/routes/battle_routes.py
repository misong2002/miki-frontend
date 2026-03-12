from flask import Blueprint, jsonify, request

from services.battle_service import (
    start_battle,
    stop_battle,
    read_battle_loss,
)
from services.train_config_service import read_train_config, write_train_config
battle_bp = Blueprint("battle", __name__)


@battle_bp.route("/api/battle/start", methods=["POST"])
def battle_start_route():
    payload = request.get_json(silent=True) or {}
    result, status_code = start_battle(payload)
    return jsonify(result), status_code


@battle_bp.route("/api/battle/stop", methods=["POST"])
def battle_stop_route():
    result, status_code = stop_battle()
    return jsonify(result), status_code


@battle_bp.route("/api/battle/loss", methods=["GET"])
def battle_loss_route():
    result, status_code = read_battle_loss()
    return jsonify(result), status_code

@battle_bp.route("/api/train-config", methods=["GET"])
def train_config_get_route():
    result, status_code = read_train_config()
    return jsonify(result), status_code


@battle_bp.route("/api/train-config", methods=["POST"])
def train_config_post_route():
    payload = request.get_json(silent=True) or {}
    result, status_code = write_train_config(payload)
    return jsonify(result), status_code