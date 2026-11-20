# tabletop-arena: SPIKE Prime robot as a game controller

## What this demonstrates

A game on a flat screen (a "tabletop") that you control with a LEGO SPIKE Prime robot: slide the robot left/right to move your player, turn a motor to aim, press a force sensor to shoot. It also shows how to **calibrate** the robot's raw numbers so they line up with the screen.

(The student idea is a four-sided tabletop with one player per side. This prototype has one player, on the bottom edge, but the code is already set up for more; see "Where to go next".)

## How it works

```
 SPIKE Prime hub                    Bluetooth                  Chrome / Edge
 hub_stream.py   ---- print("<S,120,-35,0>") ---->  app.js  ->  calibration  ->  game.js
 motor A (move), motor B (aim),                     reads the text, pulls out    moves the player,
 force sensor C (fire)                              the 3 numbers                aims, shoots
```

1. [hub_stream.py](hub_stream.py) runs on the hub and prints `<S,A,B,F>` about 20 times a second (motor A degrees, motor B degrees, force 0-100).
2. The web page connects over Bluetooth ([spikeble.js](spikeble.js) handles the protocol) and receives that printed text.
3. [app.js](app.js) extracts the three numbers (the `PACKET_RE` pattern), then uses the **calibration** to turn them into: position `0..1`, aim `-1..1`, fire `true/false`.
4. [game.js](game.js) only sees those three clean values, so it works the same with a robot or the keyboard.

**Architecture rung 1** (pure browser). Everything is in the folder; no server, no install, no Python on the computer. (Web Bluetooth needs Chrome/Edge. If connecting from a double-clicked file is refused, see Troubleshooting.)

## What you need

- LEGO SPIKE Prime hub (SPIKE App 3 firmware) with: a motor on **port A** (left/right), a motor on **port B** (turret angle), a force sensor on **port C** (fire).
- The SPIKE App, once, to put `hub_stream.py` on the hub.
- Chrome, Edge, or another Chromium browser. No accounts or keys.
- **No hub yet?** The page has a keyboard mode (below), so you can run and read everything first.

## How to run it

**Try it without a hub:** open `index.html` (double-click). Go to **3. Play**. Use **← →** to move, **↑ ↓** to aim, **Space** to shoot. You can also try **2. Calibrate** the same way.

**With the hub:**

1. In the SPIKE App, create a Python program and paste in [hub_stream.py](hub_stream.py). Run it once to check it (the console shows lines like `<S,0,0,0>`), then note which slot it is in. **Close the SPIKE App** (the hub talks to one thing at a time).
2. Open `index.html` in Chrome/Edge. On **1. Connect**, click **Connect to hub** and choose your hub.
3. Click **Start program** (slot number as in the SPIKE App), or press the hub's button. The status line shows the last text received.
4. Go to **2. Calibrate**. The "Live raw value" numbers should move as you move the robot. Then:
   - move the robot to the far left of your table, click **Robot at far LEFT**; far right, click **Robot at far RIGHT**;
   - turn the turret fully left/right and click the two aim buttons;
   - click **Set "pressed" level**, then press the force sensor firmly within 3 seconds.
   The "What the game will see" bars show the result; they should sweep fully as you move.
5. Go to **3. Play**. The game fills the whole browser window. Click **Full screen** (top right) to hide the browser's tabs and address bar too; Esc leaves it. The menu bar fades out after 3 seconds without mouse movement; move the mouse to bring it back.
6. If the robot itself is the turret, untick **Show the on-screen player** at the bottom of the Calibrate screen (shots still fly from the same spot; tick it again to bring the character back).
7. If the monitor is upside down, or you are viewing from another side of the table, click **Rotate screen** (top right) until it looks right. It turns the whole interface, including the game, and is remembered.

If a direction is backwards, just calibrate "LEFT" and "RIGHT" the other way round; nothing else to change.

## What to look at

- [hub_stream.py](hub_stream.py): the whole hub side, about 15 lines of real code.
- [app.js](app.js): `PACKET_RE` (parsing the hub's text; `spikeble.js` 1.1+ also has `hub.onReading()` that does this buffering for you), `fraction()` and `readInputs()` (calibration math, the heart of the project), `DEFAULT_CALIBRATION`.
- [game.js](game.js): `update()` (the rules) and the settings at the top. Its only input is `getInputs(playerIndex)`.
- [index.html](index.html) / [app.js](app.js): the `#app` wrapper and `applyRotation()` implement **Rotate screen** (a CSS rotation of the whole interface).
- [spikeble.js](spikeble.js): the Bluetooth protocol. Copied from the `web-bt` project; read `web-bt/PROTOCOL.md` if you want to know how it works.

## Where to go next

- **More players:** add entries to `players` in `game.js` (`side` 1 = left, 2 = top, 3 = right; drawing and shooting already rotate for each side) and give `getInputs(i)` an answer for them. Each extra player needs its own hub; calibrate each hub separately. (Connecting several hubs is a good next step; `spikeble.js` creates one `SpikeHub` object per hub.)
- Make asteroids dangerous: lives, game over, a restart button.
- Replace the white-line drawing with real art, sounds, a theme.
- Use the hub's light matrix or sounds for feedback (hub-side change).
- Skip `hub_stream.py` entirely: the hub can push motor and force-sensor readings by itself (see `web-bt`, "Device notifications").

## Left out on purpose / limitations

- One player only; no lives, no game over, no sound, deliberately plain graphics. The arena stretches to fill whatever shape the window is (the game is always 1000 units tall; the width follows the screen).
- Tested end to end with a real hub by the instructor (connect, streaming, calibration, play). The framing code was also tested against LEGO's published test vectors, and the page in Chrome with simulated hub messages (including text split across messages).
- `hub_stream.py` does not reset the motor positions, so calibration should survive restarting the program (not specifically tested; re-calibrate after a hub power cycle or if the numbers jump).
- Calibration is saved in this browser only (`localStorage`).
- Hub API used (checked against the SPIKE 3 Python docs): `motor.relative_position(port)`, `force_sensor.force(port)` (0-100 decinewtons), `runloop.run`, `runloop.sleep_ms`. The `runloop` details were the least confirmed.

## Troubleshooting

- **Nothing happens when you click Connect, or a security error appears:** you probably opened the file by double-click and Chrome refused Bluetooth there. In this folder run `python3 -m http.server` (Mac) / `python -m http.server` (Windows) and open `http://localhost:8000`.
- **Hub isn't in the list:** hub on, SPIKE App closed, nothing else connected to it.
- **Connected but the numbers don't move:** the program isn't running. Click **Start program** (right slot number) or press the hub's button. The "Last text from hub" line shows what arrived; it should look like `<S,0,0,0>`.
- **Moving the robot barely moves the player:** calibrate again; the "left" and "right" readings were probably too close together.
- **"Last text from hub" looks blank or stuck:** the hub sends each `print()` as the text plus a separate empty line; the page ignores the empty ones, so you should see the latest `<S,...>` reading.
