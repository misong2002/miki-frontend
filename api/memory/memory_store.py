# backend/memory/memory_store.py

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any, Dict, List, Optional

from .memory_types import (
    create_empty_long_term_db,
    now_ms,
)

BASE_DIR = Path(__file__).resolve().parent
STORAGE_DIR = BASE_DIR / "storage"
BACKUP_DIR = STORAGE_DIR / "backups"
ARCHIVE_LOG_DIR = STORAGE_DIR / "archive_logs"
DB_PATH = STORAGE_DIR / "long_term_db.json"


def ensure_storage_dirs() -> None:
    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    ARCHIVE_LOG_DIR.mkdir(parents=True, exist_ok=True)


def _normalize_db_shape(db: Dict[str, Any]) -> Dict[str, Any]:
    default_db = create_empty_long_term_db()

    for key in default_db:
        if key not in db:
            db[key] = default_db[key]

    if "meta" not in db or not isinstance(db["meta"], dict):
        db["meta"] = default_db["meta"]

    for meta_key, meta_value in default_db["meta"].items():
        if meta_key not in db["meta"]:
            db["meta"][meta_key] = meta_value

    return db


def load_long_term_db() -> Dict[str, Any]:
    ensure_storage_dirs()

    if not DB_PATH.exists():
        db = create_empty_long_term_db()
        save_long_term_db(db)
        return db

    with DB_PATH.open("r", encoding="utf-8") as f:
        db = json.load(f)

    return _normalize_db_shape(db)


def save_long_term_db(db: Dict[str, Any]) -> None:
    ensure_storage_dirs()

    db = _normalize_db_shape(db)
    db["meta"]["updated_at"] = now_ms()

    tmp_path = DB_PATH.with_suffix(".json.tmp")

    with tmp_path.open("w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=2)

    tmp_path.replace(DB_PATH)


def backup_long_term_db() -> str:
    ensure_storage_dirs()

    if not DB_PATH.exists():
        db = create_empty_long_term_db()
        save_long_term_db(db)

    ts = now_ms()
    backup_path = BACKUP_DIR / f"long_term_db_{ts}.json"
    shutil.copy2(DB_PATH, backup_path)
    return str(backup_path)


def reset_long_term_db() -> Dict[str, Any]:
    db = create_empty_long_term_db()
    save_long_term_db(db)
    return db


def get_long_term_db() -> Dict[str, Any]:
    return load_long_term_db()


def list_session_summaries(limit: Optional[int] = None) -> List[Dict[str, Any]]:
    db = load_long_term_db()
    items = sorted(
        db["session_summaries"],
        key=lambda x: x.get("updated_at", 0),
        reverse=True,
    )
    return items if limit is None else items[:limit]


def get_session_summary_by_id(summary_id: str) -> Optional[Dict[str, Any]]:
    db = load_long_term_db()
    for item in db["session_summaries"]:
        if item.get("id") == summary_id:
            return item
    return None


def create_session_summary(summary: Dict[str, Any]) -> Dict[str, Any]:
    db = load_long_term_db()
    db["session_summaries"].append(summary)
    db["meta"]["last_archive_at"] = now_ms()
    save_long_term_db(db)
    return summary


def list_user_facts(category: Optional[str] = None) -> List[Dict[str, Any]]:
    db = load_long_term_db()
    facts = db["user_facts"]
    if category is not None:
        facts = [x for x in facts if x.get("category") == category]
    return sorted(facts, key=lambda x: x.get("updated_at", 0), reverse=True)


def get_user_fact_by_key(key: str) -> Optional[Dict[str, Any]]:
    db = load_long_term_db()
    for fact in db["user_facts"]:
        if fact.get("key") == key:
            return fact
    return None


def upsert_user_fact(fact: Dict[str, Any]) -> Dict[str, Any]:
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
    db = load_long_term_db()
    ideas = db["idea_memories"]
    if status is not None:
        ideas = [x for x in ideas if x.get("status") == status]
    return sorted(ideas, key=lambda x: x.get("updated_at", 0), reverse=True)


def upsert_idea_memory(idea: Dict[str, Any]) -> Dict[str, Any]:
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
    db = load_long_term_db()
    projects = db["project_states"]
    if status is not None:
        projects = [x for x in projects if x.get("status") == status]
    return sorted(projects, key=lambda x: x.get("updated_at", 0), reverse=True)


def get_project_state_by_key(project_key: str) -> Optional[Dict[str, Any]]:
    db = load_long_term_db()
    for project in db["project_states"]:
        if project.get("project_key") == project_key:
            return project
    return None


def upsert_project_state(project: Dict[str, Any]) -> Dict[str, Any]:
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
    db = load_long_term_db()
    for digest in db["memory_digests"]:
        if digest.get("type") == digest_type:
            return digest
    return None


def list_memory_digests() -> List[Dict[str, Any]]:
    db = load_long_term_db()
    return sorted(
        db["memory_digests"],
        key=lambda x: x.get("updated_at", 0),
        reverse=True,
    )


def upsert_memory_digest(digest: Dict[str, Any]) -> Dict[str, Any]:
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