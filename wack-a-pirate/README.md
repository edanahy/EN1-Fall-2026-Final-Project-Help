# Wack-a-Pirate (two SPIKE Prime hubs talking over Bluetooth)

## 1. What this demonstrates

A "whack-a-mole" game split across **two hubs**. The **wack hub** pops color sensors up one at a time and notices when one is wacked with something red. Every hit is broadcast over Bluetooth, and the **ship hub** hears it and drives a little ship forward.

The pirate theme, graphics, and scoring are yours to add. This is just the working skeleton.

## 2. How it works

```
 WACK HUB (wack.py)                                   SHIP HUB (ship.py)
 ┌─────────────────────────┐                          ┌──────────────────────┐
 │ motor A + color sensor D│  pop up, wait for RED    │                      │
 │ motor B + color sensor E│  ───────────────┐        │  listens for hits    │
 │ motor C + color sensor F│                 ▼        │         │            │
 └─────────────────────────┘     Beacon.broadcast()   │         ▼            │
                                 (hit number, mole,   │  motor A drives the  │
                                  seconds)  ~~~~~~~~► │  ship forward        │
                                      Bluetooth       └──────────────────────┘
                                                          Scanner.listen()
```

**Architecture rung 4:** standalone code that runs on the hubs themselves. There is no web page, server, or extra install on the computer, other than a tool to copy files onto the hubs and start them.

**Why spikecomm Beacon mode?** A Beacon is a one-way broadcast with no pairing, so it is the simplest way for one hub to tell another "something happened". One catch: a Beacon repeats its *latest* message about 10 times per second, so the ship would see the same hit over and over. That is why every message starts with a **hit number that goes up by one each time**. The ship only moves when the number goes up.

**The message** (what `wack.py` sends and `ship.py` receives) is a list of three numbers:

| Position | Meaning | Example |
|---|---|---|
| `[0]` | Hit number (1, 2, 3, ...). `0` means "game just started, no hits yet" | `3` |
| `[1]` | Which mole was wacked (0, 1, or 2) | `1` |
| `[2]` | Seconds from "popped up" until "wacked" | `1.25` |

On the air it looks like `!W3;1;1.25`. spikecomm packs and unpacks it for you.

**The game loop in `wack.py`** (one mole at a time, so there is no tricky "do several things at once" code):
pick a random mole → pop it up → wait for red (up to 5 seconds) → if wacked, broadcast → pop it down → short random rest → repeat.

## 3. What you need

- **Two LEGO SPIKE Prime hubs** (SPIKE App 3 firmware), both with **`spikecomm` installed** (`import spikecomm` must work on each).
- **Wack hub:** 3 motors and 3 color sensors, with each color sensor mounted on a motor so the motor can raise and lower it. Motors in ports **A, B, C**, color sensors in ports **D, E, F** (A↔D, B↔E, C↔F). You can change this in the `MOLES` list at the top of `wack.py`.
- **Ship hub:** one motor in port **A** driving a ship (wheels or a belt).
- Something **red** to wack with (a red LEGO piece, red paper on a stick...).
- A computer with Python 3 and `mpremote` (`pip install mpremote`) and USB cables.

