# MIKI Frontend v2.7 — Saber

A Live2D visual interface for interacting with **MIKI**, a neutrino–nucleus scattering model.

This project provides an interactive web UI where you can talk with **Miki-san**, a Live2D character, ask questions about **nuclear physics and machine learning**, and even train the model together.

---

## What's New in v2.7 — Saber

Compared with **v2.6**, this version focuses on smarter chat-model routing, stronger battle autosave behavior, and a more explicit training-integration workflow.

- 🧠 **Chat now switches between fast and thinking models automatically**: lightweight turns can use `deepseek-v4-flash`, while proof-style or step-by-step questions are routed to `deepseek-v4-pro` using backend trigger rules.
- ⚙️ **Loss integration config is now mode-aware**: the training panel exposes `bin_sum`, `adaptive`, and `gauss-legendre` integration modes, with dedicated per-mode parameter blocks and backend persistence for nested integration config files.
- 💾 **Battle autosave is now much closer to manual save-history-and-plot**: auto history snapshots carry the same `should_plot` semantics as manual saves, surface success/error state back to the frontend, and refresh the battle plot browser when a new plot is actually generated.
- 🖼️ **Latest battle images refresh more reliably**: the battle plot browser now stays pinned to the latest history result instead of a stale saved session, and plot-file URLs are cache-busted with file modification times.
- 🔄 **Battle startup can repair stale auto snapshots**: when battle mode reconnects, the backend compares the current latest model epoch against the last `.auto` history snapshot and forces a fresh auto save when they diverge.
- 📜 **Live training log polling is now part of the battle feedback loop**: the frontend polls `train.live.log`, streams grouped system messages into the battle contact feed, and uses the same channel to receive backend auto-history updates.

---

## About MIKI

The core model lives here:

👉 https://git.hyperk.org/mzsong/miki

**MIKI** is a neutrino–nucleus scattering interface model designed for studying interactions between neutrinos and atomic nuclei.

Neutrino–nucleus scattering plays a central role in modern neutrino experiments and oscillation measurements, where accurate modeling of nuclear effects is essential for extracting physical parameters from detector data.

This repository does **not contain the physics model itself**.
Instead, it provides a **visual interface and interactive assistant** built on top of the MIKI framework.

---

## What this project does

This repository implements a **web-based visualization interface** for MIKI.

With this interface you can:

- 💬 Chat with **Miki**, a Live2D character assistant
- 🧠 Ask questions about
  - nuclear physics
  - neutrino interactions
  - machine learning
- 💾 Miki **remembers** your projects, preferences, and important context across sessions
- ⚙️ Adjust model **hyperparameters**
- 🧪 Launch training jobs
- 📉 Watch **loss curves update in real time**
- ✨ See Miki react to the training process with different expressions and animations

The idea is to turn the model training workflow into a more **interactive and visual experience**.

---

## Interface Overview

The interface contains several components:

### Chat Panel
Talk to Miki and ask questions about physics or machine learning. Miki maintains both short-term and long-term memory, so she can follow ongoing conversations and recall important context from previous sessions.

### Hyperparameter Panel
Adjust model configuration and training parameters.

### Live2D Stage
Miki appears here and reacts to:

- conversation
- training progress
- model performance

### Training Mode
When training starts:

- the interface switches to **battle/training mode**
- the Live2D character reacts to the training status
- loss curves are displayed in real time

---

## Memory System

### Short-term Memory
Conversation history is preserved within and across messages in a session, allowing Miki to maintain coherent dialogue context.

### Long-term Memory
A persistent memory management layer extracts and stores:

- **User facts** — important information about the user's background, beliefs, and preferences
- **Project states** — ongoing research projects and their current status

Long-term memories are summarized and injected into Miki's context at the start of each session, enabling continuity across conversations.

---

## Tech Stack

Frontend

- React
- Vite
- Live2D (pixi-live2d-display)

Backend

- Python
- Flask

Memory

- Short-term: conversation history management
- Long-term: persistent fact and project state extraction

Visualization

- real-time training log streaming
- loss curve plotting

---

## Project Structure

backend/ api.py # Flask backend for training and inference

src/ components/ # UI panels and Live2D controller services/ # API communication state/ # application state management App.jsx # main application

