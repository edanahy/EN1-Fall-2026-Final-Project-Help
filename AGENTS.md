# AGENTS.md — EN1 Fall 2026 Final Project Help

## Purpose of this repo

A **playspace for prototyping small example apps** for students in an intro engineering class (EN1-08, Fall 2026) working on final projects. Students have ideas but need technical help. Each example shows **how a tech stack works or how components fit together**, so the student can take it and build their own project.

**Prototypes are demonstrations, not products.** The student expands, polishes, adds graphics, and fills in the details. Your job is the smallest working thing that proves the approach and teaches it.

This folder is a **GitHub repo**. The instructor points each student group to their own sub-folder. The root [README.md](README.md) is student-facing ("go to your project's sub-folder"). Keep it generic. Don't list project details there unless the user asks.

## Audience

First-year engineering students with limited programming experience, plus the instructor, who hands the prototype over in person. Write for them:

- Assume little background. Explain unfamiliar concepts briefly where they appear.
- Prefer readable code over clever code, and common, well-documented libraries.
- Students read the code to learn. Comments say *why* and point out *where to modify*.
- Assume a mix of macOS and Windows (Chromebooks possible). Give commands for both wherever commands differ.

## Workflow: how a new project request works

The user describes a "new project": name, what the student wants to build, the stack or hardware, and what the demo should show. The user may have **pre-created the sub-folder** with starter code, notes, data, or hints. **Check whether the folder exists and read everything in it first.** Treat existing files as intent. Build on them rather than overwriting.

1. **Locate or create** `./<project-slug>/` (lowercase, hyphenated, e.g. `spike-hub-to-web`). Never put project files in the repo root.
2. **Read any existing contents** of that folder.
3. **Clarify only if blocked.** Ask if a missing detail would change the architecture. Otherwise pick sensible defaults, state them, and proceed.
4. **Choose the lightest architecture that works** (see "Architecture ladder").
5. **Plan briefly:** what the demo shows, which components talk to each other, what is deliberately left out.
6. **Build the minimal working prototype.**
7. **Verify** what can be run (see "Verification").
8. **Write the project README** (template below).
9. **Update the project index** at the bottom of this file.
10. **Report back:** what was built, how to run it, what was and wasn't tested, assumptions made, and suggested next steps for the student.

## Architecture ladder (pick the lowest rung that works)

1. **Pure browser, opens via `file://`.** *Preferred.* A single `index.html` (plus optional local JS/CSS) that students download and double-click. No build step, no server, no install. Use CDN scripts only if unavoidable, and prefer pinned versions. Remember that fully offline use is nicer when possible.
2. **Browser needing a web server** (fetching local files, ES modules, `fetch()` of JSON, Web Bluetooth/Serial secure-context quirks, etc.). Document one of:
   - a local server: `python3 -m http.server` (Mac) / `python -m http.server` (Windows), then open `http://localhost:8000`; or
   - hosting on the student's own **GitHub Pages**, with brief steps.
   Say clearly in the README *why* `file://` doesn't work for this project.
3. **Browser + Python back-end** (needed for API calls with secrets, hardware access, etc.). Provide the Python server code (keep it simple: Flask or FastAPI, or stdlib), a `requirements.txt`, venv setup, and launch instructions. Explain why a back-end is needed and what it does.
4. **Standalone on-device code** (e.g. a program running on a SPIKE Prime hub), with any computer-side helper kept minimal.

Always explain in the project README which rung it is on and why.

## Python projects

Anything using Python **must** use a virtual environment named `.venv` inside the project folder, plus a pinned `requirements.txt`. The README must:

- Say "make sure Python 3 is installed" (assume students can install it themselves).
- Walk through venv setup with commands for **both** platforms:

  | Step | macOS / Linux | Windows (PowerShell) |
  |---|---|---|
  | Create | `python3 -m venv .venv` | `python -m venv .venv` |
  | Activate | `source .venv/bin/activate` | `.venv\Scripts\Activate.ps1` |
  | Install | `pip install -r requirements.txt` | `pip install -r requirements.txt` |
  | Deactivate | `deactivate` | `deactivate` |

  Also mention the Windows Command Prompt activate (`.venv\Scripts\activate.bat`) and the PowerShell execution-policy hiccup (`Set-ExecutionPolicy -Scope Process RemoteSigned`) in troubleshooting.
- Show how to run the program from inside the activated venv.

Create and test the venv yourself while building (inside the project folder only). `.venv/` is git-ignored.

