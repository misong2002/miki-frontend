from __future__ import annotations

from pathlib import Path

from flask import Blueprint, jsonify, request, send_from_directory

from services.agent_reader_service import UPLOAD_CACHE_DIR
from services.agent_reader_service import summarize_paper_payload
from services.agent_search_service import web_search_payload
from services.response_service import error_payload


agent_bp = Blueprint("agent", __name__)


def _request_data() -> dict:
    if request.content_type and request.content_type.startswith("multipart/form-data"):
        return dict(request.form.items())
    return request.get_json(silent=True) or {}


@agent_bp.route("/api/agent/read-paper", methods=["POST"])
def read_paper_route():
    try:
        result = summarize_paper_payload(_request_data(), request.files.get("file"))
        return jsonify(result), 200
    except ValueError as exc:
        return jsonify(error_payload(str(exc))), 400
    except RuntimeError as exc:
        return jsonify(error_payload(str(exc))), 501
    except Exception as exc:
        print("[agent read-paper] error:", exc, flush=True)
        return jsonify(error_payload(f"read paper failed: {exc}")), 500


@agent_bp.route("/api/agent/uploads/<cache_id>/<path:filename>", methods=["GET"])
def uploaded_file_route(cache_id: str, filename: str):
    safe_id = "".join(ch for ch in str(cache_id) if ch.isalnum())
    if not safe_id or safe_id != cache_id:
        return jsonify(error_payload("invalid upload cache id")), 400

    cache_dir = (UPLOAD_CACHE_DIR / safe_id).resolve()
    try:
        cache_dir.relative_to(UPLOAD_CACHE_DIR.resolve())
    except ValueError:
        return jsonify(error_payload("invalid upload cache path")), 400

    if not cache_dir.exists():
        return jsonify(error_payload("upload cache not found")), 404

    return send_from_directory(cache_dir, Path(filename).name, as_attachment=False)


@agent_bp.route("/api/agent/web-search", methods=["POST"])
def web_search_route():
    try:
        result = web_search_payload(_request_data())
        return jsonify(result), 200
    except ValueError as exc:
        return jsonify(error_payload(str(exc))), 400
    except Exception as exc:
        print("[agent web-search] error:", exc, flush=True)
        return jsonify(error_payload(f"web search failed: {exc}")), 500
