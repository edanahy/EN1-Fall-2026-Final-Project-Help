# Hub-side Python (SPIKE App 3 / MicroPython): what to run on the hub

The Bluetooth page ([PROTOCOL.md](PROTOCOL.md)) is only half of a SPIKE-to-web project. This is the other half: the **program that runs on the hub**. It lists the calls that are proven to work, and the ones that are only taken from the docs.

- Reference docs (a copy of LEGO's SPIKE 3 Python docs): <https://github.com/tuftsceeo/SPIKEPythonDocs/blob/main/SPIKE3.html> (a very large page).
- Do **not** use the old SPIKE 2 / `spike` / `mindstorms` API.
- Status labels: **Confirmed** = ran on a real hub (firmware 1.8.149, 2026-11-20, in `tabletop-arena/hub_stream.py`). **Docs** = from the SPIKE 3 docs, not run by us.

## Skeleton (confirmed)

```python
import runloop
import motor
import force_sensor
from hub import port

async def main():
    while True:
        a = motor.relative_position(port.A)      # degrees, int
        f = force_sensor.force(port.C)           # 0..100
        print("<S,{},{}>".format(a, f))          # one clearly marked reading per line
        await runloop.sleep_ms(50)               # wait without freezing the hub

runloop.run(main())
```

- Everything the hub program prints reaches the web page as console text (see PROTOCOL.md). Keep each reading **short, delimited and on its own `print()`** (here `<S,...>`), and about every 50 ms (20 per second worked well). A console message holds at most 256 bytes.
- Use `"...".format(...)`. It is safe on this MicroPython.
- Ports are `port.A` to `port.F` (the numbers 0 to 5).

## Calls by module

### motor
| Call | Status | Notes |
|---|---|---|
| `motor.relative_position(port)` | **Confirmed** | cumulative degrees, can be negative and large; counts from the hub's last reset (whether it survives a program restart was not tested) |
| `motor.absolute_position(port)` | Docs | `int`; the motor's own absolute angle (the Bluetooth device record says −180..179°) |
| `motor.reset_relative_position(port, position)` | Docs | the docs describe it as setting the offset used by `run_to_relative_position`; **not verified** that it zeroes `relative_position()`, so test before relying on it |
| `motor.run(port, velocity)` | Docs | velocity in degrees/second (limits: small ±660, medium ±1110, large ±1050); optional `acceleration=` |
| `await motor.run_for_degrees(port, degrees, velocity)` | Docs | awaitable; optional `stop=`, `acceleration=`, `deceleration=` |
| `await motor.run_for_time(port, duration_ms, velocity)` | Docs | awaitable |
| `await motor.run_to_absolute_position(...)`, `await motor.run_to_relative_position(...)` | Docs | awaitable; there is no `run_to_position` |
| `motor.COAST` `BRAKE` `HOLD` `CONTINUE` `SMART_COAST` `SMART_BRAKE` | Docs | values 0 to 5, for the `stop=` argument |

### force_sensor
| Call | Status | Notes |
|---|---|---|
| `force_sensor.force(port)` | **Confirmed** | 0 to 100 (decinewtons per the docs, so 0 to 10 N) |
| `force_sensor.pressed(port)` | Docs | `bool` |
| `force_sensor.raw(port)` | Docs | uncalibrated value, range not documented |

### runloop / time
| Call | Status | Notes |
|---|---|---|
| `runloop.run(main())` | **Confirmed** | `main` is `async def` |
| `await runloop.sleep_ms(ms)` | **Confirmed** | non-blocking wait |
| `time.sleep_ms(ms)` | Docs | blocks the whole program; prefer `runloop.sleep_ms` |

### Others (from the docs; not run by us)
- `from hub import light_matrix`: `light_matrix.write(text)` (awaitable, scrolls), `light_matrix.show_image(n)` (1 to 67, e.g. `light_matrix.IMAGE_HAPPY`), `light_matrix.clear()`, `light_matrix.set_pixel(x, y, intensity)` (x, y 0 to 4), `light_matrix.show(pixels)` (25 values).
- `from hub import button`: `button.pressed(button.LEFT)` / `button.RIGHT` returns an int (time held in ms; 0 if not pressed).
- `from hub import light` and `import color`: `light.color(light.POWER, color.RED)`. Colors: BLACK 0 … RED 9, WHITE 10, UNKNOWN −1.
- `import color_sensor`, `import distance_sensor`, `import motion_sensor`, `import motor_pair`, `from hub import sound`: they exist in SPIKE 3; look up exact signatures in the reference docs before using them. (For *reading* these sensors from the web page with no hub program at all, use device notifications: PROTOCOL.md section 4.)

## Running the program
- From the SPIKE App: put it in a slot, run it. Or from the web page: **Start program in slot**, or **Upload to slot & run** (PROTOCOL.md section 5).
- Close the SPIKE App before connecting the web page (the hub talks to one at a time).
- `spikecomm` programs are different: they must start from the REPL, see AGENTS.md.
