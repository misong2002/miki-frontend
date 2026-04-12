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


def _normalize_memory_status(value: Any) -> str:
    status = str(value or "active").strip().lower()
    return status or "active"


def _normalize_memory_operation(value: Any) -> str:
    operation = str(value or "upsert").strip().lower()
    if operation in {"delete", "forget"}:
        return "archive"
    if operation in {"archive", "supersede", "upsert"}:
        return operation
    return "upsert"


def _memory_status_matches(item: Dict[str, Any], memory_status: Optional[str]) -> bool:
    if memory_status is None:
        return True
    return _normalize_memory_status(item.get("memory_status")) == memory_status


def _is_active_memory(item: Dict[str, Any]) -> bool:
    return _memory_status_matches(item, "active")


def _extend_unique_strings(existing: Any, additions: Any) -> List[str]:
    result = []

    for source in (existing, additions):
        if not isinstance(source, list):
            continue
        for item in source:
            text = str(item or "").strip()
            if text and text not in result:
                result.append(text)

    return result


def _resolve_target_index(
    items: List[Dict[str, Any]],
    incoming: Dict[str, Any],
    natural_key_fields: List[str],
) -> Optional[int]:
    target_id = str(incoming.get("target_id") or "").strip()
    if target_id:
        for i, existing in enumerate(items):
            candidate_values = [
                existing.get("id"),
                *(existing.get(field) for field in natural_key_fields),
            ]
            if any(str(value or "").strip() == target_id for value in candidate_values):
                return i

    for i, existing in enumerate(items):
        if all(existing.get(field) == incoming.get(field) for field in natural_key_fields):
            return i

    return None


