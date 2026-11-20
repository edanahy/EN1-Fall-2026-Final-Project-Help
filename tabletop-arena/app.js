/* ============================================================================
 * app.js  --  glue between the hub (or the keyboard), calibration, and the game.
 *
 * The data flow, in four steps:
 *   hub program print()s "<S,120,-35,0>"
 *     -> spikeble.js delivers that text ("console" event)
 *     -> parseStream() pulls the numbers out into `raw`        (RAW readings)
 *     -> readInputs() uses the calibration to turn raw into x / aim / fire  (0..1, -1..1, true/false)
 *     -> game.js moves the player with those values
 *
 * Without a hub, the keyboard changes `raw` instead, so everything else is identical.
 * ========================================================================== */
"use strict";

// ===== Settings ===============================================================
// Used until you calibrate. These match what the keyboard mode produces.
const DEFAULT_CALIBRATION = {
  moveMin: -360, moveMax: 360,   // raw port-A values for "far left" and "far right"
  aimMin: -90,   aimMax: 90,     // raw port-B values for "aimed left" and "aimed right"
  fireLevel: 20,                 // raw force (0-100) at or above this counts as "firing"
};
const STORAGE_KEY = "tabletop-arena-calibration";

// Matches one complete reading from hub_stream.py, e.g. "<S,120,-35,0>".
// If you change the print() format in hub_stream.py, change this too.
const PACKET_RE = /<S,(-?\d+),(-?\d+),(-?\d+)>/g;

// Keyboard mode: how fast the fake motors move (raw units per tick, tick = 30 ms)
const KEY_MOVE_STEP = 12, KEY_AIM_STEP = 3;

// Fire calibration: seconds you get to press the force sensor after clicking the button
const FIRE_CAPTURE_SECONDS = 3;
// ==============================================================================

const $ = (id) => document.getElementById(id);

// ---- Current raw readings (from the hub OR the keyboard) -----------------------
const raw = { a: 0, b: 0, f: 0 };      // a = port A, b = port B, f = port C force
let source = "keyboard";               // "hub" once Bluetooth is connected
let packetCount = 0;

// ---- Calibration (saved in the browser so it survives a page reload) ---------------
let cal = loadCalibration();
function loadCalibration() {
  try { return { ...DEFAULT_CALIBRATION, ...JSON.parse(localStorage.getItem(STORAGE_KEY)) }; }
  catch (e) { return { ...DEFAULT_CALIBRATION }; }
}
function saveCalibration() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cal)); } catch (e) { /* storage blocked: fine */ }
}

// ============================================================================
// Raw numbers -> game inputs  (this is where calibration is used)
// ============================================================================
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** Where is `value` between `lo` and `hi`?  0 at lo, 1 at hi. Works even if lo > hi (reversed motor). */
function fraction(value, lo, hi) {
  if (hi === lo) return 0.5;                       // not calibrated yet: avoid dividing by zero
  return clamp01((value - lo) / (hi - lo));
}

function readInputs() {
  return {
    x: fraction(raw.a, cal.moveMin, cal.moveMax),            // 0 (left) .. 1 (right)
    aim: fraction(raw.b, cal.aimMin, cal.aimMax) * 2 - 1,    // -1 (left) .. +1 (right)
    fire: raw.f >= cal.fireLevel,
  };
}

// ============================================================================
// Bluetooth: connect, and turn printed text into `raw`
// ============================================================================
const hub = new SpikeBLE.SpikeHub();
let textBuffer = "";   // text received but not yet part of a complete "<S,...>"

hub.on("console", (text) => {
  // Each print() arrives as TWO messages: the text, then a lone "\r\n". Only show the ones with real content,
  // otherwise the newline-only messages instantly overwrite the interesting one.
  if (text.trim() !== "") $("lastMsg").textContent = text.trim();
  textBuffer += text;
  let m, consumed = 0;
  PACKET_RE.lastIndex = 0;
  while ((m = PACKET_RE.exec(textBuffer)) !== null) {      // take EVERY complete reading in the buffer...
    raw.a = Number(m[1]); raw.b = Number(m[2]); raw.f = Number(m[3]);   // ...the last one wins
    packetCount++;
    consumed = PACKET_RE.lastIndex;
  }
  textBuffer = textBuffer.slice(consumed).slice(-100);     // keep any partial reading, but never grow forever
});