public/ model/ # Live2D models


---

## Concept

This project explores a simple idea:

> What if training a physics model felt like working together with a character who actually remembers you?

Instead of a purely command-line workflow, the interface allows you to:

- interact with the model
- visualize its learning process
- treat training as a collaborative experience with **Miki**
- build a working relationship that persists across sessions

---

## Disclaimer

Magia Record / Madoka Magica related assets are copyrighted by
© Magica Quartet / Aniplex.

This repository does **not include game assets**.

Please use any extracted resources for **private use only**.

---

## Future Work

Possible future extensions include:

- richer emotion/state models for the Live2D character
- tighter integration with the physics simulation
- improved visualization of training metrics
- interactive exploration of scattering events
- memory refinement and forgetting mechanisms

---

## Version History

| Version | Codename | Description |
|---------|----------|-------------|
| v2.7 | Saber | Dual-speed chat model routing, integration-mode training config UI, battle live-log autosave feedback, latest-plot refresh fixes, startup auto-history epoch resync |
| v2.6 | Saber | File-backed training config sections, grouped history checkpoint navigation, refreshed chat/battle visuals, Live2D tap interactions, more stable chat scrolling, remote-safe API URL handling |
| v2.5 | Saber | Collection-file long-term memory storage, safer memory debug endpoints, streaming chat bootstrap/remind flow, richer training summaries, consistent backend command responses, battle save-history-and-plot tooling |
| v2.4 | Saber | Sectioned training config UI, backend-driven model selection, safer battle bootstrap recovery, cached battle contact restore, automatic post-training summaries, improved chat history prompting and speech runtime |
| v2.0.5 | Saber | Fixed shared-server startup behavior, added safe local-memory import/migration support, suppressed repeated boot-remind replies, reduced high-volume memory debug logging |
| v2.0 | Saber | Query-level long-term memory routing, idea tag catalog maintenance, focused prompt injection, deferred remind after chat-mode entry, unified battle chart sampling |
| v1.8 | Extinguisher | Plotting, improved history saving logic, initialization from history, bug fixes |
| v1.5 | Extinguisher | Improved local context management and memory retrieval, smoother server-side running |
| v1.2 | Extinguisher | Automated history management for model training sessions |
| v1.1 | Extinguisher | Reorganized program structure |
| v1.0 | Extinguisher | Short-term and long-term memory system, emotion and motion control |

---

## Archived Release Notes

### v2.6 — Saber

- 🧩 **Training config now supports file-backed sections**: the backend can read and write section references such as `io_config`, `model_config`, `optimization_config`, `cluster_config`, and `debug_config`, preserving grouped config files instead of flattening everything into one JSON blob.
- 🗂️ **History management is easier to navigate**: history sessions are grouped by timestamp and expanded into epoch/model checkpoints, making initialize and plot actions less dependent on scanning a long flat select list.
- 📉 **Battle monitoring is clearer**: battle charts now use explicit loss-focused labels, better chart margins, scientific tick formatting, and smarter save-history-and-plot handling when a model epoch has not changed.
- 🖼️ **Chat and battle environments have full-scene backgrounds**: chat uses a classroom backdrop, battle uses rotating witch-space backgrounds, and the shared panel styling has been tightened for a cleaner glass UI.
- 👆 **Live2D interaction reaches the agent loop**: tapping Miki in chat can send an interaction message, while tapping during battle can trigger battle presentation behavior.
- 💬 **Chat scrolling behaves more predictably**: new messages auto-follow only when appropriate, while manual scroll, wheel, touch, and scrollbar interactions stop forced scrolling.
- 🛠️ **Startup and remote access are more robust**: frontend/backend ports can be driven by environment variables, Flask debug/reloader behavior is configurable, and API URLs built with `localhost` can adapt to the page hostname when opened from a remote machine.

### v2.5 — Saber

