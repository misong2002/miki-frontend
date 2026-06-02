from __future__ import annotations

from flask import Blueprint, jsonify, request

from services.code_agent_service import (
    list_code_files_payload,
    read_code_file_payload,
    search_code_payload,
)
from services.program_config_service import patch_train_config_payload
from services.tool_router_service import route_tools_payload


program_bp = Blueprint("program", __name__)


@program_bp.route("/api/program/train-config/patch", methods=["POST"])
def train_config_patch_route():
    payload = request.get_json(silent=True) or {}
    result, status_code = patch_train_config_payload(payload)
    return jsonify(result), status_code


@program_bp.route("/api/program/code-agent/list", methods=["POST"])
def code_agent_list_route():
    payload = request.get_json(silent=True) or {}
    result, status_code = list_code_files_payload(payload)
    return jsonify(result), status_code


@program_bp.route("/api/program/code-agent/read", methods=["POST"])
def code_agent_read_route():
    payload = request.get_json(silent=True) or {}
    result, status_code = read_code_file_payload(payload)
    return jsonify(result), status_code


@program_bp.route("/api/program/code-agent/search", methods=["POST"])
def code_agent_search_route():
    payload = request.get_json(silent=True) or {}
    result, status_code = search_code_payload(payload)
    return jsonify(result), status_code


@program_bp.route("/api/program/tool-router", methods=["POST"])
def tool_router_route():
    payload = request.get_json(silent=True) or {}
    result, status_code = route_tools_payload(payload)
    return jsonify(result), status_code
