# ===== ship.py: the "SHIP" hub =====
# This hub listens for hits broadcast by wack.py. A single motor (port A)
# drives the ship, and every time a NEW hit arrives the ship moves forward.
#
# IMPORTANT: start this program from the hub's REPL (for example with
# `mpremote run ship.py`), NOT with the SPIKE App's Run button.
# spikecomm cannot use Bluetooth in programs started by the app. See README.md.

from spikecomm import Scanner
from hub import port, light_matrix
import motor
import time

# ---------- Settings: change these to fit YOUR build ----------

PREFIX = "!W"           # MUST match PREFIX in wack.py

SHIP_MOTOR = port.A     # the port the ship's motor is plugged into
FORWARD_DEGREES = 360   # how far the motor turns for each hit (360 = one full turn)
FORWARD_DIRECTION = 1   # use -1 if the ship drives backwards
SHIP_SPEED = 500        # motor speed in degrees per second

# ---------- Listening for hits ----------

# The latest message from wack.py. The listener below fills this in.
latest = {"hits": None, "mole": None, "seconds": None}


def on_message(values):
    # Called by spikecomm every time a broadcast is heard (about 10 times a second).
    # Keep this short: just save the numbers. The main loop below does the real work.
    # values looks like [3, 1, 1.25] = [hit number, which mole, seconds it took]
    if len(values) == 3:
        latest["hits"] = values[0]
        latest["mole"] = values[1]
        latest["seconds"] = values[2]


scanner = Scanner(PREFIX)
scanner.listen(on_message)


# ---------- Moving the ship ----------

def sail_forward():
    # run_for_degrees starts the motor and returns right away,
    # so we sleep long enough for the move to finish.
    motor.run_for_degrees(SHIP_MOTOR, FORWARD_DIRECTION * FORWARD_DEGREES, SHIP_SPEED)
    time.sleep_ms(FORWARD_DEGREES * 1000 // SHIP_SPEED + 150)


# ---------- Main program ----------

print("Ship hub ready. Waiting for the wack hub ...")

# The hit number we have already dealt with. None = haven't heard anything yet.
seen_hits = None

while True:
    hits = latest["hits"]

    if hits is not None and hits != seen_hits:
        # Something changed since we last looked.
        # Move only if the hit number went UP. The very first message we hear
        # (seen_hits is None) is just "catching up", and if the wack hub is
        # restarted its number goes back to 0, which is not a hit either.
        if seen_hits is not None and hits > seen_hits:
            print("Hit", hits, "- mole", latest["mole"], "after", latest["seconds"], "seconds. Sailing!")
            light_matrix.write(str(hits))
            sail_forward()
        seen_hits = hits

    time.sleep_ms(50)