hub.on("disconnect", () => setSource("keyboard", "Disconnected. Back to keyboard mode."));

$("connectBtn").onclick = async () => {                   // Web Bluetooth only works from a click
  try {
    $("connStatus").textContent = "Connecting...";
    await hub.connect();
    setSource("hub", "Connected. Start the program on the hub.");
  } catch (e) {
    $("connStatus").textContent = "Could not connect: " + e.message;
  }
};
$("disconnectBtn").onclick = () => hub.disconnect();
$("startBtn").onclick = () => hub.startProgram(Number($("slot").value)).catch(showError);
$("stopBtn").onclick  = () => hub.stopProgram(Number($("slot").value)).catch(showError);
function showError(e) { $("connStatus").textContent = "Error: " + e.message; }

function setSource(newSource, message) {
  source = newSource;
  const connected = source === "hub";
  $("connStatus").textContent = message;
  $("connectBtn").disabled = connected;
  for (const id of ["disconnectBtn", "startBtn", "stopBtn"]) $(id).disabled = !connected;
  $("badge").textContent = connected ? "Input: SPIKE hub" : "Input: keyboard";
}

// ============================================================================
// Keyboard mode: pretend to be the hub (only active while no hub is connected)
// ============================================================================
const keys = {};
window.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT") return;                // don't steal keys from the slot box
  if (source === "keyboard" && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(e.key)) e.preventDefault();
  keys[e.key] = true;
});
window.addEventListener("keyup", (e) => { keys[e.key] = false; });

setInterval(() => {
  if (source !== "keyboard") return;
  if (keys["ArrowLeft"])  raw.a -= KEY_MOVE_STEP;
  if (keys["ArrowRight"]) raw.a += KEY_MOVE_STEP;
  if (keys["ArrowUp"])    raw.b += KEY_AIM_STEP;
  if (keys["ArrowDown"])  raw.b -= KEY_AIM_STEP;
  raw.f = keys[" "] ? 100 : 0;
}, 30);

// ============================================================================
// Calibration screen
// ============================================================================
// Each button stores the CURRENT raw reading under a name.
document.querySelectorAll("[data-cal]").forEach((btn) => {
  btn.onclick = () => {
    switch (btn.dataset.cal) {
      case "moveMin": cal.moveMin = raw.a; break;
      case "moveMax": cal.moveMax = raw.a; break;
      case "aimMin":  cal.aimMin = raw.b; break;
      case "aimMax":  cal.aimMax = raw.b; break;
      case "fire":    captureFireLevel(btn); return;     // needs a few seconds, see below
    }
    saveCalibration();
    refreshCalibrationScreen();
  };
});

// You can't hold the force sensor AND click the mouse, so: click first, then you
// get FIRE_CAPTURE_SECONDS to press the sensor firmly. We remember the hardest press
// and set the "fire" threshold to half of it.
let fireNote = "";   // message shown instead of the saved level (e.g. "No press detected")
function captureFireLevel(btn) {
  const label = btn.textContent;
  let peak = 0, msLeft = FIRE_CAPTURE_SECONDS * 1000;
  fireNote = "";
  btn.disabled = true;
  const timer = setInterval(() => {
    peak = Math.max(peak, raw.f);
    msLeft -= 50;
    btn.textContent = `PRESS NOW! (${Math.ceil(msLeft / 1000)})`;
    if (msLeft > 0) return;
    clearInterval(timer);
    btn.disabled = false;
    btn.textContent = label;
    if (peak > 0) { cal.fireLevel = Math.max(1, Math.round(peak / 2)); saveCalibration(); }
    else fireNote = "No press detected, try again";
  }, 50);
}
$("resetCal").onclick = () => { cal = { ...DEFAULT_CALIBRATION }; saveCalibration(); refreshCalibrationScreen(); };

function refreshCalibrationScreen() {
  $("liveA").textContent = raw.a;
  $("liveB").textContent = raw.b;
  $("liveF").textContent = raw.f;
  $("savedMove").textContent = `left = ${cal.moveMin}, right = ${cal.moveMax}`;
  $("savedAim").textContent  = `left = ${cal.aimMin}, right = ${cal.aimMax}`;
  $("savedFire").textContent = fireNote || `fire at ${cal.fireLevel} or more`;
  const input = readInputs();                               // preview of what the game receives
  $("barX").value = input.x * 100;
  $("barAim").value = (input.aim + 1) * 50;
  $("outX").textContent = input.x.toFixed(2);
  $("outAim").textContent = input.aim.toFixed(2);
  $("outFire").textContent = input.fire ? "YES!" : "no";
}
setInterval(refreshCalibrationScreen, 50);

