# ===== wack.py: the "WACK" hub =====
# This hub has 3 motors, each with a color sensor mounted on it.
#
# The game, one "mole" at a time:
#   1. Pick a random mole and pop its color sensor UP.
#   2. Wait for the color sensor to see RED (someone wacked it with a red stick).
#   3. If it was wacked: broadcast the hit over Bluetooth with spikecomm.
#   4. Pop the sensor back DOWN, rest a moment, and go again.
#
# IMPORTANT: start this program from the hub's REPL (for example with
# `mpremote run wack.py`), NOT with the SPIKE App's Run button.
# spikecomm cannot use Bluetooth in programs started by the app. See README.md.

from spikecomm import Beacon
from hub import port, light_matrix
import motor
import color_sensor
import color
import random
import time

# ---------- Settings: change these to fit YOUR build ----------

# One entry per mole: (motor port, color sensor port).
# The mole's number is its place in this list, starting at 0.
MOLES = [
    (port.A, port.D),   # mole 0
    (port.B, port.E),   # mole 1
    (port.C, port.F),   # mole 2
]

UP_DEGREES = 180        # how far a motor turns to pop the sensor up
UP_DIRECTION = 1        # use -1 if the sensors pop up the wrong way
MOVE_SPEED = 500        # motor speed in degrees per second (small motors max out at 660)

WACK_TIMEOUT_SECONDS = 5    # a mole that isn't wacked in this long goes back down
PAUSE_MIN_MS = 500          # rest between moles: a random time between these two
PAUSE_MAX_MS = 1500

PREFIX = "!W"           # the "channel" name for our broadcasts.
                        # ship.py MUST use the same one. If other groups are in
                        # the room, each group should pick a different one (like "!K").

# ---------- Setup ----------

# "Down" is wherever each motor is when this program starts, so start
# the program with all three sensors pushed DOWN.
down_position = []
for motor_port, sensor_port in MOLES:
    down_position.append(motor.relative_position(motor_port))

beacon = Beacon(PREFIX)


# ---------- Helper functions ----------

def move_to(mole, target):
    """Turn a mole's motor to the angle `target` and wait until it gets there."""
    motor_port, sensor_port = MOLES[mole]
    degrees = target - motor.relative_position(motor_port)
    # run_for_degrees starts the motor and returns right away,
    # so we sleep long enough for the move to finish.
    # HOLD makes the motor resist being pushed after it stops.
    motor.run_for_degrees(motor_port, degrees, MOVE_SPEED, stop=motor.HOLD)
    time.sleep_ms(abs(degrees) * 1000 // MOVE_SPEED + 150)


def pop_up(mole):
    move_to(mole, down_position[mole] + UP_DIRECTION * UP_DEGREES)


def pop_down(mole):
    move_to(mole, down_position[mole])


def wait_for_wack(mole):
    """Wait for the mole's color sensor to see red.

    Returns how many seconds it took, or None if nobody wacked it in time."""
    motor_port, sensor_port = MOLES[mole]
    start = time.ticks_ms()
    while time.ticks_diff(time.ticks_ms(), start) < WACK_TIMEOUT_SECONDS * 1000:
        if color_sensor.color(sensor_port) == color.RED:
            return time.ticks_diff(time.ticks_ms(), start) / 1000
        time.sleep_ms(10)
    return None


# ---------- Main program ----------

hits = 0

# Tell the ship we're starting with 0 hits.
# The message is three numbers: (hit number, which mole, seconds it took)
beacon.broadcast(0, 0, 0)
light_matrix.write("0")
print("Wack hub ready. Wack the sensors that pop up with something RED!")

while True:
    mole = random.randint(0, len(MOLES) - 1)    # pick a random mole: 0, 1, or 2
    pop_up(mole)

    seconds = wait_for_wack(mole)               # a number, or None if it timed out

    if seconds is not None:
        hits = hits + 1
        # The message is (hit number, which mole, seconds it took), for example (3, 1, 1.25).
        # The hit number goes up by one every time, so the ship can tell a NEW
        # hit from the same message being repeated (beacons repeat ~10 times a second).
        beacon.broadcast(hits, mole, seconds)
        light_matrix.write(str(hits))
        print("Hit", hits, "- mole", mole, "wacked after", seconds, "seconds")
    else:
        print("Mole", mole, "was not wacked, going back down")

    pop_down(mole)
    time.sleep_ms(random.randint(PAUSE_MIN_MS, PAUSE_MAX_MS))
