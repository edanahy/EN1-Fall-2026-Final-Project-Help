// app.js
// ---------------------------------------------------------------------------
// Camera + MediaPipe pose detection + drawing + glue to the robot.
//
//   camera --> MediaPipe PoseLandmarker --> pose-logic.js --> robot.js
//                       |
//                       +--> overlay drawn on the canvas
//
// KEY IDEA FOR LINING THINGS UP (the usual headache):
// We do NOT show the <video> element. Every frame we copy the video picture
// onto a <canvas> and draw the skeleton on that SAME canvas. One canvas means
// one coordinate system, so the drawing can never drift away from the video.
// The canvas's internal size is set to the camera's real size (videoWidth x
// videoHeight); CSS then scales the whole canvas up or down as ONE image.
// ---------------------------------------------------------------------------

// ===== SETTINGS YOU CAN TUNE =====
const MIRROR = true; // true = like a mirror (your right hand appears on the right)
const CAMERA_WIDTH = 1280; // what we ask the camera for (it may pick something else)
const CAMERA_HEIGHT = 720;

// Pinned versions so the demo doesn't change under you. The "lite" model is the
// smallest and fastest; "full" and "heavy" are more accurate but slower.
const MEDIAPIPE_VERSION = "1.2.3";
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task";

// ===== PAGE ELEMENTS =====
const video = document.getElementById("cam"); // hidden; only used as a frame source
const canvas = document.getElementById("view");
const ctx = canvas.getContext("2d");
const startButton = document.getElementById("start");
const statusText = document.getElementById("status");
const readout = document.getElementById("readout");

// ===== STATE =====
let poseLandmarker = null;
let lastVideoTime = -1;

// The "confirmed" robot state. A change is only accepted after STABLE_FRAMES
// frames in a row (see createDebouncer in pose-logic.js).
// Moves are named "left" | "stop" | "right". Claw is "open" | "close" | null.
const moveState = createDebouncer("stop", STABLE_FRAMES);
const clawState = createDebouncer(null, STABLE_FRAMES);

// pose-logic.js speaks "left/middle/right"; the robot speaks "left/stop/right".
const ZONE_TO_MOVE = { left: "left", middle: "stop", right: "right" };

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
startButton.addEventListener("click", start);

async function start() {
  startButton.disabled = true;
  try {
    if (typeof Vision === "undefined") {
      throw new Error("MediaPipe did not load. Are you online? Check the <script> tag in index.html.");
    }
    setStatus("Loading pose model (first time can take a few seconds)...");
    poseLandmarker = await createPoseLandmarker();

    setStatus("Starting camera (click Allow if your browser asks)...");
    await startCamera();

    setStatus("Running. Stand back so your head, shoulders and hands are all in view.");
    robotLog("Ready. Waiting for a person...");
    requestAnimationFrame(loop);
  } catch (err) {
    console.error(err);
    setStatus("Error: " + err.message);
    startButton.disabled = false;
  }
}

function setStatus(text) {
  statusText.textContent = text;
}

async function createPoseLandmarker() {
  const fileset = await Vision.FilesetResolver.forVisionTasks(WASM_URL);
  const options = {
    baseOptions: { modelAssetPath: MODEL_URL },
    runningMode: "VIDEO", // we feed it video frames one at a time
    numPoses: 1, // single user
  };
  try {
    // GPU is faster, but not every computer supports it...
    options.baseOptions.delegate = "GPU";
    return await Vision.PoseLandmarker.createFromOptions(fileset, options);
  } catch (err) {
    // ...so fall back to the CPU if the GPU attempt fails.
    console.warn("GPU not available, using CPU instead:", err);
    options.baseOptions.delegate = "CPU";
    return await Vision.PoseLandmarker.createFromOptions(fileset, options);
  }
}

async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("This browser can't access the camera from this page. Try Chrome or Edge.");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: CAMERA_WIDTH }, height: { ideal: CAMERA_HEIGHT }, facingMode: "user" },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();

  // The camera decides its real size, which may not be what we asked for.
  // Size the canvas to match EXACTLY so nothing is stretched or cropped.
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
}

