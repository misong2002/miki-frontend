# backend/memory/memory_store.py

from __future__ import annotations

import json
import shutil
from pathlib import Path
from threading import RLock
from typing import Any, Dict, List, Optional

from .memory_types import (
    create_empty_long_term_db,
    now_ms,
)

BASE_DIR = Path(__file__).resolve().parent
STORAGE_DIR = BASE_DIR / "storage"
BACKUP_DIR = STORAGE_DIR / "backups"
ARCHIVE_LOG_DIR = STORAGE_DIR / "archive_logs"
LEGACY_DIR = STORAGE_DIR / "legacy"
COLLECTIONS_DIR = STORAGE_DIR / "collections"
META_PATH = STORAGE_DIR / "meta.json"
DB_PATH = STORAGE_DIR / "long_term_db.json"

COLLECTION_NAMES = [
    "session_summaries",
    "user_facts",
    "idea_memories",
    "idea_tag_catalog",
    "project_states",
    "memory_digests",
]


_db_lock = RLock()


def _normalize_tag_value(value: Any) -> str:
    return str(value or "").strip()


def _derive_idea_tag_catalog_from_db(db: Dict[str, Any]) -> List[str]:
    seen = set()
    catalog = []

    for idea in db.get("idea_memories", []):
        tags = idea.get("tags") or []
        if not isinstance(tags, list):
            continue

        for raw_tag in tags:
            tag = _normalize_tag_value(raw_tag)
            if not tag:
                continue

            tag_key = tag.casefold()
            if tag_key in seen:
                continue

            seen.add(tag_key)
            catalog.append(tag)

    return sorted(catalog, key=lambda item: item.casefold())


def ensure_storage_dirs() -> None:
    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    ARCHIVE_LOG_DIR.mkdir(parents=True, exist_ok=True)
    LEGACY_DIR.mkdir(parents=True, exist_ok=True)
    COLLECTIONS_DIR.mkdir(parents=True, exist_ok=True)


def _build_default_snapshot() -> Dict[str, Any]:
    db = create_empty_long_term_db()
    db["meta"]["version"] = 2
    db["meta"]["storage_mode"] = "collection_files"
    return db


def _normalize_db_shape(db: Dict[str, Any]) -> Dict[str, Any]:
    default_db = _build_default_snapshot()

    if not isinstance(db, dict):
        db = {}

    for key in default_db:
        if key not in db or not isinstance(db[key], type(default_db[key])):
            db[key] = default_db[key]

    if not isinstance(db.get("meta"), dict):
        db["meta"] = default_db["meta"].copy()

    for meta_key, meta_value in default_db["meta"].items():
        if meta_key not in db["meta"]:
            db["meta"][meta_key] = meta_value

    db["meta"]["version"] = 2
    db["meta"]["storage_mode"] = "collection_files"
    db["idea_tag_catalog"] = _derive_idea_tag_catalog_from_db(db)

    return db


def _collection_path(name: str) -> Path:
    return COLLECTIONS_DIR / f"{name}.json"


def _read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default

    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def _write_json(path: Path, payload: Any) -> None:
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with tmp_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    tmp_path.replace(path)


def _load_meta() -> Dict[str, Any]:
    default_meta = _build_default_snapshot()["meta"]
    meta = _read_json(META_PATH, default_meta.copy())

    if not isinstance(meta, dict):
        meta = default_meta.copy()

    for key, value in default_meta.items():
        if key not in meta:
            meta[key] = value

    meta["version"] = 2
    meta["storage_mode"] = "collection_files"
    return meta


def _save_meta(meta: Dict[str, Any]) -> None:
    normalized = _load_meta()
    normalized.update(meta or {})
    normalized["version"] = 2
    normalized["storage_mode"] = "collection_files"
    _write_json(META_PATH, normalized)


def _load_collection(name: str) -> List[Dict[str, Any]] | List[str]:
    payload = _read_json(_collection_path(name), [])

    if isinstance(payload, dict):
        items = payload.get("items", [])
        return items if isinstance(items, list) else []

    return payload if isinstance(payload, list) else []


def _save_collection(name: str, items: List[Dict[str, Any]] | List[str]) -> None:
    payload = {
        "name": name,
        "storage_version": 1,
        "updated_at": now_ms(),
        "items": items,
    }
    _write_json(_collection_path(name), payload)


