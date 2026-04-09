from flask import Blueprint, jsonify, request

from services.train_service import (
    read_train_config,
    write_train_config,
    read_training_session,
    start_training,
    stop_training,
    read_training_loss,
    read_training_loss_summary_prompt,
)

battle_bp = Blueprint("battle", __name__)


@battle_bp.route("/api/battle/start", methods=["POST"])
def battle_start_route():
    payload = request.get_json(silent=True) or {}
    result, status_code = start_training(payload)
    return jsonify(result), status_code


@battle_bp.route("/api/battle/stop", methods=["POST"])
def battle_stop_route():
    result, status_code = stop_training()
    return jsonify(result), status_code


@battle_bp.route("/api/battle/status", methods=["GET"])
def battle_status_route():
    result, status_code = read_training_session()
    return jsonify(result), status_code


@battle_bp.route("/api/battle/loss", methods=["GET"])
def battle_loss_route():
    result, status_code = read_training_loss()
    return jsonify(result), status_code


@battle_bp.route("/api/battle/loss-summary-prompt", methods=["GET"])
def battle_loss_summary_prompt_route():
    result, status_code = read_training_loss_summary_prompt()
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