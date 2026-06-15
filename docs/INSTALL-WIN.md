# PATRON — Windows install

A local, GDPR-safe AI assistant for Polish law firms. Desktop app (Electron),
**zero-cloud by default**, single-user. No Docker, no separate database, no
cloud account required — one installer and you are running.

---

## Prerequisites

- **Windows 10/11, 64-bit (x64).**
- **~1.5 GB free disk** (the installer itself is ~565 MB and is self-contained:
  it bundles the engine, the local document-search index, the 6 Polish/EU legal
  MCP connectors, and the embedding model — nothing else to download to get
  started).
- **An AI model — choose one of two paths:**
  - **Local (zero-cloud, recommended for privileged matters).** Install
    [Ollama](https://ollama.com) and pull the model PATRON suggests. Inference
    runs on your machine, attorney–client data **never leaves the computer**,
    no token costs. A stronger machine helps (16 GB RAM+).
  - **Cloud (convenience / quality).** Paste a provider key — e.g.
    Anthropic/Libra (the mainstream choice for PL lawyers), Gemini, or OpenAI.
    Note: with a cloud model the case text is sent to the model provider; use
    only with the firm Administrator's consent and per your firm's policy.
- **Internet** is required only for the cloud model path and for live case-law
  search (SAOS, NSA, ISAP, KRS, EUR-Lex). Search over **your own documents** and
  the bundled EU-law base work offline.
- **LibreOffice** (free, optional) — for converting legacy `.doc` files and PDF
  preview. Install later from [libreoffice.org](https://www.libreoffice.org).

---

## Install steps

1. **Download** `PATRON Setup 0.1.0.exe` from the
   [latest release](https://github.com/matematicsolutions/patron/releases).
2. **SmartScreen notice.** Until the installer carries a commercial publisher
   certificate, Windows shows a blue *"Windows protected your PC"* screen — this
   is standard for unsigned apps, not an error. Click **More info → Run anyway**
   (once).
3. **Run the installer**, optionally choose the install directory, finish.
4. **Launch PATRON** from the Start menu. The first start takes a few seconds —
   the app brings up its engine, local database, and legal connectors. Because
   the embedding model ships inside the installer, there is **no large model
   download on first run**.

---

## First run

1. Open **Account → Models & API keys**. Pick a **local model (Ollama)** — so
   data stays on the device — or paste a **cloud model key** (e.g.
   Anthropic/Libra). Save.
2. Create your first **matter** (project) and add the case files — drag them in
   or use **Import case folder**.
3. Ask a first question in the chat, e.g. *"List the deadlines and penalty
   clauses in this contract."* Or just ask **"What can you do?"** and PATRON
   will walk you through its features.

The in-app **Tutorial** takes it from there (from ingesting files to drafting).

---

## Running fully local (zero-cloud)

This is the recommended setup for privileged / confidential work and the reason
PATRON exists:

1. Install [Ollama](https://ollama.com) and pull the suggested model
   (`ollama pull <model>`).
2. In **Account → Models & API keys**, select the local model.
3. Leave cloud keys blank. Inference, document search, and the EU-law base all
   run **offline** — no outbound network, no token costs, attorney–client data
   never leaves the machine.

Every interaction is recorded in a tamper-evident, hash-chained audit trail
(AI Act art. 12) regardless of which model you pick.

---

## Troubleshooting

- **Assistant does not answer / chat error** → usually a missing model: pick a
  local model or paste a cloud key (First run, step 1); for a cloud model, check
  your internet connection.
- **Error on `.doc` upload / PDF preview** → install LibreOffice (Prerequisites)
  and restart PATRON.
- **Antivirus / SmartScreen blocks the installer** → see Install step 2; if
  needed, add an exception for the install directory.

---

## License

PATRON's shell (`backend/`, `frontend/`, `governance/`, `deploy/`) is
**AGPL-3.0-only**; the 6 MCP connectors are **MIT** (separate repositories).
PATRON is a fork of [Mike](https://github.com/willchen96/mike) (AGPL-3.0). See
[`NOTICE`](../NOTICE) and [`ADR-0002`](../governance/adr/0002-dual-license-agpl-shell-mit-connectors.md).

*MateMatic Solutions — PATRON, a local AI assistant for Polish law firms.*
