# Claw Machine: control a robot with your body pose

## 1. What this demonstrates

Your webcam watches you. The browser finds your head, shoulders, and arms, then turns your pose into robot commands: **stand left / middle / right** to move, and **raise both hands over your head** (arms wide = open claw, hands together = close claw). Right now the "robot" is pretend: the commands are just printed in a console on the page.

## 2. How it works

```
 webcam --> <canvas> --> MediaPipe PoseLandmarker --> pose-logic.js --> robot.js
              ^                  (33 body points)       "what does this        "move left"
              |                                          pose mean?"            "open claw" ...
              +-- video AND skeleton overlay drawn here, so they always line up
```

**Architecture rung 1: pure browser.** Everything runs in the page. No Python, no server, no install. MediaPipe's pose model runs right in your browser, and your video never leaves your computer. (The page does download the MediaPipe library and the model file from the internet the first time it loads, so you need to be online.)

| File | Job |
|---|---|
| [index.html](index.html) | The page: video area, status line, robot console |
| [app.js](app.js) | Camera, MediaPipe, drawing the overlay, sending commands |
| [pose-logic.js](pose-logic.js) | Pure math: "where is the body, and what are the arms doing?" Settings to tune are at the top |
| [robot.js](robot.js) | The 5 robot functions (`moveLeft`, `moveRight`, `stopMoving`, `openClaw`, `closeClaw`). **Fake for now. This is the file you change to talk to a real robot.** |

## 3. What you need

- A computer with a webcam
- **Chrome, Edge, or another Chromium browser** (Firefox and Safari may work, but this was built and tested for Chromium)
- An internet connection (for the MediaPipe library + model, loaded from CDNs)
- No accounts, no keys

## 4. How to run it

1. Download this folder (or the whole repo as a ZIP and unzip it).
2. **Double-click `index.html`** to open it in Chrome or Edge.
3. Click **Start camera** and click **Allow** when the browser asks.
4. Stand back so your head, shoulders, and hands are all visible, and try it.

If the camera won't start when double-clicking, serve the folder instead (this also uses `http://localhost`, which browsers treat as secure):

| | macOS / Linux | Windows (PowerShell / Command Prompt) |
|---|---|---|
| In this folder, run | `python3 -m http.server 8000` | `python -m http.server 8000` |
| Then open | `http://localhost:8000` | `http://localhost:8000` |

(Python is only used as a tiny file server here. Press Ctrl+C in the terminal to stop it.)

**What you should see:** the mirrored video split into three tinted bands (the one you're standing in glows brighter), a yellow skeleton on top of you (cyan dots = hands, white ring = the point used for left/middle/right), a line of live numbers under the picture, and the **Robot console** printing a line each time a command changes.

## 5. What to look at

- **[robot.js](robot.js)**: the whole "robot side". Replace the `robotLog(...)` in each function with real code later (e.g. send a message to a LEGO SPIKE hub).
- **[pose-logic.js](pose-logic.js), top of file**: all the numbers you can tune (zone edges, claw angles, how many frames before a change counts).
- **[pose-logic.js](pose-logic.js), `analyzePose()`**: the three steps: body position → hands above head? → arm angle.
- **[app.js](app.js), `toPixels()` and `drawVideoFrame()`**: how the video and overlay are kept lined up (next section).
- **[app.js](app.js), `updateRobot()`**: where a changed state turns into a `robot.*` call.

### How the commands are decided

| You do | Command (printed once, when it changes) |
|---|---|
| Body (middle of shoulders) in **left** third | `move left` |
| Body in **middle** third, or **nobody** in view | `stop moving` |
| Body in **right** third | `move right` |
| Both hands above your nose, arms leaning out in a wide V (more than 35° from vertical) | `open claw` |
| Both hands above your nose, hands together or arms straight up (less than 10°) | `close claw` |
| Hands down, or arms somewhere in between | nothing (claw keeps its last state) |

Two safety/smoothness choices: "no person" means **stop**, and a new state must be seen for 5 frames in a row before it counts (otherwise the robot would twitch as the detector jitters).

### Why the overlay lines up (and what usually goes wrong)

The usual trouble is drawing a `<video>` and a separate `<canvas>` on top of each other, then having them scale differently. This demo avoids it:

1. The `<video>` is hidden. Each frame is **copied onto one `<canvas>`**, and the skeleton is drawn on that same canvas.
2. The canvas's internal size is set to the camera's **real** size (`video.videoWidth` × `videoHeight`), because the camera may not give you the size you asked for. CSS then just shrinks or stretches the whole canvas as one image, keeping its shape (`height: auto`).
3. MediaPipe gives points as **0–1 fractions** of the frame. We multiply by the canvas width and height to get pixels. Angles must be computed from pixels (not fractions) or they come out wrong on a wide picture.
4. **Mirroring** is done in code (flip the video, and use `1 - x` for the points) instead of with CSS, so text stays readable and drawing and logic agree. Set `MIRROR = false` in [app.js](app.js) if you want the un-mirrored camera view (note that left and right then swap relative to what you see in a mirror).

This was checked with 4:3, 16:9 and portrait camera shapes, and with the page scaled down, and the skeleton stayed on the body each time.

## 6. Where to go next

- **Connect a real robot.** Fill in the five functions in `robot.js`. For a LEGO SPIKE hub over Bluetooth, see the `spikecomm` library the instructor can point you to. Nothing else needs to change.
- **Smoother movement.** Instead of left/stop/right, send speed based on how far from center you are (`pose.centerX`).
- **Add a "drop" gesture** (e.g. both hands quickly down) or a lift-up/down axis using the hands' height.
- **Tune it for your room**: change the thresholds at the top of `pose-logic.js`. The live readout under the video shows your current arm angle.
- **Make it look like your project**: restyle the page, show an icon of the claw, play a sound on `closeClaw()`.
- **More accurate model**: in `app.js`, change `pose_landmarker_lite` in `MODEL_URL` to `pose_landmarker_full` (slower, more accurate).

## 7. Left out on purpose / limitations

- **No robot connection**, by design (see `robot.js`).
- **One person only** (`numPoses: 1`). With a crowd, it follows whoever the model picks.
- Detection is 2D: standing closer or farther doesn't change the commands, but turning sideways can confuse the arm angle.
- Hands that go off the top of the picture are *guessed* by the model. Stand far enough back that your hands stay in view.
- No saving, no settings screen, minimal styling.
- Not tested with a real webcam here (tested with recorded photos fed in as a fake camera, in Chrome). Pose quality in a real room depends on lighting and background.

## 8. Troubleshooting

- **"MediaPipe did not load" / stuck on "Loading pose model"**: you're offline, or a school network is blocking `cdn.jsdelivr.net` or `storage.googleapis.com`. Try another network.
- **Camera doesn't start or permission is denied**: click the camera icon in the address bar and allow it; close other apps using the camera (Zoom, etc.); or run the local server from section 4 and use `http://localhost:8000`.
- **Skeleton jumps around or the readout says "no person found"**: more light, stand back, and keep your head and shoulders fully in the picture.
- **Yellow/red messages in the browser console** (such as `landmark_projection_calculator` or `GL` warnings) come from MediaPipe's internals and are normal. The demo still works.

_Built with `@mediapipe/tasks-vision` 1.2.3 and the `pose_landmarker_lite` model (checked 2026-11-20). No Python, so no virtual environment is needed._