- 🧠 **Long-term memory storage is now split into collection files**: memory data is migrated from a single monolithic JSON file into per-collection files with a manifest, metadata file, legacy backup path, and lock-guarded access.
- 🔒 **Memory debug storage endpoints are safer**: raw storage browsing is now gated behind `MIKI_EXPOSE_MEMORY_STORAGE`, and memory routes use shared response helpers with stricter path validation.
- 💬 **Chat boot and remind flow is smoother**: boot phases can be subscribed to, loading hints rotate during archive/compact phases, deferred remind can stream into the chat panel, and the fallback greeting is suppressed until bootstrap is ready.
- 📈 **Training summaries use richer runtime evidence**: post-training prompts now combine sampled loss rows with `train.log` tail data, preserve rows without validation loss, and ask Miki to describe the finished run in first person.
- 🛠️ **Backend command responses are more consistent**: history and training routes now share command runner and response helpers, returning bounded stdout/stderr previews instead of raw ad hoc payloads.
- 💾 **Battle history tooling is easier to trigger mid-run**: the battle panel now has a save-history-and-plot action, and history panel in-progress states use loading styling until the command finishes.
- ✨ **Boot and transition screens are clearer**: startup gating now waits for both battle and chat shell readiness, with updated boot visuals and slower whiteout timing.

### v2.4 — Saber

- 🧩 **Training config is now structured and mode-aware**: the hyperparameter panel is split into `io`, `model`, `optimization`, and `run mode` tabs, with dedicated sections for `local`, `cluster`, and `debug` runs instead of one long flat form.
- 🤖 **Model selection is now backend-driven**: available models and the default model are loaded from backend config, legacy model names are normalized to the current `HMsiren` naming, and config read/write now preserves grouped sections more safely.
- 🚀 **Battle start/save flow is more reliable**: starting battle now reuses the same config persistence path as manual save, so the UI launches training from the exact saved config state.
- 🔄 **Startup mode restore is cleaner**: the app now waits for battle-status bootstrap before showing chat, which avoids flashing into chat mode when a training session is still active.
- 💾 **Battle contact messages survive refresh better**: active training session messages are cached in local storage and restored when the same session is detected again.
- 📈 **Post-training summaries are now automatic**: the backend can build a summary prompt from `train_loss` and `val_loss` curves, or fall back to the tail of the training log when errors occur, and Miki can comment on the finished run after returning to chat.
- 💬 **Chat prompt context is richer again, but bounded**: normal chat turns now include a capped recent short-term history window in addition to retrieved long-term memory, improving continuity without reopening the full-context prompt problem.
- 🗣️ **Speech/animation behavior is more natural**: markdown fenced code blocks no longer keep the speaking state active, explicit speech-stop events are emitted, and the streaming/typewriter loop runs much faster.
- ✨ **Mode transitions are visually smoother**: chat/battle switching now uses a white fade overlay instead of abrupt shell swaps.

### v2.0.5 — Saber

- 🧠 **Memory retrieval is now query-aware**: Miki no longer injects long-term memory as a static summary only. The backend now classifies the user's question by level and retrieves different memory bundles for profile questions, project-status questions, session recall, idea lookup, and targeted entity recall.
- 🏷️ **Idea tags are now first-class retrieval signals**: all `idea_memories.tags` are collected into an `idea_tag_catalog`, maintained during wake-cycle archival, and used as direct retrieval keywords.
- 💬 **Chat prompting is cleaner and more focused**: normal chat turns now primarily use the current user question plus the retrieved long-term memory block, instead of repeatedly stuffing the full short-term transcript into every turn.
- 🔄 **Boot remind now runs after entering chat mode**: startup summarization and memory maintenance complete first, then Miki performs the wake-up recall once chat mode is ready, making the boot flow cleaner and less blocking.
- 📊 **Battle chart sampling is now unified**: the recent-window limit and sparse-history sampling are shared between frontend and backend through one config source.
- 🛠️ **Server startup is more predictable**: frontend preview and backend now use fixed non-default ports, the launcher avoids killing unknown processes on shared servers, and startup checks/log handling are more robust.
- 💾 **Short-term memory import and migration are safer**: browser-side local memory can now be imported without being overwritten by stale in-memory cache, and a backend route is available to fetch exported memory snapshots for migration.
- 🔁 **Repeated boot remind output is now suppressed**: remind still gets the injected recall context, but if the latest stored message is already a boot remind, the new remind reply is discarded instead of being written into chat history or rendered in the dialog.
- 🧪 **Retrieval debug spam is reduced**: high-volume memory and remind console logging has been disabled to avoid browser slowdowns during long sessions.

✨ Have fun training models together with Miki!
