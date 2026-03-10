# MIKI Frontend

A Live2D visual interface for interacting with **MIKI**, a neutrino–nucleus scattering model.

This project provides an interactive web UI where you can talk with **Miki-san**, a Live2D character, ask questions about **nuclear physics and machine learning**, and even train the model together.

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
- ⚙️ Adjust model **hyperparameters**
- 🧪 Launch training jobs
- 📉 Watch **loss curves update in real time**
- ✨ See Miki react to the training process with different expressions and animations

The idea is to turn the model training workflow into a more **interactive and visual experience**.

---

## Interface Overview

The interface contains several components:

### Chat Panel
Talk to Miki and ask questions about physics or machine learning.

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

## Tech Stack

Frontend

- React
- Vite
- Live2D (pixi-live2d-display)

Backend

- Python
- Flask

Visualization

- real-time training log streaming
- loss curve plotting

---

## Project Structure


```
backend/
  api.py # Flask backend for training and inference

src/
  components/ # UI panels and Live2D controller
  services/ # API communication
  state/ # application state management
  App.jsx # main application

public/
  model/ # Live2D models
```


---

## Concept

This project explores a simple idea:

> What if training a physics model felt like working together with a character?

Instead of a purely command-line workflow, the interface allows you to:

- interact with the model
- visualize its learning process
- treat training as a collaborative experience with **Miki**.

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

---

✨ Have fun training models together with Miki!