// ============================================================================
// Switching screens, starting the game
// ============================================================================
function showScreen(name) {
  document.querySelectorAll("section").forEach((s) => s.classList.toggle("active", s.id === "screen-" + name));
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("active", b.dataset.screen === name));
  $("app").classList.toggle("playing", name === "play");       // CSS: on the Play screen the canvas fills everything
  if (name === "play") {
    Game.start($("game"), (playerIndex) => (playerIndex === 0 ? readInputs() : null));
    wakeMenu();
  } else {
    Game.stop();
    $("app").classList.remove("idle");
  }
}
document.querySelectorAll("nav button").forEach((b) => { b.onclick = () => showScreen(b.dataset.screen); });

// Whenever the play area changes size (window resized, browser full screen, screen rotated),
// tell the game so the canvas fills it again.
new ResizeObserver(() => Game.resize()).observe($("screen-play"));

// On the Play screen the menu bar hides itself after a few seconds without mouse movement.
const MENU_HIDE_SECONDS = 3;
let menuTimer = null;
function wakeMenu() {
  $("app").classList.remove("idle");
  clearTimeout(menuTimer);
  if ($("app").classList.contains("playing")) {
    menuTimer = setTimeout(() => $("app").classList.add("idle"), MENU_HIDE_SECONDS * 1000);
  }
}
for (const eventName of ["mousemove", "mousedown", "touchstart"]) window.addEventListener(eventName, wakeMenu);

// ============================================================================
// Full screen button (the browser asks for a click, so this can't happen automatically)
// ============================================================================
// We fullscreen the whole page (not just the canvas) so the menu bar and Rotate screen keep working.
$("fullBtn").onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch((e) => console.warn("Full screen refused:", e.message));
};
document.addEventListener("fullscreenchange", () => {
  $("fullBtn").innerHTML = document.fullscreenElement ? "Exit full screen &#9974;" : "Full screen &#9974;";
});

// ============================================================================
// Show / hide the on-screen player (remembered in this browser)
// ============================================================================
const SHOW_PLAYER_KEY = "tabletop-arena-show-player";
let showPlayer = true;
try { showPlayer = localStorage.getItem(SHOW_PLAYER_KEY) !== "false"; } catch (e) { /* storage blocked: fine */ }
$("showPlayer").checked = showPlayer;
Game.setShowPlayers(showPlayer);
$("showPlayer").onchange = () => {
  showPlayer = $("showPlayer").checked;
  Game.setShowPlayers(showPlayer);
  try { localStorage.setItem(SHOW_PLAYER_KEY, String(showPlayer)); } catch (e) { /* fine */ }
};

// ============================================================================
// Rotate screen: turns the whole interface 0 / 90 / 180 / 270 degrees (remembered in this browser)
// ============================================================================
const ROTATION_KEY = "tabletop-arena-rotation";
let rotation = 0;
try { rotation = Number(localStorage.getItem(ROTATION_KEY)) || 0; } catch (e) { /* storage blocked: fine */ }

function applyRotation() {
  $("app").classList.remove("rot90", "rot180", "rot270");
  if (rotation) $("app").classList.add("rot" + rotation);
  $("rotateBtn").innerHTML = `Rotate screen &#10227; (${rotation}&deg;)`;
}
$("rotateBtn").onclick = () => {
  rotation = (rotation + 90) % 360;
  try { localStorage.setItem(ROTATION_KEY, String(rotation)); } catch (e) { /* fine */ }
  applyRotation();
};
applyRotation();

// Show live numbers on the game screen too (handy while tuning). Delete if you don't want it.
setInterval(() => {
  const i = readInputs();
  Game.setDebugText(`${source}  raw A=${raw.a} B=${raw.b} F=${raw.f}  ->  x=${i.x.toFixed(2)} aim=${i.aim.toFixed(2)} fire=${i.fire}`);
}, 100);

setSource("keyboard", "Not connected. No hub? You can still try everything with the keyboard (see below).");
