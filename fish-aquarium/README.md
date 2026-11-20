# Fish Aquarium 🐟

## 1. What this demonstrates

Hold a drawing of a fish up to your webcam, click **Capture**, and the picture is sent to an AI image model (OpenAI) that cuts the fish out and gives it a **transparent background**. The fish then swims around a virtual aquarium in the browser.

It shows the three things you'll need for a project like this:

1. **Grab a still image from a live camera** in a web page.
2. **Send it from the browser to a Python server** and get a result back.
3. **Call the OpenAI API** from that server.

(Controlling the fish with a SPIKE Prime hub is left for you to add. See "Where to go next".)

## 2. How it works

```
   BROWSER (index.html)                         PYTHON SERVER (app.py)               OPENAI
 ┌───────────────────────────┐   POST photo   ┌────────────────────────┐  edit   ┌────────────┐
 │ <video> live camera       │ ─────────────► │ decode photo           │ ──────► │ image model│
 │ [Capture] → <canvas>      │  (JSON, base64)│ call OpenAI (key is    │ ◄────── │ "cut out   │
 │ aquarium: <img> + JS      │ ◄───────────── │  stored here, secret!) │  PNG    │  the fish" │
 │ moves the fish around     │  fish PNG      │ crop to the fish       │         └────────────┘
 └───────────────────────────┘ (transparent)  └────────────────────────┘
```

**Architecture rung: browser + Python back-end.** Two reasons you can't do this with just a web page:
- The **OpenAI key is secret**. Anything in browser JavaScript can be read by anyone, so the key lives in the Python server.
- The camera needs `http://localhost` (or https). Double-clicking `index.html` (`file://`) won't work, because the page has to be sent by the server so it can talk to it.

**No key yet? Mock mode.** If there's no key, the server still works: it makes the white paper transparent with a simple "paint-bucket" trick instead of AI. It's a good comparison to see what the AI adds (it can handle messy backgrounds, shadows, and so on).

## 3. What you need

- **Python 3** installed (3.10 or newer), a **webcam**, and **Chrome, Edge, or another Chromium browser** (tested in Chromium).
- An OpenAI key for real (AI) mode. Not needed for mock mode.
- A fish drawn in dark outline/colors on **plain white paper**, taped or held flat and well lit.

## 4. ⚠ This project needs a secret key (for AI mode)

The key lets your server use OpenAI's image model (it costs the course a small amount per picture).

- **Reach out to your instructor for access.** The instructor can issue an OpenAI API key for course projects.
- Put it in a file named **`.env`** in this folder (copy `.env.example` to `.env`, then replace `your-key-here`).
- **Never commit or share the key or your `.env` file** (it is already git-ignored). Never paste it into `index.html` or any JavaScript.
- Note: OpenAI may ask the key's organization to complete "API Organization Verification" before image models work. If you get a permissions error, tell your instructor.

## 5. How to run it

Open a terminal **inside the `fish-aquarium` folder**.

| Step | macOS / Linux | Windows (PowerShell) |
|---|---|---|
| Create venv | `python3 -m venv .venv` | `python -m venv .venv` |
| Activate | `source .venv/bin/activate` | `.venv\Scripts\Activate.ps1` |
| Install | `pip install -r requirements.txt` | `pip install -r requirements.txt` |
| Deactivate (when done) | `deactivate` | `deactivate` |

(You only create the venv and install once. Activate it every time you open a new terminal.)

Optional, for AI mode: copy the key file.

| macOS / Linux | Windows (PowerShell) |
|---|---|
| `cp .env.example .env` | `Copy-Item .env.example .env` |

Then open `.env` in a text editor and paste in your key.

**Start the server** (with the venv activated):

| macOS / Linux | Windows |
|---|---|
| `python3 app.py` | `python app.py` |

