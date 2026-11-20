// robot.js
// ---------------------------------------------------------------------------
// The "robot" side of the demo. RIGHT NOW these are fake: each function just
// prints a line to the on-page console (and the browser's developer console).
//
// >>> THIS IS THE FILE YOU WILL CHANGE LATER. <<<
// The rest of the program only ever calls these five functions. When you are
// ready to connect a real robot (for example a LEGO SPIKE hub over Bluetooth),
// replace the robotLog(...) line in each function with code that sends the
// command. Nothing else in the project needs to change.
// ---------------------------------------------------------------------------

const MAX_CONSOLE_LINES = 200; // keep the on-page console from growing forever

// Print a timestamped line into the <pre id="console"> box on the page.
function robotLog(message) {
  const time = new Date().toLocaleTimeString();
  const line = `[${time}] ${message}`;
  console.log(line); // also show in the browser's developer console

  const box = document.getElementById("console");
  if (!box) return;
  box.textContent += line + "\n";

  // Trim old lines, then scroll to the newest one.
  const lines = box.textContent.split("\n");
  if (lines.length > MAX_CONSOLE_LINES) {
    box.textContent = lines.slice(lines.length - MAX_CONSOLE_LINES).join("\n");
  }
  box.scrollTop = box.scrollHeight;
}

const robot = {
  moveLeft() {
    robotLog("ROBOT: move left");
  },
  moveRight() {
    robotLog("ROBOT: move right");
  },
  stopMoving() {
    robotLog("ROBOT: stop moving");
  },
  openClaw() {
    robotLog("ROBOT: open claw");
  },
  closeClaw() {
    robotLog("ROBOT: close claw");
  },
};
