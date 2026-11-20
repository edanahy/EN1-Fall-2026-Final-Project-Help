# hub_stream.py  --  runs ON the LEGO SPIKE Prime hub (SPIKE App 3 / MicroPython).
#
# Job: read two motors and one force sensor, over and over, and print() the
# numbers. The web page connects over Bluetooth and reads that printed text.
#
# Wiring (change the three lines below if yours is different):
#   Port A : motor that tracks LEFT/RIGHT movement of the robot
#   Port B : motor that sets the ANGLE of the turret
#   Port C : force sensor used as the FIRE button
#
# What gets printed (about 20 times a second), one line like:
#       <S,120,-35,0>
#   "<S," = start marker, then three whole numbers separated by commas, then ">"
#     1st number = port A motor position, in degrees (can be negative or large)
#     2nd number = port B motor position, in degrees
#     3rd number = port C force, 0 (not pressed) to 100 (pressed hard), in decinewtons
# The < > marks let the web page find a complete reading even if Bluetooth
# splits the text into pieces. If you change the format here, change the
# matching pattern (PACKET_RE) in app.js too.
#
# To run: download this file into a program slot with the SPIKE App (any slot,
# remember the number), then start it from the hub's button or from the web page.

import runloop
import motor
import force_sensor
from hub import port

# ---- Settings you can change ------------------------------------------------
HORIZONTAL_MOTOR = port.A   # moves the player left/right
TURRET_MOTOR = port.B       # aims the shooter
FIRE_SENSOR = port.C        # press to shoot
INTERVAL_MS = 50            # wait between readings (50 ms = 20 readings per second)
# -----------------------------------------------------------------------------

# NOTE: we do NOT reset the motor positions to 0 here on purpose. That way, if
# you restart this program, the numbers keep their old meaning and the
# calibration you did in the web page is still valid.


async def main():
    while True:
        horizontal = motor.relative_position(HORIZONTAL_MOTOR)
        turret = motor.relative_position(TURRET_MOTOR)
        force = force_sensor.force(FIRE_SENSOR)
        print("<S,{},{},{}>".format(horizontal, turret, force))
        await runloop.sleep_ms(INTERVAL_MS)


runloop.run(main())