The terminal prints `MOCK mode` or `REAL mode`. Now open **<http://localhost:8000>** in your browser, click **Allow** for the camera, hold up a drawing, and click **📷 Capture fish**. AI mode takes roughly 10–60 seconds per fish. Stop the server with `Ctrl+C`.

## 6. What to look at

| File | The key idea |
|---|---|
| [index.html](index.html) `startCamera()` | `getUserMedia` turns on the camera and feeds a `<video>` tag |
| [index.html](index.html) `captureFrame()` | draw the video onto a `<canvas>`, then `toDataURL()` turns the picture into text |
| [index.html](index.html) `makeFish()` | `fetch()` sends that text to Python and waits for the answer |
| [index.html](index.html) `animate()` | moves each fish a little every frame and bounces it off the walls |
| [app.py](app.py) `make_fish()` | the route (URL) that receives the photo and sends back the fish |
| [app.py](app.py) `make_fish_with_openai()` | the actual OpenAI call (`client.images.edit`) |
| [app.py](app.py) top of file | `IMAGE_MODEL`, `PROMPT`, quality and size settings to experiment with |

**Model used:** `gpt-image-2.5-sunburst` with `background="transparent"`, as listed in the OpenAI docs on 2026-11-20. OpenAI replaces image models often, so if it's ever rejected, check the [image generation guide](https://developers.openai.com/api/docs/guides/image-generation) for current names and change `IMAGE_MODEL` at the top of `app.py`.

## 7. Where to go next ("make it yours")

- **Change the prompt** in `app.py` (e.g. "keep the pencil texture", "make it look like a cartoon"). Try it with a messy background.
- **Better swimming:** wavy motion, speeds based on fish size, fish that avoid each other, bubbles, sand and plants (CSS or images).
- **Use a fish template:** print an outline, color it in, capture it.
- **Control a fish with a SPIKE Prime hub:** each fish in `animate()` has `vx` and `vy` (its speed). Have your hub input change those numbers, for example a motor angle or distance sensor setting `vy`.
- **Save fish** so they're still there after a refresh (browser `localStorage`, or save PNGs in a folder from Python).
- Drag the fish with the mouse, click to feed them, add sound.

## 8. Left out on purpose / limitations

- No hub/robot control, no saving, no accounts, plain styling. It's a demonstration for you to build on.
- Each captured fish costs an API call. There's no rate limit or retry logic.
- Fish are assumed to be **drawn facing right**. If yours face left, set `FISH_DRAWN_FACING_RIGHT = false` in `index.html`.
- Mock mode only works on a drawing on **plain light paper** and may leave faint specks (`MOCK_TOLERANCE` in `app.py`). It is not AI.
- Not every OpenAI model produces transparent backgrounds. If the AI hands back a picture with a solid background, the server automatically falls back to the simple paper cutout (you'll see a note in the terminal).
- **Tested:** the server, browser page (fake camera), capture → server → swimming fish, mock mode, and the OpenAI code path using a **stand-in (fake) OpenAI client**. **Not tested:** a live OpenAI call (needs a real key), so the exact model name and transparency behavior should be confirmed with a real key on first run.

## 9. Troubleshooting

- **Camera doesn't start / "Open this page through the Python server":** use `http://localhost:8000` (not the file). Allow the camera in the browser's address-bar permission, and close other apps using the camera (Zoom, etc.).
- **`ModuleNotFoundError` or `python` not found:** the venv isn't activated (run the Activate step) or you skipped `pip install -r requirements.txt`.
- **Windows PowerShell won't activate the venv:** run `Set-ExecutionPolicy -Scope Process RemoteSigned`, then activate again. In Command Prompt use `.venv\Scripts\activate.bat`.
- **"Port 8000 is in use":** another program (or an old copy of this server) is running. Close it, or change `PORT` in `app.py`.
- **"Could not make the fish: ...401 / invalid key":** check `.env` (the key must be on the line `OPENAI_API_KEY=...`, no quotes), then stop and restart the server. Other errors (model not found, access/verification): see section 4 and tell your instructor.
