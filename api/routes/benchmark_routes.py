"""Benchmark builder API routes.

Manages a single benchmark manifest at ``config/benchmark.json``
with section files under ``config/benchmark_config/``.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

from flask import Blueprint, jsonify, request

from services.command_runner import command_result_payload, run_command
from services.response_service import error_payload, success_payload

benchmark_bp = Blueprint("benchmark", __name__)

MIKI_ROOT = os.environ.get("MIKI_ROOT", "/home/mingzhuo/miki")
BENCHMARK_MANIFEST = Path(MIKI_ROOT) / "config" / "benchmark.json"
BENCHMARK_CONFIG_DIR = Path(MIKI_ROOT) / "config" / "benchmark_config"
BUILDER_SCRIPT = Path(MIKI_ROOT) / "scripts" / "benchmark" / "build_benchmark.py"
FLUX_REGISTRY_PATH = Path(MIKI_ROOT) / "config" / "flux_registry.json"
DOWNLOAD_ROOT = Path(MIKI_ROOT) / "data" / "download_dataset4benchmark"


def _load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text())
    except Exception:
        return {}


def _save_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def _resolve_section(raw_value: Any) -> dict[str, Any]:
    """If *raw_value* is a string path, load the referenced JSON file."""
    if isinstance(raw_value, str):
        section_path = Path(raw_value)
        if not section_path.is_absolute():
            section_path = Path(MIKI_ROOT) / section_path
        return _load_json(section_path)
    if isinstance(raw_value, dict):
        return raw_value
    return {}


def _build_status(config: dict) -> dict[str, Any]:
    """Check whether a benchmark has been built."""
    out = config.get("output_dir", "")
    out_path = Path(out) if Path(out).is_absolute() else Path(MIKI_ROOT) / out
    summary_path = out_path / "summary.json"
    if not summary_path.exists():
        return {"built": False, "output_dir": str(out_path)}

    summary = _load_json(summary_path)
    train = out_path / "likelihood" / "saber_likelihood_benchmark_train.npz"
    val = out_path / "likelihood" / "saber_likelihood_benchmark_val.npz"
    test = out_path / "likelihood" / "saber_likelihood_benchmark_test.npz"

    return {
        "built": train.exists(),
        "output_dir": str(out_path),
        "benchmark_train": str(train) if train.exists() else None,
        "benchmark_val": str(val) if val.exists() else None,
        "benchmark_test": str(test) if test.exists() else None,
        "elapsed_seconds": summary.get("elapsed_seconds"),
        "model_name": summary.get("model_name"),
        "flux_names": summary.get("flux_names", []),
    }


# ═══════════════════════════════════════════════════════════════════════════
# Benchmark manifest
# ═══════════════════════════════════════════════════════════════════════════

@benchmark_bp.route("/api/benchmark/config", methods=["GET"])
def get_benchmark_config():
    """Return the full benchmark manifest with resolved sections."""
    manifest = _load_json(BENCHMARK_MANIFEST)

    # Resolve referenced section files into the response
    io_config = _resolve_section(manifest.get("io_config"))
    model_config = _resolve_section(manifest.get("model_config"))

    return jsonify(success_payload(
        config=manifest,
        io_config=io_config,
        model_config=model_config,
        build_status=_build_status(manifest),
    )), 200


@benchmark_bp.route("/api/benchmark/config", methods=["POST"])
def save_benchmark_config():
    """Save the benchmark manifest and optionally its section files.

    Body::

        {
            "config": {               // manifest fields
                "model_name": "...",
                "topology": "...",
                "dataset_type": "...",
                "output_dir": "...",
                "io_config": "config/benchmark_config/local_config.json",
                "model_config": "config/benchmark_config/saber_config.json"
            },
            "io_config": {...},  // inline section data
            "model_config": {...} // inline section data
        }
    """
    data = request.get_json(silent=True) or {}

    manifest = data.get("config", {})
    if not isinstance(manifest, dict) or not manifest:
        return jsonify(error_payload("config is required")), 400

    # Validate required manifest fields
    for field in ["model_name", "topology", "dataset_type", "output_dir"]:
        if not manifest.get(field):
            return jsonify(error_payload(f"config.{field} is required")), 400

    # Write section files if inline data provided
    ds_raw = manifest.get("io_config")
    if isinstance(ds_raw, str) and "io_config" in data:
        section_path = Path(ds_raw)
        if not section_path.is_absolute():
            section_path = Path(MIKI_ROOT) / section_path
        _save_json(section_path, data["io_config"])

    bm_raw = manifest.get("model_config")
    if isinstance(bm_raw, str) and "model_config" in data:
        section_path = Path(bm_raw)
        if not section_path.is_absolute():
            section_path = Path(MIKI_ROOT) / section_path
        _save_json(section_path, data["model_config"])

    # Write manifest
    _save_json(BENCHMARK_MANIFEST, manifest)

    return jsonify(success_payload(
        path=str(BENCHMARK_MANIFEST),
        build_status=_build_status(manifest),
    )), 200


# ═══════════════════════════════════════════════════════════════════════════
# Build trigger
# ═══════════════════════════════════════════════════════════════════════════

@benchmark_bp.route("/api/benchmark/build", methods=["POST"])
def build_benchmark():
    """Trigger a benchmark build (synchronous). Optional --config path in body."""
    data = request.get_json(silent=True) or {}
    config_path = data.get("config_path") or None
    force = bool(data.get("force", False))

    if not BUILDER_SCRIPT.exists():
        return jsonify(error_payload(f"Builder script not found: {BUILDER_SCRIPT}")), 500

    cmd = [sys.executable, str(BUILDER_SCRIPT)]
    if config_path:
        cmd.extend(["--config", config_path])
    if force:
        cmd.append("--force")

    try:
        result = run_command(cmd, cwd=MIKI_ROOT)
    except Exception as exc:
        return jsonify(error_payload(
            f"Builder script failed: {exc}",
            **command_result_payload(exc),
        )), 500

    if result.returncode != 0:
        return jsonify(error_payload(
            "Builder script returned non-zero exit code",
            **command_result_payload(result),
        )), 500

    # Parse the JSON summary from stdout (last line)
    summary = {}
    try:
        stdout = result.stdout.strip()
        summary = json.loads(stdout.splitlines()[-1])
    except Exception:
        summary = {"raw_stdout": result.stdout}

    return jsonify(success_payload(
        summary=summary,
        **command_result_payload(result),
    )), 200


# ═══════════════════════════════════════════════════════════════════════════
# Flux registry
# ═══════════════════════════════════════════════════════════════════════════

@benchmark_bp.route("/api/benchmark/fluxes", methods=["GET"])
def list_fluxes():
    registry = _load_json(FLUX_REGISTRY_PATH)
    return jsonify(success_payload(fluxes=registry.get("fluxes", []))), 200


@benchmark_bp.route("/api/benchmark/fluxes", methods=["POST"])
def register_flux():
    data = request.get_json(silent=True) or {}
    flux_entry = data.get("flux") if isinstance(data, dict) else data
    name = str(flux_entry.get("name", "")).strip()
    if not name:
        return jsonify(error_payload("flux entry requires 'name'")), 400

    registry = _load_json(FLUX_REGISTRY_PATH)
    fluxes = list(registry.get("fluxes", []))
    replaced = False
    for i, existing in enumerate(fluxes):
        if existing.get("name") == name:
            fluxes[i] = flux_entry
            replaced = True
            break
    if not replaced:
        fluxes.append(flux_entry)
    registry["fluxes"] = fluxes
    _save_json(FLUX_REGISTRY_PATH, registry)
    return jsonify(success_payload(name=name, replaced=replaced)), 200


@benchmark_bp.route("/api/benchmark/fluxes/<name>", methods=["DELETE"])
def delete_flux(name: str):
    registry = _load_json(FLUX_REGISTRY_PATH)
    fluxes = list(registry.get("fluxes", []))
    new_fluxes = [f for f in fluxes if f.get("name") != name]
    if len(new_fluxes) == len(fluxes):
        return jsonify(error_payload(f"Flux not found: {name}")), 404
    registry["fluxes"] = new_fluxes
    _save_json(FLUX_REGISTRY_PATH, registry)
    return jsonify(success_payload(name=name, deleted=True)), 200


# ═══════════════════════════════════════════════════════════════════════════
# Section files & datasets
# ═══════════════════════════════════════════════════════════════════════════

@benchmark_bp.route("/api/benchmark/sections", methods=["GET"])
def list_sections():
    """List available section files under config/benchmark_config/."""
    sections = []
    if BENCHMARK_CONFIG_DIR.exists():
        for f in sorted(BENCHMARK_CONFIG_DIR.glob("*.json")):
            raw = _load_json(f)
            sections.append({
                "name": f.stem,
                "path": str(f),
                "keys": list(raw.keys()) if raw else [],
            })
    return jsonify(success_payload(sections=sections)), 200


@benchmark_bp.route("/api/benchmark/datasets", methods=["GET"])
def list_datasets():
    """Scan data/download_dataset4benchmark/ directory tree."""
    datasets = []
    if DOWNLOAD_ROOT.exists():
        for gen_dir in sorted(DOWNLOAD_ROOT.iterdir()):
            if not gen_dir.is_dir():
                continue
            for osc_dir in sorted(gen_dir.iterdir()):
                if not osc_dir.is_dir():
                    continue
                for flav_dir in sorted(osc_dir.iterdir()):
                    if not flav_dir.is_dir():
                        continue
                    for beam_dir in sorted(flav_dir.iterdir()):
                        if not beam_dir.is_dir():
                            continue
                        hdf5_files = sorted(beam_dir.glob("*.hdf5"))
                        if hdf5_files:
                            datasets.append({
                                "generator": gen_dir.name,
                                "oscillation": osc_dir.name,
                                "flavor": flav_dir.name,
                                "beam_mode": beam_dir.name,
                                "path": str(beam_dir),
                                "n_files": len(hdf5_files),
                                "sample_file": hdf5_files[0].name,
                            })
    return jsonify(success_payload(datasets=datasets)), 200