def _mark_memory_status(
    item: Dict[str, Any],
    *,
    memory_status: str,
    superseded_by: Optional[str] = None,
    source_item: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    item["memory_status"] = memory_status
    item["updated_at"] = now_ms()

    if superseded_by is not None:
        item["superseded_by"] = superseded_by

    if source_item is not None:
        item["source_summary_ids"] = _extend_unique_strings(
            item.get("source_summary_ids"),
            source_item.get("source_summary_ids"),
        )
        item["source_wake_cycle_ids"] = _extend_unique_strings(
            item.get("source_wake_cycle_ids"),
            source_item.get("source_wake_cycle_ids"),
        )

    return item


def _mark_superseded_targets(
    items: List[Dict[str, Any]],
    target_index: Optional[int],
    incoming: Dict[str, Any],
) -> List[str]:
    target_ids = _extend_unique_strings(incoming.get("supersedes_ids"), [])
    if target_index is not None:
        target_ids = _extend_unique_strings(
            target_ids,
            [items[target_index].get("id")],
        )

    marked_ids = []
    for item in items:
        item_id = str(item.get("id") or "").strip()
        if not item_id or item_id not in target_ids:
            continue
        _mark_memory_status(
            item,
            memory_status="superseded",
            superseded_by=incoming.get("id"),
            source_item=incoming,
        )
        marked_ids.append(item_id)

    return marked_ids


def _merge_updated_memory_item(
    existing: Dict[str, Any],
    incoming: Dict[str, Any],
) -> Dict[str, Any]:
    ts = now_ms()
    merged = {
        **incoming,
        "id": existing.get("id"),
        "created_at": existing.get("created_at"),
        "updated_at": ts,
        "last_seen_at": ts,
        "memory_status": _normalize_memory_status(incoming.get("memory_status")),
        "source_summary_ids": _extend_unique_strings(
            existing.get("source_summary_ids"),
            incoming.get("source_summary_ids"),
        ),
        "source_wake_cycle_ids": _extend_unique_strings(
            existing.get("source_wake_cycle_ids"),
            incoming.get("source_wake_cycle_ids"),
        ),
        "supersedes_ids": _extend_unique_strings(
            existing.get("supersedes_ids"),
            incoming.get("supersedes_ids"),
        ),
    }

    if incoming.get("superseded_by") is None and existing.get("superseded_by") is not None:
        merged["superseded_by"] = existing.get("superseded_by")

    return merged


def _derive_idea_tag_catalog_from_db(db: Dict[str, Any]) -> List[str]:
    seen = set()
    catalog = []

    for idea in db.get("idea_memories", []):
        if not _is_active_memory(idea):
            continue

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


def list_user_facts(
    category: Optional[str] = None,
    memory_status: Optional[str] = "active",
) -> List[Dict[str, Any]]:
    with _db_lock:
        db = load_long_term_db()
        facts = db["user_facts"]
        facts = [x for x in facts if _memory_status_matches(x, memory_status)]
        if category is not None:
            facts = [x for x in facts if x.get("category") == category]
        return sorted(facts, key=lambda x: x.get("updated_at", 0), reverse=True)


def get_user_fact_by_key(key: str) -> Optional[Dict[str, Any]]:
    with _db_lock:
        db = load_long_term_db()
        for fact in db["user_facts"]:
            if fact.get("key") == key and _is_active_memory(fact):
                return fact
        return None


def upsert_user_fact(fact: Dict[str, Any]) -> Dict[str, Any]:
    with _db_lock:
        db = load_long_term_db()
        operation = _normalize_memory_operation(fact.get("operation"))
        target_index = _resolve_target_index(db["user_facts"], fact, ["key"])

        if operation == "archive":
            if target_index is not None:
                archived = _mark_memory_status(
                    db["user_facts"][target_index],
                    memory_status="archived",
                    source_item=fact,
                )
                save_long_term_db(db)
                return archived

            fact["memory_status"] = "archived"
            fact["updated_at"] = now_ms()
            db["user_facts"].append(fact)
            save_long_term_db(db)
            return fact

        if operation == "supersede":
            marked_ids = _mark_superseded_targets(db["user_facts"], target_index, fact)
            fact["supersedes_ids"] = _extend_unique_strings(
                fact.get("supersedes_ids"),
                marked_ids,
            )

        for i, existing in enumerate(db["user_facts"]):
            if existing.get("key") == fact.get("key") and _is_active_memory(existing):
                fact = _merge_updated_memory_item(existing, fact)
                db["user_facts"][i] = fact
                save_long_term_db(db)
                return fact

        db["user_facts"].append(fact)
        save_long_term_db(db)
        return fact


def list_idea_memories(
    status: Optional[str] = None,
    memory_status: Optional[str] = "active",
) -> List[Dict[str, Any]]:
    with _db_lock:
        db = load_long_term_db()
        ideas = db["idea_memories"]
        ideas = [x for x in ideas if _memory_status_matches(x, memory_status)]
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
        operation = _normalize_memory_operation(idea.get("operation"))
        target_index = _resolve_target_index(db["idea_memories"], idea, ["title", "category"])

        if operation == "archive":
            if target_index is not None:
                archived = _mark_memory_status(
                    db["idea_memories"][target_index],
                    memory_status="archived",
                    source_item=idea,
                )
                save_long_term_db(db)
                return archived

            idea["memory_status"] = "archived"
            idea["updated_at"] = now_ms()
            db["idea_memories"].append(idea)
            save_long_term_db(db)
            return idea

        if operation == "supersede":
            marked_ids = _mark_superseded_targets(db["idea_memories"], target_index, idea)
            idea["supersedes_ids"] = _extend_unique_strings(
                idea.get("supersedes_ids"),
                marked_ids,
            )

        for i, existing in enumerate(db["idea_memories"]):
            if (
                existing.get("title") == idea.get("title")
                and existing.get("category") == idea.get("category")
                and _is_active_memory(existing)
            ):
                idea = _merge_updated_memory_item(existing, idea)
                db["idea_memories"][i] = idea
                save_long_term_db(db)
                return idea

        db["idea_memories"].append(idea)
        save_long_term_db(db)
        return idea


def list_project_states(
    status: Optional[str] = None,
    memory_status: Optional[str] = "active",
) -> List[Dict[str, Any]]:
    with _db_lock:
        db = load_long_term_db()
        projects = db["project_states"]
        projects = [x for x in projects if _memory_status_matches(x, memory_status)]
        if status is not None:
            projects = [x for x in projects if x.get("status") == status]
        return sorted(projects, key=lambda x: x.get("updated_at", 0), reverse=True)


def get_project_state_by_key(project_key: str) -> Optional[Dict[str, Any]]:
    with _db_lock:
        db = load_long_term_db()
        for project in db["project_states"]:
            if project.get("project_key") == project_key and _is_active_memory(project):
                return project
        return None


def upsert_project_state(project: Dict[str, Any]) -> Dict[str, Any]:
    with _db_lock:
        db = load_long_term_db()
        operation = _normalize_memory_operation(project.get("operation"))
        target_index = _resolve_target_index(db["project_states"], project, ["project_key"])

        if operation == "archive":
            if target_index is not None:
                archived = _mark_memory_status(
                    db["project_states"][target_index],
                    memory_status="archived",
                    source_item=project,
                )
                save_long_term_db(db)
                return archived

            project["memory_status"] = "archived"
            project["updated_at"] = now_ms()
            db["project_states"].append(project)
            save_long_term_db(db)
            return project

        if operation == "supersede":
            marked_ids = _mark_superseded_targets(db["project_states"], target_index, project)
            project["supersedes_ids"] = _extend_unique_strings(
                project.get("supersedes_ids"),
                marked_ids,
            )

        for i, existing in enumerate(db["project_states"]):
            if existing.get("project_key") == project.get("project_key") and _is_active_memory(existing):
                project = _merge_updated_memory_item(existing, project)
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