// ---------------------------------------------------------------------------
// Main loop: runs once per screen refresh, but only does work on a NEW frame
// ---------------------------------------------------------------------------
function loop() {
  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;

    // 1. Find the body in this frame. (Timestamp must keep increasing.)
    const result = poseLandmarker.detectForVideo(video, performance.now());
    const rawLandmarks = result.landmarks[0]; // first (only) person, or undefined

    // 2. Convert to pixels in the picture the user sees (mirrored if MIRROR).
    const pts = rawLandmarks ? rawLandmarks.map(toPixels) : null;

    // 3. Decide what the pose means, and send commands if something changed.
    const pose = analyzePose(pts, canvas.width);
    updateRobot(pose);

    // 4. Draw: video first, then the overlay on top of it.
    drawVideoFrame();
    drawZones(moveState.value);
    if (pts) drawSkeleton(pts, pose);
    updateReadout(pose);
  }
  requestAnimationFrame(loop);
}

// MediaPipe gives each landmark as x, y between 0 and 1 (fractions of the
// video's width and height), measured on the ORIGINAL, un-mirrored video.
// Multiply by the canvas size to get pixels; flip x if we are mirroring.
// Drawing AND logic both use this, so they always agree.
function toPixels(landmark) {
  const x = MIRROR ? 1 - landmark.x : landmark.x;
  return {
    x: x * canvas.width,
    y: landmark.y * canvas.height,
    visibility: landmark.visibility,
  };
}