**Installing spikecomm on a hub** (skip if already done): close the SPIKE App, plug in one hub, then
`mpremote cp spikecomm.py :spikecomm.py`. The file is in this folder. Repeat for the other hub. Full details are in the [spikecomm README](https://github.com/edanahy/spikecomm).

## 4. How to run it

> ### ⚠ Start these programs from the REPL, NOT the SPIKE App's Run button
> spikecomm can't use Bluetooth in programs that the hub starts itself (the app's Run button or the hub's program menu). You will get `ImportError: spikecomm can't use Bluetooth in a program started from a program slot...`. Use `mpremote run` as shown below.

1. **Set up the wack hub:** push all three color sensors **down** (resting position). Whatever position each motor is in when the program starts counts as "down".
2. Close the SPIKE App. Plug **both** hubs into the computer and turn them on.
3. Find each hub's USB port:
   ```
   mpremote connect list
   ```
   | | macOS / Linux | Windows |
   |---|---|---|
   | Port looks like | `/dev/cu.usbmodem1234` | `COM5` |
4. Open **two terminal windows** (one per hub), `cd` into this `wack-a-pirate` folder in each, and run:

   | | Terminal 1 (wack hub) | Terminal 2 (ship hub) |
   |---|---|---|
   | macOS / Linux | `mpremote connect /dev/cu.usbmodemAAAA run wack.py` | `mpremote connect /dev/cu.usbmodemBBBB run ship.py` |
   | Windows | `mpremote connect COM5 run wack.py` | `mpremote connect COM6 run ship.py` |

   (Use your own port names from step 3. If only one hub is plugged in, you can leave out `connect ...`.)
5. Sensors start popping up. Wack one with the red object: the wack hub prints the hit, the ship hub prints it too and the ship drives forward.
6. To stop: click in a terminal and press **Ctrl-C**. When you're done with a hub, press **Ctrl-D** at its `>>>` prompt (or restart it) so the SPIKE App works normally again.

The two hubs can be started in either order.

## 5. What to look at

- **`wack.py`, the `MOLES` list and settings at the top:** ports, how far to pop up, speed, timeout. Most changes happen here.
- **`wack.py`, bottom loop:** the whole game in about 15 lines. Note `beacon.broadcast(hits, mole, seconds)`: *this one line is the "sending" half of spikecomm*.
- **`wack.py`, `move_to()`:** how we raise and lower a motor to an angle.
- **`ship.py`, `on_message()` and `scanner.listen(...)`:** the "receiving" half. The function is called automatically whenever a broadcast is heard.
- **`ship.py`, bottom loop:** how the ship decides a hit is *new* (the hit number went up).

## 6. Where to go next (make it yours)

- Make the ship go **farther for a faster wack**: `latest["seconds"]` is already there, so use it to change how far the ship turns.
- Add **sounds** (`from hub import sound`) or lights for hits and misses.
- Make moles **pop up for shorter times** as the game goes on, or pop up **more than one at once**.
- Count **misses** and have the ship drift backwards, or show a score on the ship hub.
- Add a **finish line**: stop after N hits and play a victory sound.
- Use **different colors** for different results (for example blue sticks are "bad pirates" and the ship goes backwards). Colors are `color.RED`, `color.BLUE`, etc. in `import color`.
- Make the ship **turn** by adding a second motor and using the `mole` number.

## 7. Left out on purpose / limitations

- **Beacon = latest value only.** If two hits arrived within a tenth of a second, the ship would see just one. A mole round takes over a second, so this doesn't happen here. If you need *every* message to arrive, use spikecomm's Direct mode (`Peripheral`/`Central`).
- No score keeping, game-over, difficulty levels, or sounds.
- Only one mole is up at a time.
- A mole that isn't wacked within `WACK_TIMEOUT_SECONDS` just goes back down (nothing is sent).
- No theme, no graphics.
- **Classroom note:** the Beacon `PREFIX` (`"!W"`) is the "channel". If several groups run this in the same room, they would hear each other's ships! Each group should pick a different prefix (in **both** files), like `"!K"`, `"!M"`. Don't pick two where one starts with the other (like `"!S"` and `"!S1"`).

**Test status:** **Tested on two real SPIKE Prime hubs** (wack hub and ship hub): the sensors pop up, wacks are detected, hits are broadcast, and the ship moves forward once per hit. Your build may differ (motor directions, how well your sensor sees your red stick), so see Troubleshooting if something is off.

## 8. Troubleshooting

- **`ImportError: spikecomm can't use Bluetooth...`**: you started the program with the SPIKE App's Run button. Use `mpremote run` (step 4).
- **`ImportError: no module named 'spikecomm'`**: spikecomm isn't on that hub. Install it (section 3).
- **Sensors pop the wrong way, or the ship drives backwards:** set `UP_DIRECTION = -1` in `wack.py` / `FORWARD_DIRECTION = -1` in `ship.py`.
- **A wack isn't noticed:** check what the sensor actually sees. On the wack hub's REPL, hold your red object in front of the sensor and type
  ```python
  import color_sensor; from hub import port; color_sensor.color(port.D)
  ```
  Red should print `9`. Try a more saturated red, hold it close, or reduce bright lights shining on the sensor.
- **The ship never moves:** make sure `PREFIX` is identical in both files, that both programs print their "ready" message, and that you started them with `mpremote run`. To see what spikecomm is doing, change `Beacon(PREFIX)` to `Beacon(PREFIX, verbose=True)` and `Scanner(PREFIX)` to `Scanner(PREFIX, verbose=True)`.
- **`mpremote` can't connect / port busy:** close the SPIKE App and any other serial programs. On Windows PowerShell, if `mpremote` isn't found, try `python -m mpremote ...`.