def _build_manifest(meta: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    resolved_meta = meta or _load_meta()
    return {
        "layout_version": 2,
        "storage_mode": "collection_files",
        "meta": {
            "version": resolved_meta.get("version", 2),
            "updated_at": resolved_meta.get("updated_at"),
            "last_archive_at": resolved_meta.get("last_archive_at"),
            "last_digest_rebuild_at": resolved_meta.get("last_digest_rebuild_at"),
        },
        "meta_path": "meta.json",
        "collections_dir": "collections",
        "collections": {
            name: f"collections/{name}.json"
            for name in COLLECTION_NAMES
        },
    }


def _save_manifest(meta: Optional[Dict[str, Any]] = None) -> None:
    _write_json(DB_PATH, _build_manifest(meta))


def get_storage_manifest() -> Dict[str, Any]:
    with _db_lock:
        ensure_storage_dirs()
        _ensure_collection_storage_ready()
        return _build_manifest()


def _is_legacy_monolith(payload: Any) -> bool:
    return isinstance(payload, dict) and "session_summaries" in payload and "user_facts" in payload


def _persist_snapshot(db: Dict[str, Any]) -> Dict[str, Any]:
    normalized = _normalize_db_shape(db)
    normalized["meta"]["updated_at"] = now_ms()

    _save_meta(normalized["meta"])
    for name in COLLECTION_NAMES:
        _save_collection(name, normalized.get(name, []))
    _save_manifest(normalized["meta"])

    return normalized


def _bootstrap_empty_storage() -> None:
    _persist_snapshot(_build_default_snapshot())


def _migrate_legacy_monolith() -> None:
    legacy_payload = _read_json(DB_PATH, None)
    if not _is_legacy_monolith(legacy_payload):
        _bootstrap_empty_storage()
        return

    backup_path = LEGACY_DIR / f"long_term_db_legacy_{now_ms()}.json"
    shutil.copy2(DB_PATH, backup_path)
    _persist_snapshot(legacy_payload)


def _has_collection_storage() -> bool:
    if not META_PATH.exists():
        return False

    return any(_collection_path(name).exists() for name in COLLECTION_NAMES)


def _ensure_collection_storage_ready() -> None:
    ensure_storage_dirs()

    if _has_collection_storage():
        if not DB_PATH.exists() or _is_legacy_monolith(_read_json(DB_PATH, None)):
            _save_manifest()
        return

    if DB_PATH.exists():
        _migrate_legacy_monolith()
        return

    _bootstrap_empty_storage()


def load_long_term_db() -> Dict[str, Any]:
    with _db_lock:
        _ensure_collection_storage_ready()

        db = {
            "meta": _load_meta(),
        }
        for name in COLLECTION_NAMES:
            db[name] = _load_collection(name)

        normalized = _normalize_db_shape(db)

        if normalized.get("idea_tag_catalog") != db.get("idea_tag_catalog"):
            _save_collection("idea_tag_catalog", normalized["idea_tag_catalog"])
            _save_manifest(normalized["meta"])

        return normalized


def save_long_term_db(db: Dict[str, Any]) -> None:
    with _db_lock:
        _ensure_collection_storage_ready()
        _persist_snapshot(db)


def backup_long_term_db() -> str:
    with _db_lock:
        _ensure_collection_storage_ready()
        snapshot = load_long_term_db()
        backup_path = BACKUP_DIR / f"long_term_db_{now_ms()}.json"
        _write_json(backup_path, snapshot)
        return str(backup_path)


def reset_long_term_db() -> Dict[str, Any]:
    with _db_lock:
        db = _build_default_snapshot()
        save_long_term_db(db)
        return db


def get_long_term_db() -> Dict[str, Any]:
    with _db_lock:
        return load_long_term_db()


def list_session_summaries(limit: Optional[int] = None) -> List[Dict[str, Any]]:
    with _db_lock:
        db = load_long_term_db()
        items = sorted(
            db["session_summaries"],
            key=lambda x: x.get("updated_at", 0),
            reverse=True,
        )
        return items if limit is None else items[:limit]


def get_session_summary_by_id(summary_id: str) -> Optional[Dict[str, Any]]:
    with _db_lock:
        db = load_long_term_db()
        for item in db["session_summaries"]:
            if item.get("id") == summary_id:
                return item
        return None


def create_session_summary(summary: Dict[str, Any]) -> Dict[str, Any]:
    with _db_lock:
        db = load_long_term_db()
        db["session_summaries"].append(summary)
        db["meta"]["last_archive_at"] = now_ms()
        save_long_term_db(db)
        return summary


def list_user_facts(category: Optional[str] = None) -> List[Dict[str, Any]]:
    with _db_lock:
        db = load_long_term_db()
        facts = db["user_facts"]
        if category is not None:
            facts = [x for x in facts if x.get("category") == category]
        return sorted(facts, key=lambda x: x.get("updated_at", 0), reverse=True)


def get_user_fact_by_key(key: str) -> Optional[Dict[str, Any]]:
    with _db_lock:
        db = load_long_term_db()
        for fact in db["user_facts"]:
            if fact.get("key") == key:
                return fact
        return None


def upsert_user_fact(fact: Dict[str, Any]) -> Dict[str, Any]:
    with _db_lock:
        db = load_long_term_db()

        for i, existing in enumerate(db["user_facts"]):
            if existing.get("key") == fact.get("key"):
                preserved_id = existing.get("id")
                preserved_created_at = existing.get("created_at")
                fact["id"] = preserved_id
                fact["created_at"] = preserved_created_at
                fact["updated_at"] = now_ms()
                db["user_facts"][i] = fact
                save_long_term_db(db)
                return fact

        db["user_facts"].append(fact)
        save_long_term_db(db)
        return fact


def list_idea_memories(status: Optional[str] = None) -> List[Dict[str, Any]]:
    with _db_lock:
        db = load_long_term_db()
        ideas = db["idea_memories"]
        if status is not None:
            ideas = [x for x in ideas if x.get("status") == status]
        return sorted(ideas, key=lambda x: x.get("updated_at", 0), reverse=True)


def list_idea_tag_catalog() -> List[str]:
    with _db_lock:
        db = load_long_term_db()
        catalog = db.get("idea_tag_catalog") or []
        if not isinstance(catalog, list):
            return []
        return [tag for tag in catalog if isinstance(tag, str) and tag.strip()]


def rebuild_idea_tag_catalog() -> List[str]:
    with _db_lock:
        db = load_long_term_db()
        db["idea_tag_catalog"] = _derive_idea_tag_catalog_from_db(db)
        save_long_term_db(db)
        return db["idea_tag_catalog"]


def upsert_idea_memory(idea: Dict[str, Any]) -> Dict[str, Any]:
    with _db_lock:
        db = load_long_term_db()

        for i, existing in enumerate(db["idea_memories"]):
            if (
                existing.get("title") == idea.get("title")
                and existing.get("category") == idea.get("category")
            ):
                idea["id"] = existing.get("id")
                idea["created_at"] = existing.get("created_at")
                idea["updated_at"] = now_ms()
                db["idea_memories"][i] = idea
                save_long_term_db(db)
                return idea

        db["idea_memories"].append(idea)
        save_long_term_db(db)
        return idea


def list_project_states(status: Optional[str] = None) -> List[Dict[str, Any]]:
    with _db_lock:
        db = load_long_term_db()
        projects = db["project_states"]
        if status is not None:
            projects = [x for x in projects if x.get("status") == status]
        return sorted(projects, key=lambda x: x.get("updated_at", 0), reverse=True)


def get_project_state_by_key(project_key: str) -> Optional[Dict[str, Any]]:
    with _db_lock:
        db = load_long_term_db()
        for project in db["project_states"]:
            if project.get("project_key") == project_key:
                return project
        return None


def upsert_project_state(project: Dict[str, Any]) -> Dict[str, Any]:
    with _db_lock:
        db = load_long_term_db()

        for i, existing in enumerate(db["project_states"]):
            if existing.get("project_key") == project.get("project_key"):
                project["id"] = existing.get("id")
                project["created_at"] = existing.get("created_at")
                project["updated_at"] = now_ms()
                db["project_states"][i] = project
                save_long_term_db(db)
                return project

        db["project_states"].append(project)
        save_long_term_db(db)
        return project


def get_memory_digest_by_type(digest_type: str) -> Optional[Dict[str, Any]]:
    with _db_lock:
        db = load_long_term_db()
        for digest in db["memory_digests"]:
            if digest.get("type") == digest_type:
                return digest
        return None


def list_memory_digests() -> List[Dict[str, Any]]:
    with _db_lock:
        db = load_long_term_db()
        return sorted(
            db["memory_digests"],
            key=lambda x: x.get("updated_at", 0),
            reverse=True,
        )


def upsert_memory_digest(digest: Dict[str, Any]) -> Dict[str, Any]:
    with _db_lock:
        db = load_long_term_db()

        for i, existing in enumerate(db["memory_digests"]):
            if existing.get("type") == digest.get("type"):
                digest["id"] = existing.get("id")
                digest["created_at"] = existing.get("created_at")
                digest["updated_at"] = now_ms()
                db["memory_digests"][i] = digest
                db["meta"]["last_digest_rebuild_at"] = now_ms()
                save_long_term_db(db)
                return digest

        db["memory_digests"].append(digest)
        db["meta"]["last_digest_rebuild_at"] = now_ms()
        save_long_term_db(db)
        return digest