// ---------------------------------------------------------------------------
// Glue: pose -> robot commands (only when the confirmed state changes)
// ---------------------------------------------------------------------------
function updateRobot(pose) {
  // Body position -> movement. No person found means "middle", i.e. STOP.
  if (moveState.update(ZONE_TO_MOVE[pose.zone])) {
    if (moveState.value === "left") robot.moveLeft();
    else if (moveState.value === "right") robot.moveRight();
    else robot.stopMoving();
  }

  // Arm angle -> claw. pose.claw is null unless both hands are up AND clearly
  // wide or together, so the claw keeps its last state otherwise.
  if (clawState.update(pose.claw)) {
    if (clawState.value === "open") robot.openClaw();
    else robot.closeClaw();
  }
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------
function drawVideoFrame() {
  ctx.save();
  if (MIRROR) {
    ctx.translate(canvas.width, 0); // move origin to the right edge...
    ctx.scale(-1, 1); // ...then flip horizontally
  }
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  ctx.restore(); // undo the flip so text and shapes below are NOT mirrored
}

// Three tinted bands: left / middle / right. The active one is brighter.
// Edges come from pose-logic.js, so what you see is exactly what the logic uses.
function drawZones(activeMove) {
  const W = canvas.width;
  const H = canvas.height;
  const zones = [
    { move: "left", label: "< MOVE LEFT", x0: 0, x1: LEFT_EDGE * W, rgb: "255, 90, 90" },
    { move: "stop", label: "STOP", x0: LEFT_EDGE * W, x1: RIGHT_EDGE * W, rgb: "90, 210, 120" },
    { move: "right", label: "MOVE RIGHT >", x0: RIGHT_EDGE * W, x1: W, rgb: "90, 150, 255" },
  ];
  ctx.font = `bold ${Math.round(W / 40)}px sans-serif`;
  ctx.textAlign = "center";
  for (const z of zones) {
    const alpha = z.move === activeMove ? 0.35 : 0.12;
    ctx.fillStyle = `rgba(${z.rgb}, ${alpha})`;
    ctx.fillRect(z.x0, 0, z.x1 - z.x0, H);
    // Black outline + white fill so the label is readable on any background.
    ctx.lineWidth = 4;
    ctx.lineJoin = "round"; // avoids spiky corners on the outlined letters
    ctx.strokeStyle = "black";
    ctx.strokeText(z.label, (z.x0 + z.x1) / 2, H * 0.06);
    ctx.fillStyle = "white";
    ctx.fillText(z.label, (z.x0 + z.x1) / 2, H * 0.06);
  }
  // Divider lines
  ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
  ctx.lineWidth = 2;
  for (const x of [LEFT_EDGE * W, RIGHT_EDGE * W]) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
}

// Head, shoulders, torso, and both arms down to the hands.
function drawSkeleton(pts, pose) {
  const dot = Math.max(4, canvas.width / 120); // marker size scales with picture size
  ctx.lineWidth = Math.max(2, canvas.width / 250);
  ctx.lineCap = "round";

  // Lines: [from, to] pairs of landmark numbers (see LM in pose-logic.js).
  const lines = [
    [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER], // shoulders
    [LM.LEFT_SHOULDER, LM.LEFT_ELBOW], // left arm
    [LM.LEFT_ELBOW, LM.LEFT_WRIST],
    [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW], // right arm
    [LM.RIGHT_ELBOW, LM.RIGHT_WRIST],
    [LM.LEFT_SHOULDER, LM.LEFT_HIP], // torso
    [LM.RIGHT_SHOULDER, LM.RIGHT_HIP],
    [LM.LEFT_HIP, LM.RIGHT_HIP],
  ];
  ctx.strokeStyle = "yellow";
  for (const [a, b] of lines) {
    if (!isVisible(pts[a]) || !isVisible(pts[b])) continue; // skip low-confidence points
    ctx.beginPath();
    ctx.moveTo(pts[a].x, pts[a].y);
    ctx.lineTo(pts[b].x, pts[b].y);
    ctx.stroke();
  }

  // Dots on the joints we care about.
  const joints = [
    LM.NOSE, LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_ELBOW, LM.RIGHT_ELBOW,
    LM.LEFT_WRIST, LM.RIGHT_WRIST, LM.LEFT_HIP, LM.RIGHT_HIP,
  ];
  for (const j of joints) {
    if (!isVisible(pts[j])) continue;
    const isHand = j === LM.LEFT_WRIST || j === LM.RIGHT_WRIST;
    ctx.fillStyle = isHand ? "cyan" : "red";
    ctx.beginPath();
    ctx.arc(pts[j].x, pts[j].y, isHand ? dot * 1.5 : dot, 0, Math.PI * 2);
    ctx.fill();
  }

  // Head circle around the nose. Sized from the shoulder width (a head is
  // roughly 0.35 x shoulder width in radius), which stays steady even when
  // you turn sideways. Change HEAD_RADIUS_RATIO if it looks too big or small.
  const HEAD_RADIUS_RATIO = 0.35;
  const nose = pts[LM.NOSE];
  if (isVisible(nose) && pose.found) {
    const shoulderWidth = Math.hypot(
      pts[LM.LEFT_SHOULDER].x - pts[LM.RIGHT_SHOULDER].x,
      pts[LM.LEFT_SHOULDER].y - pts[LM.RIGHT_SHOULDER].y
    );
    ctx.strokeStyle = "yellow";
    ctx.beginPath();
    ctx.arc(nose.x, nose.y, shoulderWidth * HEAD_RADIUS_RATIO, 0, Math.PI * 2);
    ctx.stroke();
  }

  // The point the zones are judged on: middle of the shoulders (white ring).
  if (pose.found) {
    const cx = (pts[LM.LEFT_SHOULDER].x + pts[LM.RIGHT_SHOULDER].x) / 2;
    const cy = (pts[LM.LEFT_SHOULDER].y + pts[LM.RIGHT_SHOULDER].y) / 2;
    ctx.strokeStyle = "white";
    ctx.lineWidth = Math.max(3, canvas.width / 200);
    ctx.beginPath();
    ctx.arc(cx, cy, dot * 2, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// One line of live numbers under the video, handy for tuning thresholds.
function updateReadout(pose) {
  const where = pose.found ? `${pose.zone} (x = ${pose.centerX.toFixed(2)})` : "no person found";
  const hands = !pose.handsRaised
    ? "down"
    : `UP, arm angle ${pose.armAngle.toFixed(0)} deg`;
  readout.textContent =
    `Body: ${where}  |  Hands: ${hands}  |  ` +
    `Robot move: ${moveState.value}  |  Claw: ${clawState.value || "(not set yet)"}`;
}
