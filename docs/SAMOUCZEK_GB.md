# Patron: a guide for the lawyer

**Step by step, from first launch to a finished draft.**
Matches the June 2026 installer. No technical setup required. If you can work with documents in Word, you can use Patron.

---

## Table of contents

1. [What Patron is (in one paragraph)](#1-what-patron-is)
2. [First launch](#2-first-launch)
3. [Screen map: three panels](#3-screen-map)
4. [Step 1: create a case and upload files](#4-step-1-create-a-case-and-upload-files)
5. [Step 2: chat with the case files](#5-step-2-chat-with-the-case-files)
6. [Step 3: case law and legislation](#6-step-3-case-law-and-legislation)
7. [Step 4: work on documents and EDIT them](#7-step-4-edit-documents)
8. [Step 5: a table from a set of contracts (tabular review)](#8-step-5-a-table-from-contracts)
9. [Step 6: workflows (repeatable tasks)](#9-step-6-workflows)
10. [Step 7: choosing the AI model](#10-step-7-choosing-the-model)
11. [Skills library](#11-skills-library)
12. [FAQ and troubleshooting](#12-faq)
13. [Quick reference: ready-made prompts](#13-quick-reference-prompts)

---

## 1. What Patron is

Patron is your legal assistant installed **on your own computer** (a desktop application, like Word). You upload the case files (contracts, pleadings, judgments, scans) and Patron:

- **reads them for you** and answers your questions, citing the source in your own documents,
- **searches case law** and **legislation** (UK law, primarily England & Wales) across a set of built-in connectors,
- **proposes changes to documents** as tracked changes, which you accept with one click,
- **strengthens your drafts** (review, devil's advocate, plain-language editing).

Patron does not make legal decisions and does not replace your judgement. It is a tool: a faster read of the file and a first draft you verify in every case.

---

## 2. First launch

1. Start **PATRON** (the desktop icon or the Start menu). You will see a loading screen, and after roughly ten seconds, the main window. No account or login is required. Patron is single-user and local, so your case files, source databases, and chat history stay on your computer.
2. **Add an AI model key.** This is the one step without which the assistant will not respond. Open **Account -> Models and API keys** and paste your provider's key (for example Libra/Anthropic, or Gemini/OpenAI). Save it. From that point the chat, document editing, and tables all work. Details: [Step 7](#10-step-7-choosing-the-model).
3. **Internet and file conversion.** A cloud model, and a live search of case law and legislation (legislation.gov.uk, Find Case Law, GOV.UK), require an internet connection. Search within your own documents works offline too. If uploading an old `.doc` file shows a conversion error, ask your administrator to install LibreOffice (it is free).

> **Tip:** Patron speaks to you in English and drafts documents in English. Not sure where to start? Just ask in the chat: **"What can you do?"** or **"Where do I start?"**, and it will walk you through its features step by step. If you can't see something, expand the left-hand panel (**Explorer**).

---

## 3. Screen map

The assistant's screen is split into **three vertical panels**:

| Panel | Name | What it's for |
|---|---|---|
| **left** | **Explorer** | the list of cases (projects) and documents; this is where you upload files |
| **centre** | **Document preview** | the content of the document you clicked; this is where tracked changes appear |
| **right** | **Assistant** | the chat, where you ask questions and give instructions |

You can collapse the left panel ("Collapse explorer") and expand it again when you need more room for the preview.

---

## 4. Step 1: create a case and upload files

**Rule 1: one case = one project.** Do not mix files from different matters. For every question you ask, Patron searches across all documents in the project.

### 4.1. Create a project
1. In the left panel, click **New project** (or "New case", shortcut **Ctrl+N**).
2. Give it a clear name, e.g. `Smith v. Jones Construction, 2026 claim`.

### 4.2. Uploading documents: three ways

- **Drag and drop:** select the files or folder in Windows File Explorer and drop them onto the panel (you will see "Drop to upload").
- **Upload documents:** the button in the left panel, then choose the files (PDF, DOCX, DOC).
- **Import case folder** (the fastest option with many files): point to the folder, e.g. `C:\Cases\Smith-2026`. Patron will import every file at once, run a security scan, and index it.

What happens behind the scenes (you don't need to do anything): Patron recognises the document's drafting structure (clauses, sub-clauses, schedules), runs OCR on scans, and the full text becomes searchable. This also works for paper scans and files with no text layer.

> **Rule 2: upload ALL the case files before your first question.** The more complete the case file, the more precise the answers. Documents added later will not retroactively change earlier answers.

---

## 5. Step 2: chat with the case files

In the right panel (**Assistant**), type your question and send it. Patron selects the most relevant passages across the whole case file on its own (you don't need to paste any text).

**Ask specific questions.** Instead of "what's in the contract", write:
- "What obligations does the contractor have under clause 5 of contract 3?"
- "List every payment term and liquidated damages clause in this contract."
- "Is there a limitation defence available? Point to the dates in the case file."
- "What inconsistencies are there between the main agreement and schedule 2?"

### Read the coloured badge next to citations
Every citation drawn from your documents gets a reliability indicator:

- 🟢 **green:** a verbatim quote, found in your case files. You can use it in a document, citing the source.
- 🟡 **amber:** possibly reworded or paraphrased. Check it against the original.
- 🔴 **red:** not found in the case file. **Do not cite it without manual verification.** It may be a form of words that only sounds like a quote.

> **Rule 3: check the badge before pasting a citation into a document.** It is your anti-hallucination filter.

---

## 6. Step 3: case law and legislation

The UK edition of Patron ships with **the UK law connector built in** (works immediately after installation, no configuration needed):

| Source | What you'll find there |
|---|---|
| **legislation.gov.uk** | Acts of Parliament and UK Statutory Instruments, plus the equivalent instruments of the Scottish Parliament, Senedd Cymru/Welsh Parliament, and Northern Ireland Assembly |
| **Find Case Law** | UK case law (The National Archives), primarily England & Wales, cited by neutral citation |
| **GOV.UK** | specific tribunal decisions (employment, tax, property) and regulator material (HMRC manuals, CMA cases) |

This connector deliberately does not cover the ICO, the FCA, or the Immigration and Asylum Chamber - Patron will say so openly if you ask about those.

Other connectors are NOT included in this installer, to keep the edition lean. EU law (**EUR-Lex**, the offline **EU-Compliance** corpus: GDPR, AI Act, DORA, NIS2, eIDAS 2.0, CRA) and connectors for other jurisdictions (including the Polish ones: SAOS, NSA, ISAP, KRS) are downloaded separately from the **MateMatic Boutique** (matematicsolutions.com/boutique) and connected to the application. Once installed, enable them in settings: **Account -> Connectors** ("Law connectors").

Ask in plain English and Patron will choose the right source on its own:

- "Find case law on unfair dismissal from the employment tribunal. Give me the case references."
- "Show me the Data Protection Act 2018 as currently in force."
- "What is the neutral citation for the Supreme Court decision in [case name]?"
- With the EU-Compliance connector installed from the Boutique: "What is the definition of a high-risk AI system under the AI Act?"

> **Remember:** these sources are a fast starting point, not a final check. Before citing a provision in a document, verify the text currently in force at the official source, because legislation changes.

---

## 7. Step 4: edit documents

This is the heart of day-to-day work. Patron edits documents in three ways. All of them end with a file you open in Word.

### 7A. Ask for a change, review the tracked changes, accept

The most convenient mode for targeted amendments to a contract or a pleading.

1. In Explorer, **click a DOCX document**. It appears in the centre panel (**Document preview**).
2. In the Assistant, write what you want, **pointing to the exact spot**:
   - "Propose an amendment to clause 4. I want to limit the contractor's liability to direct loss, excluding loss of profit."
   - "Add a clause to clause 3 setting the courts of England and Wales as having exclusive jurisdiction."
   - "Redraft clause 7 so the notice period is 3 months, effective from the end of the month."
3. Patron responds with **change cards**. Each card shows:
   - text **added**, in green,
   - text **removed**, in red with strikethrough,
   - a short **rationale** for the change.
4. Each card offers three buttons:
   - **Accept:** Patron applies the change and creates a **new version** of the document (real Word tracked changes),
   - **Reject:** the change disappears,
   - **Open:** preview the change in the context of the whole document.
5. Once accepted, download the finished file (the download icon next to the document) and open it in Word. You will see the changes as a tracked change awaiting final acceptance.

> You can accept changes one at a time or in bulk. Each acceptance saves a new version and earlier versions stay in the history, so nothing is lost.

### 7B. Strengthening a whole document: "Draft defence" (review, devil's advocate, language)

The mode for a whole pleading, or a longer passage you want to strengthen.

1. Open the **Draft defence** panel (the ✨ icon under the assistant's reply, or from the menu).
2. In the **Document text** field, paste your working draft.
3. Choose the devil's advocate perspective (**"from which angle"**):
   - **Opposing party:** how the other side's counsel will attack it,
   - **The court:** what the bench will press you on,
   - **Regulator/prosecutor:** the angle of the other institutional party.
4. Click **Strengthen the draft**. Patron runs the text through three stages:
   - **Reviewer:** flags logical gaps and weak references, and strengthens the argument,
   - **Devil's advocate:** anticipates and rebuts counterarguments from the chosen angle,
   - **Plain language:** removes "AI style" while keeping the legal precision.
5. You get a **ready draft** (which you can copy) and an expandable **"How this draft was built"** section showing what each stage changed.

> **Rule 4: the pipeline works best on a finished text, not an empty prompt.** Write your own version, paste it, and ask for it to be strengthened. Then add your own revision and, if needed, a second pass.

### 7C. Back and forth: edit in Word, return to Patron

If you prefer working in Word:

1. Download the document from Patron.
2. In Word, make **your own changes with tracked changes on**, add comments, and anywhere you want Patron to do something, write an instruction in a comment in the format `[PATRON: your instruction here]`.
3. Upload the file again (as a new version). Patron reads your tracked changes, comments, and `[PATRON: ...]` instructions, and learns your editing style.

### 7D. Versions and downloads
- Every accepted change = a new version (history is kept).
- Download a single file with the download icon, or the whole project as a ZIP.

---

## 8. Step 5: a table from contracts

When you have **many similar documents** (e.g. 30 lease agreements) and want to compare them in a table, use **Tabular review**.

1. Go to **Tabular reviews -> + Create new**.
2. Add columns, from ready-made legal presets (Parties, Subject matter, Liquidated damages, Governing law, Notice period...) or your own, e.g. "GDPR clause: yes/no".
3. Click **Generate**. The table fills in as it streams: Patron searches each document and inserts the result.
4. Every cell has a reliability badge (🟢/🟡/🔴). 🔴 means manual verification; click the cell to see the source.
5. Export to Excel for the client or the team.

> The point: review a set of contracts in one pass instead of opening them one by one, and every cell links back to its source.

---

## 9. Step 6: workflows

Save a repeatable task once (e.g. "Lease review", "Due diligence review") as a **workflow** and run it on new cases with a single click.

- Start with the built-in workflows.
- Your own: **Workflows -> Add workflow**, write the step-by-step instructions and save.
- You can share a workflow with colleagues, so the whole firm runs due diligence against the same checklist.

---

## 10. Step 7: choosing the model

Patron is **provider-neutral**, so you choose the model. It's a single setting in **Account -> Models and API keys**, and changing it never requires reinstalling.

- **A cloud model (e.g. Libra/Claude, Gemini)** gives the strongest drafting and reasoning quality. It is the ordinary working choice for a firm. The content of your request then goes to the provider you chose.
- **A local model (Ollama)** works without internet, at zero cost. It requires a one-off install of Ollama and downloading the model onto your computer.

You can combine them: a cheaper or local model to explore the case file, a stronger one for the final document. Usage and cost are tracked in **Account -> Usage** (filterable by case).

**Privileged matters and the cloud.** In the desktop edition, you - the lawyer, on your own machine - are the host of the data, so choosing a cloud model is an informed choice you make yourself. Patron lets you work with any model, including on matters marked as privileged. **Every** flow of data to a model is logged in an immutable audit trail (evidence of due diligence, AI Act art. 12), and personal data is masked before it is sent. If the firm wants a stricter regime (e.g. privileged matters on a local model only), the administrator can set that. By default, nothing blocks you.

---

## 11. Skills library

The **Skills library** is a set of "skills" Patron applies when strengthening a document:

- **Built in** (always active): **Reviewer**, **Devil's advocate**, **Plain language**.
- **Installed** (yours): you can enable, disable, and import additional stages from a file.

The built-in ones require no configuration. They work inside the "Draft defence" panel.

---

## 12. FAQ

**The assistant doesn't respond, or the chat returns an error (especially right after installation).**
The most common cause is a missing model key. Open **Account -> Models and API keys** and add a key (e.g. Libra/Anthropic). The second most common cause is no internet with a cloud model selected. Also check in **Account -> Models and API keys** that the selected model is one you actually hold a key for.

**Do my case files end up in the cloud?**
Only if you chose a cloud model; in that case the content of your request goes to that provider. With a local model, everything stays on your computer. Files, source databases, and chat history are always stored locally.

**Patron wrote something that isn't in the case file.**
Check the badge: 🔴 means unverified. Models can "fill in the gaps". The badge, and your own verification, are the final filter - Patron does not replace them.

**DOCX/PDF conversion isn't working.**
Document conversion requires LibreOffice on the machine. If something is missing, report it to your firm's administrator.

**How do I export a document with comments to Word?**
Ask for the changes as tracked changes (Step 4A), accept the ones you want, and download the DOCX. In Word you will see a tracked change awaiting final acceptance.

**Does Patron check whether a provision is currently in force?**
The sources give fast access to the text, but they can lag behind the official record. Verify the text in force at the official source before drafting.

**Does Patron make legal decisions?**
No. Legal judgement, signature, and professional responsibility remain yours.

---

## 13. Quick reference: ready-made prompts

**Chat with the case files**
- "List every payment term and liquidated damages clause in this contract."
- "What inconsistencies are there between document A and document B?"
- "Is there a limitation issue? Point to the dates in the case file."

**Case law and legislation**
- "Find case law on [topic]. Give me the case references."
- "Show me [Act name] as currently in force."
- With the Polish connectors enabled: "Check [company name] in the KRS."

**Editing a document (after clicking a DOCX file)**
- "Propose an amendment to clause [X]: [what you want], as tracked changes."
- "Add a clause to [X] on [description]."
- "Redraft clause [X]: [new text or goal]."

**Strengthening a document**
- The "Draft defence" panel: paste the text, choose the angle, then "Strengthen the draft".

---

*Patron is a tool that supports the lawyer's work. Every document is verified and signed by the lawyer before it is sent. This document reflects the state of the application as of June 2026.*
