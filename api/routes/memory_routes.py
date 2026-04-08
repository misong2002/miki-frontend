# api/routes/memory_routes.py

from __future__ import annotations

from pathlib import Path

from flask import Blueprint, jsonify, request, send_from_directory

from memory.memory_runtime import (
    archive_wake_cycle,
    create_backup,
    get_long_term_memory_overview,
    get_recent_memory_snapshot,
    get_system_prompt_memory,
    rebuild_system_prompt_digest,
)
from services.chat_service import get_long_term_memory_retrieval_payload

memory_bp = Blueprint("memory", __name__)
MEMORY_STORAGE_DIR = (Path(__file__).resolve().parent.parent / "memory" / "storage").resolve()


@memory_bp.route("/api/memory/archive", methods=["POST"])
def archive_memory_route():
    data = request.get_json(silent=True) or {}

    try:
        result = archive_wake_cycle(data)
        return jsonify(result), 200
    except ValueError as e:
        return jsonify({"ok": False, "error": str(e)}), 400
    except Exception as e:
        print("[memory archive] error:", e, flush=True)
        return jsonify({"ok": False, "error": f"archive failed: {e}"}), 500


@memory_bp.route("/api/memory/long-term", methods=["GET"])
def long_term_memory_route():
    try:
        result = get_long_term_memory_overview()
        return jsonify(result), 200
    except Exception as e:
        print("[memory long-term] error:", e, flush=True)
        return jsonify({"ok": False, "error": f"read failed: {e}"}), 500


@memory_bp.route("/api/memory/system-prompt", methods=["GET"])
def system_prompt_memory_route():
    try:
        result = get_system_prompt_memory()
        return jsonify(result), 200
    except Exception as e:
        print("[memory system-prompt] error:", e, flush=True)
        return jsonify({"ok": False, "error": f"read failed: {e}"}), 500


@memory_bp.route("/api/memory/snapshot", methods=["GET"])
def memory_snapshot_route():
    try:
        summary_limit = int(request.args.get("summary_limit", 10))
        idea_limit = int(request.args.get("idea_limit", 10))
        result = get_recent_memory_snapshot(
            summary_limit=summary_limit,
            idea_limit=idea_limit,
        )
        return jsonify(result), 200
    except Exception as e:
        print("[memory snapshot] error:", e, flush=True)
        return jsonify({"ok": False, "error": f"snapshot failed: {e}"}), 500


@memory_bp.route("/api/memory/rebuild-digest", methods=["POST"])
def rebuild_digest_route():
    try:
        digest = rebuild_system_prompt_digest()
        return jsonify({"ok": True, "digest": digest}), 200
    except Exception as e:
        print("[memory rebuild-digest] error:", e, flush=True)
        return jsonify({"ok": False, "error": f"rebuild failed: {e}"}), 500


@memory_bp.route("/api/memory/retrieve", methods=["GET"])
def retrieve_memory_route():
    try:
        query = (request.args.get("query", "") or "").strip()
        limit = int(request.args.get("limit", 6))

        if not query:
            return jsonify({"ok": False, "error": "query is required"}), 400

        result = get_long_term_memory_retrieval_payload(query, limit=limit)
        return jsonify(result), 200
    except Exception as e:
        print("[memory retrieve] error:", e, flush=True)
        return jsonify({"ok": False, "error": f"retrieve failed: {e}"}), 500


@memory_bp.route("/api/memory/backup", methods=["POST"])
def backup_memory_route():
    try:
        result = create_backup()
        return jsonify(result), 200
    except Exception as e:
        print("[memory backup] error:", e, flush=True)
        return jsonify({"ok": False, "error": f"backup failed: {e}"}), 500


@memory_bp.route("/api/memory/storage/<path:filename>", methods=["GET"])
def memory_storage_file_route(filename: str):
    try:
        target = (MEMORY_STORAGE_DIR / filename).resolve()

        if target.parent != MEMORY_STORAGE_DIR or not target.is_file():
            return jsonify({"ok": False, "error": "file not found"}), 404

        return send_from_directory(MEMORY_STORAGE_DIR, filename, mimetype="application/json")
    except Exception as e:
        print("[memory storage] error:", e, flush=True)
        return jsonify({"ok": False, "error": f"read failed: {e}"}), 500
