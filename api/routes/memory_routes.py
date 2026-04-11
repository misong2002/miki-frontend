# api/routes/memory_routes.py

from __future__ import annotations

import os
from pathlib import Path

from flask import Blueprint, jsonify, request, send_from_directory

from services.response_service import error_payload
from services.memory_service import (
    archive_wake_cycle_payload,
    create_memory_backup_payload,
    get_long_term_memory_overview_payload,
    get_memory_storage_manifest,
    get_recent_memory_snapshot_payload,
    get_system_prompt_memory_payload,
    rebuild_system_prompt_digest_payload,
    retrieve_long_term_memory_payload,
)

memory_bp = Blueprint("memory", __name__)
MEMORY_STORAGE_DIR = (Path(__file__).resolve().parent.parent / "memory" / "storage").resolve()


def _is_memory_storage_debug_enabled() -> bool:
    return str(os.getenv("MIKI_EXPOSE_MEMORY_STORAGE", "")).strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _reject_storage_access():
    return jsonify(error_payload("memory storage debug endpoints are disabled")), 403


@memory_bp.route("/api/memory/archive", methods=["POST"])
def archive_memory_route():
    data = request.get_json(silent=True) or {}

    try:
        result = archive_wake_cycle_payload(data)
        return jsonify(result), 200
    except ValueError as e:
        return jsonify(error_payload(str(e))), 400
    except Exception as e:
        print("[memory archive] error:", e, flush=True)
        return jsonify(error_payload(f"archive failed: {e}")), 500


@memory_bp.route("/api/memory/long-term", methods=["GET"])
def long_term_memory_route():
    try:
        result = get_long_term_memory_overview_payload()
        return jsonify(result), 200
    except Exception as e:
        print("[memory long-term] error:", e, flush=True)
        return jsonify(error_payload(f"read failed: {e}")), 500


@memory_bp.route("/api/memory/system-prompt", methods=["GET"])
def system_prompt_memory_route():
    try:
        result = get_system_prompt_memory_payload()
        return jsonify(result), 200
    except Exception as e:
        print("[memory system-prompt] error:", e, flush=True)
        return jsonify(error_payload(f"read failed: {e}")), 500


@memory_bp.route("/api/memory/snapshot", methods=["GET"])
def memory_snapshot_route():
    try:
        summary_limit = int(request.args.get("summary_limit", 10))
        idea_limit = int(request.args.get("idea_limit", 10))
        result = get_recent_memory_snapshot_payload(
            summary_limit=summary_limit,
            idea_limit=idea_limit,
        )
        return jsonify(result), 200
    except Exception as e:
        print("[memory snapshot] error:", e, flush=True)
        return jsonify(error_payload(f"snapshot failed: {e}")), 500


@memory_bp.route("/api/memory/rebuild-digest", methods=["POST"])
def rebuild_digest_route():
    try:
        result = rebuild_system_prompt_digest_payload()
        return jsonify(result), 200
    except Exception as e:
        print("[memory rebuild-digest] error:", e, flush=True)
        return jsonify(error_payload(f"rebuild failed: {e}")), 500


@memory_bp.route("/api/memory/retrieve", methods=["GET"])
def retrieve_memory_route():
    try:
        query = (request.args.get("query", "") or "").strip()
        limit = int(request.args.get("limit", 6))

        if not query:
            return jsonify(error_payload("query is required")), 400

        result = retrieve_long_term_memory_payload(query, limit=limit)
        return jsonify(result), 200
    except Exception as e:
        print("[memory retrieve] error:", e, flush=True)
        return jsonify(error_payload(f"retrieve failed: {e}")), 500


@memory_bp.route("/api/memory/backup", methods=["POST"])
def backup_memory_route():
    try:
        result = create_memory_backup_payload()
        return jsonify(result), 200
    except Exception as e:
        print("[memory backup] error:", e, flush=True)
        return jsonify(error_payload(f"backup failed: {e}")), 500


@memory_bp.route("/api/memory/storage-layout", methods=["GET"])
def memory_storage_layout_route():
    if not _is_memory_storage_debug_enabled():
        return _reject_storage_access()

    try:
        return jsonify(get_memory_storage_manifest()), 200
    except Exception as e:
        print("[memory storage-layout] error:", e, flush=True)
        return jsonify(error_payload(f"read failed: {e}")), 500


@memory_bp.route("/api/memory/storage/<path:filename>", methods=["GET"])
def memory_storage_file_route(filename: str):
    if not _is_memory_storage_debug_enabled():
        return _reject_storage_access()

    try:
        target = (MEMORY_STORAGE_DIR / filename).resolve()
        target.relative_to(MEMORY_STORAGE_DIR)

        if not target.is_file():
            return jsonify(error_payload("file not found")), 404

        return send_from_directory(MEMORY_STORAGE_DIR, filename, mimetype="application/json")
    except ValueError:
        return jsonify(error_payload("file not found")), 404
    except Exception as e:
        print("[memory storage] error:", e, flush=True)
        return jsonify(error_payload(f"read failed: {e}")), 500