**Computer vision (OpenCV):** treat it as a Python back-end project in a venv (`opencv-python` in `requirements.txt`), i.e. rung 3, unless the demo is simple enough for in-browser processing (e.g. canvas or OpenCV.js) and can stay on rung 1. No other extra stacks (Node, Arduino/ESP32, etc.) are expected; ask before introducing one.

## Secrets and LLM projects

Only a **minimal number of projects** need an LLM or other secret key. Don't add an LLM to a project unless the spec calls for it.

When a project does use an API key (typically an OpenAI/ChatGPT key):

- Keys live in a **`.env`** file (git-ignored by the root [.gitignore](.gitignore)), loaded by the Python back-end. **Never put a key in browser-side JavaScript or any committed file.** This is a main reason LLM projects need a back-end (rung 3).
- Commit a **`.env.example`** with placeholder values (`OPENAI_API_KEY=your-key-here`).
- The project README must include a clearly visible section, e.g. **"This project needs a secret key"**, explaining: what the key is for, that it goes in `.env` (copy from `.env.example`), that it must never be committed or shared, and **"reach out to your instructor for access. The instructor can issue a ChatGPT/OpenAI API key for course projects."**
- Provide a **mock mode** (canned responses) where practical, so students can run and read the demo before they have a key.
- Default to the **OpenAI Python SDK** (the instructor issues OpenAI keys) unless the user specifies otherwise.
- **Model choice:** use a good, capable, mainstream model, not the most expensive or high-reasoning one. Accuracy matters more than cutting-edge. Match capability to the need (e.g. vision input, or image generation/editing for an "upload an image, get a modified image back" project).
- **Put the model name in a clearly marked constant at the top of the code** (e.g. `MODEL = "..."`, `IMAGE_MODEL = "..."`) with a comment that students can change it. Don't scatter model names around.
- Check the current OpenAI docs for model names and SDK usage (these change often) rather than relying on memory, and note in the README which model was used and when it was verified.
- Before finishing, confirm no real key appears anywhere in the folder (`grep` for key patterns) and that `.env` is ignored.

## LEGO SPIKE Prime hardware

Hardware is usually the **LEGO Education SPIKE Prime hub running SPIKE 3 firmware** (MicroPython). When the user specifies it:

- Write **valid SPIKE 3 code**: the `hub`, `motor`, `color_sensor`, `distance_sensor`, `force_sensor`, `color_matrix`, `runloop`, `motor_pair` modules (e.g. `from hub import port, light_matrix, sound`; `import motor, runloop`), **not** the old SPIKE 2 / `spike` / `mindstorms` API. **Reference docs: <https://github.com/tuftsceeo/SPIKEPythonDocs/blob/main/SPIKE3.html>**. Consult them before writing hub code rather than guessing, and flag anything unverified in the README. You can't run hub code here, so be conservative.
- Students already know how to install and run Python on a hub (standalone), and how to connect via USB or Bluetooth (for web apps that talk to a hub). A brief reminder is enough, not a full tutorial.
- Provide a **simulation or mock** path when the demo has a computer side, so it's testable without a hub.

### Multi-hub projects: `spikecomm`

