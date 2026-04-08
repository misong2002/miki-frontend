# MIKI Frontend v2.0 — Saber

A Live2D visual interface for interacting with **MIKI**, a neutrino–nucleus scattering model.

This project provides an interactive web UI where you can talk with **Miki-san**, a Live2D character, ask questions about **nuclear physics and machine learning**, and even train the model together.

---

## What's New in v2.0 — Saber

- 🧠 **Memory retrieval is now query-aware**: Miki no longer injects long-term memory as a static summary only. The backend now classifies the user's question by level and retrieves different memory bundles for profile questions, project-status questions, session recall, idea lookup, and targeted entity recall.
- 🏷️ **Idea tags are now first-class retrieval signals**: all `idea_memories.tags` are collected into an `idea_tag_catalog`, maintained during wake-cycle archival, and used as direct retrieval keywords.
- 💬 **Chat prompting is cleaner and more focused**: normal chat turns now primarily use the current user question plus the retrieved long-term memory block, instead of repeatedly stuffing the full short-term transcript into every turn.
- 🔄 **Boot remind now runs after entering chat mode**: startup summarization and memory maintenance complete first, then Miki performs the wake-up recall once chat mode is ready, making the boot flow cleaner and less blocking.
- 📊 **Battle chart sampling is now unified**: the recent-window limit and sparse-history sampling are shared between frontend and backend through one config source.
- 🧪 **Retrieval visibility is easier to inspect**: retrieval debug information and the final injected memory block are now visible in the browser console for inspection and tuning.

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
| v2.0 | Saber | Query-level long-term memory routing, idea tag catalog maintenance, focused prompt injection, deferred remind after chat-mode entry, unified battle chart sampling |
| v1.8 | Extinguisher | Plotting, improved history saving logic, initialization from history, bug fixes |
| v1.5 | Extinguisher | Improved local context management and memory retrieval, smoother server-side running |
| v1.2 | Extinguisher | Automated history management for model training sessions |
| v1.1 | Extinguisher | Reorganized program structure |
| v1.0 | Extinguisher | Short-term and long-term memory system, emotion and motion control |

---

✨ Have fun training models together with Miki!
