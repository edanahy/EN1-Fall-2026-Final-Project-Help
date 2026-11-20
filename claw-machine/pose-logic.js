// pose-logic.js
// ---------------------------------------------------------------------------
// The "brain": turns body-pose landmarks into simple decisions.
// This file does NOT touch the camera, the screen, or the robot. It only does
// math on points, so it is easy to read and easy to tweak.
//
// Input:  `pts` = a list of 33 body landmarks, already converted to PIXELS in
//         the same (mirrored) picture the user sees. See toPixels() in app.js.
// Output: a small object saying where the person is and what their arms do.
// ---------------------------------------------------------------------------

// ===== SETTINGS YOU CAN TUNE =====

// Screen is split into thirds: left / middle / right.
// (Fractions of the picture width, 0 = left edge, 1 = right edge.)
const LEFT_EDGE = 1 / 3;
const RIGHT_EDGE = 2 / 3;

// Claw uses the ARM ANGLE: how far each arm leans away from "straight up",
// in degrees, averaged over both arms. Leaning OUTWARD is positive.
//     hands crossed / together overhead -> negative angle  -> CLOSE
//     arms straight up (like a "touchdown") -> about 0
//     arms in a wide "V" / "Y"          -> big positive angle -> OPEN
// The gap between the two numbers is on purpose: in between, nothing changes.
// That stops the claw flickering open/closed when your arms are halfway.
const OPEN_ANGLE_DEG = 35; // bigger than this = open
const CLOSE_ANGLE_DEG = 10; // smaller than this = close

// Ignore landmarks the model is not confident about (0 to 1).
const MIN_VISIBILITY = 0.5;

// A new decision must be seen this many frames in a row before we believe it.
// (At ~30 frames per second, 5 frames is about 1/6 of a second.)
const STABLE_FRAMES = 5;

// MediaPipe numbers each body landmark. These are the ones we use.
// "LEFT"/"RIGHT" are the person's own left and right. We only ever use them
// symmetrically, so it does not matter which is which.
const LM = {
  NOSE: 0,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
};

// Is this landmark present and trustworthy?
function isVisible(p) {
  return p !== undefined && p.visibility >= MIN_VISIBILITY;
}

// How far does one arm lean away from straight up, in degrees?
// Positive = leaning outward (away from the body's center), negative = inward.
// `outwardSign` is +1 for the arm on the right of the picture, -1 for the left.
// IMPORTANT: use PIXELS here, not 0-1 fractions. A 0-1 fraction of a wide
// picture is not the same distance horizontally and vertically, so angles
// computed from fractions come out wrong.
function armLeanDeg(shoulder, wrist, outwardSign) {
  const sideways = (wrist.x - shoulder.x) * outwardSign; // + = outward
  const up = shoulder.y - wrist.y; // + = hand is above shoulder (y grows downward)
  return (Math.atan2(sideways, up) * 180) / Math.PI;
}

// Look at one frame's landmarks and describe what the person is doing.
//   pts   - 33 landmarks in pixels (or null/undefined if nobody was found)
//   width - picture width in pixels (to turn pixels into a 0-1 position)
//
// Returns:
//   found        - true if a person with visible head and shoulders was seen
//   centerX      - body position, 0 (left edge) to 1 (right edge), or null
//   zone         - "left" | "middle" | "right"  (what the body position says)
//   handsRaised  - true if BOTH hands are above the nose
//   armAngle     - average outward lean of the two arms in degrees, or null
//   claw         - "open" | "close" | null (null = "no opinion right now")
function analyzePose(pts, width) {
  const result = {
    found: false,
    centerX: null,
    zone: "middle", // no person -> "middle", which means STOP (the safe choice)
    handsRaised: false,
    armAngle: null,
    claw: null,
  };
  if (!pts) return result;

  const nose = pts[LM.NOSE];
  const leftShoulder = pts[LM.LEFT_SHOULDER];
  const rightShoulder = pts[LM.RIGHT_SHOULDER];
  if (!isVisible(nose) || !isVisible(leftShoulder) || !isVisible(rightShoulder)) {
    return result;
  }
  result.found = true;

  // --- 1. Where is the body? ---------------------------------------------
  // We use the midpoint of the shoulders. Shoulders barely move when you
  // raise your arms, so lifting your hands won't accidentally move the robot.
  result.centerX = (leftShoulder.x + rightShoulder.x) / 2 / width;
  if (result.centerX < LEFT_EDGE) result.zone = "left";
  else if (result.centerX > RIGHT_EDGE) result.zone = "right";
  else result.zone = "middle";

  // --- 2. Are both hands above the head? ---------------------------------
  // In a picture, y grows DOWNWARD, so "above" means a SMALLER y.
  const leftWrist = pts[LM.LEFT_WRIST];
  const rightWrist = pts[LM.RIGHT_WRIST];
  if (!isVisible(leftWrist) || !isVisible(rightWrist)) return result;
  result.handsRaised = leftWrist.y < nose.y && rightWrist.y < nose.y;
  if (!result.handsRaised) return result;

  // --- 3. How far apart are the arms? ------------------------------------
  // Measure how far each arm leans from straight up (outward = positive),
  // then average the two arms. Which arm is on which side of the picture is
  // decided by comparing each shoulder to the body center.
  const centerPx = (leftShoulder.x + rightShoulder.x) / 2;
  const leftSign = leftShoulder.x < centerPx ? -1 : 1;
  const rightSign = -leftSign;
  result.armAngle =
    (armLeanDeg(leftShoulder, leftWrist, leftSign) +
      armLeanDeg(rightShoulder, rightWrist, rightSign)) / 2;

  if (result.armAngle > OPEN_ANGLE_DEG) result.claw = "open";
  else if (result.armAngle < CLOSE_ANGLE_DEG) result.claw = "close";
  // else: in the in-between zone, so claw stays null ("keep doing what you were doing")

  return result;
}

// ---------------------------------------------------------------------------
// Debouncer: only accept a new value after seeing it STABLE_FRAMES times in a
// row. Pose detection is a little jittery, and without this the robot would
// stutter whenever you stand near a boundary.
//
// Usage:
//   const move = createDebouncer("stop", STABLE_FRAMES);
//   if (move.update("left")) { /* value just changed; move.value is the new one */ }
//
// update(null) means "no opinion": it never changes the value.
// ---------------------------------------------------------------------------
function createDebouncer(initialValue, framesNeeded) {
  let candidate = null; // the value we are currently "considering"
  let count = 0; // how many frames in a row we have seen it
  const debouncer = {
    value: initialValue,
    update(newValue) {
      if (newValue === null || newValue === debouncer.value) {
        candidate = null;
        count = 0;
        return false;
      }
      if (newValue === candidate) {
        count += 1;
      } else {
        candidate = newValue;
        count = 1;
      }
      if (count >= framesNeeded) {
        debouncer.value = newValue;
        candidate = null;
        count = 0;
        return true; // changed!
      }
      return false;
    },
  };
  return debouncer;
}