For hub-to-hub (or hub-to-web-page) communication, use the custom library **[`spikecomm`](https://github.com/edanahy/spikecomm)** (single file `spikecomm.py`, v1.2.0 when this was written). Students know how to add it to their hubs. **Read the library's README (and its `examples/` folder) before using it. Don't rely on this summary for API details.** Key facts:

- **Beacon mode** (connectionless broadcast; `Beacon` → `Scanner`) and **Direct mode** (BLE connection; `Peripheral` ↔ `Central`). A web page (Chrome/Edge, Web Bluetooth) can act as a Central. Helpers: `encode()` / `decode()`.
- **It does NOT work from programs started by the SPIKE App's Run button or a hub program slot.** Programs using it must be started from the **REPL** (e.g. `mpremote run program.py`, or paste mode / `exec(open(...).read())`). Every README for a spikecomm project must say this prominently, since it is the #1 thing that will confuse students.
- Install onto each hub with `mpremote cp spikecomm.py :spikecomm.py` over USB, with the SPIKE App closed. Document that step (or link the spikecomm README) in each project that uses it. Copy `spikecomm.py` into the project folder so it is self-contained.
- Do **not** use the `bluetooth` module directly alongside spikecomm (can freeze the hub).
- Limits to design around: beacon payload ≈ 24 characters, latest-value only; direct messages ≤ 1000 chars, no newlines; keep callbacks short; a hub can be a Beacon *or* a Peripheral, not both.
- Web Bluetooth (and Web Serial) works in Chrome, Edge, and other Chromium-based browsers only (not Safari/Firefox/iOS) and needs a secure context, so such web demos may need `localhost` or GitHub Pages instead of `file://`. Students already know this, so just put a **one-line reminder** ("Use Chrome, Edge, or another Chromium browser") in the README. No lecture.

## GitHub Pages and the root index.html

GitHub Pages is enabled for this repo, serving from the root. The root [index.html](index.html) is a simple landing page linking to each project's folder.

- Static demos (rungs 1 and 2) are then reachable at `https://<user>.github.io/<repo>/<project-slug>/`, with no extra infrastructure. Use **relative paths** in project HTML so it works from `file://`, from Pages, and from a student's own fork.
- **Pages is a convenience, not the plan.** Students are expected to download the folder and build their own version quickly, so every project README must still work from a plain download. Never make a project depend on this repo's Pages URL.
- Back-end projects (rung 3) and anything needing secrets **cannot** run on Pages. Link them on the landing page as "needs setup, see README", not as a live demo.
- When adding a project, **add its link to `index.html` and to the project index below.**

## Git

The instructor decides when to commit. **Do not commit or push unless asked.** When asked to commit, stage only what belongs, check that no secrets or `.venv`/junk files are included (`git status`), and write a clear message.

## Scope rules (important)

- **Keep it small.** Roughly 1–5 source files and a couple hundred lines where possible. Something a student can read in one sitting.
- **Demonstrate the integration, not the full feature set.** E.g. hub → Bluetooth → web page → chart.
- **Stub or fake what's hard.** Sample data, mock sensors, placeholder values, and make the swap to the real thing obvious.
- **No gold-plating.** No auth systems, deployment pipelines, elaborate styling, or test suites unless asked. Leave "extend here" hooks.
- **Match the spec.** Don't invent features or turn a simple demo into a full app.
- **Leave room for students' creativity.** Basic functional visuals only.

## Conventions for each sub-folder

Each project is **self-contained and independent**. No shared code, dependencies, or configs between sub-folders (copy a file rather than reference another project). Different projects use different stacks.

```
<project-slug>/
├── README.md            # required
├── index.html / *.py …  # simple, well-commented source
├── requirements.txt     # if Python (pinned)
├── .env.example         # only if a secret is needed
└── <sample data / assets>
```

### Project README template (required, student-facing)

1. **What this demonstrates:** 1–2 plain-language sentences.
2. **How it works:** components and how they interact; simple ASCII diagram welcome. State which architecture rung it uses and why.
3. **What you need:** software, hardware, accounts, versions.
4. **⚠ Secret key needed?** Only if applicable (see above).
5. **How to run it:** exact copy-pasteable steps for Mac *and* Windows where they differ.
6. **What to look at:** files/lines that carry the key idea.
7. **Where to go next:** concrete ways to extend it ("make it yours").
8. **Left out on purpose / limitations.**
9. **Troubleshooting:** the 2–4 likeliest problems.

### Code style

- Clear names, short functions, comments explaining intent.
- Configurable values (ports, URLs, thresholds, model names) as clearly marked constants at the top.
- No hard-coded secrets, ever.
- Free, widely available tools with minimal install friction.

## Verification

- Actually run what can be run (scripts, servers, linters). For browser demos, load the page and check for console errors if tooling allows, and test the `file://` claim if the project says it works that way.
- For things that can't run here (hubs, Bluetooth, paid APIs), say so explicitly, make the code easy to verify by reading, and provide a mock mode.
- Install dependencies inside the sub-folder only (`.venv`, local `node_modules`). **Never install globally** or modify the system without asking.

## Safety and privacy

- Ask before anything destructive, anything outside this repo, or anything that costs money or sends data to external services.
- Keep demos local and privacy-respecting by default (cameras, mics, location).
- No personal information about the instructor or students in code, READMEs, or external requests.
- This repo is pushed to GitHub: before finishing any project, check that nothing sensitive (keys, `.env`, personal data, large junk) would be committed.

## Orchestrating multiple projects

- Several prototypes at once is fine: **one parallel sub-agent per project folder**, each given this file's conventions plus its own spec, each writing only inside its own folder.
- Don't edit another project's folder unless explicitly asked.
- Keep the project index below current.

## Maintaining this file

The instructor expects some of these rules to collide with reality as examples get built. When a rule is impractical, do the sensible thing, tell the user, and suggest an edit to this file.

## Project index

<!-- One line per project: - [folder](./folder/) — description — stack / architecture rung -->

_(none yet)_
