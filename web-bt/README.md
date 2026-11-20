# web-bt: connect a web page to a SPIKE Prime hub over Bluetooth

> **For LLMs / coding assistants building a SPIKE-to-web project:** read [PROTOCOL.md](PROTOCOL.md) (the Bluetooth protocol, with byte layouts, test vectors and what has been verified on hardware) and [HUB_API.md](HUB_API.md) (the SPIKE 3 Python calls for the hub-side program), and copy [spikeble.js](spikeble.js) into the project. You should not need to fetch LEGO's `spike-prime-docs` site. Each project folder in this repo is self-contained, so *copy* the file rather than linking to it (check `SpikeBLE.VERSION` to see which copy is newest). Need hub-to-hub messaging, or the page must *send* data into the hub program? See the comparison with `spikecomm` in PROTOCOL.md section 6.

## What this demonstrates

A web page that connects to a LEGO SPIKE Prime hub with Bluetooth (Web Bluetooth) and shows, live: the text the hub's Python program `print()`s, the hub's own sensor/motor/battery readings, and buttons to start, stop, or upload a program.

## How it works

```
 SPIKE Prime hub  <--- Bluetooth LE --->  Chrome/Edge  ---  index.html + spikeble.js
 (runs your .py)                          (Web Bluetooth)    (frames, parses, shows data)
```

- **Architecture rung 1:** pure browser. No server, no install, no Python on the computer. Double-clicking `index.html` (`file://`) works in Chrome (tested with a real hub). If some setup refuses to connect from a file, run `python3 -m http.server` (Mac) / `python -m http.server` (Windows) in this folder and open `http://localhost:8000`.
- [spikeble.js](spikeble.js) is the reusable part (one file, no dependencies): Bluetooth connection, the message framing, and parsers. [index.html](index.html) is a small demo that uses it.
- Two ways to get data, both shown in the demo:
  1. **Console output:** a program on the hub does `print(...)`, the page receives the text.
  2. **Device notifications:** the hub itself pushes motor/force/color/distance/battery/tilt data. No program needed.

## What you need

- A LEGO Education SPIKE Prime hub (SPIKE App 3 firmware), turned on.
- Chrome, Edge, or another Chromium browser (not Safari or Firefox), on a computer with Bluetooth.
- **Close the SPIKE App** first (the hub talks to one thing at a time).
- No accounts, no keys.

## How to run it

1. Open `index.html` (double-click it, or serve the folder as described above).
2. Click **Connect to hub**, choose your hub in the browser's picker.
3. Try each section:
   - **Live device data:** plug a motor into a port, click **Start**, turn the motor.
   - **Console output:** put a program that prints into a slot with the SPIKE App (re-open the page after closing the App), enter the slot number, click **Start program in slot**. Or use **Upload to slot & run**.
   - Unplug and replug a sensor: its row disappears after a moment and comes back when it reports again.

## What to look at

- [spikeble.js](spikeble.js): section 4 (`SpikeHub`) is what you call from your page: `hub.on("console", ...)`, `hub.on("device", ...)`, `hub.startProgram(slot)`.
- [index.html](index.html): the `<script>` at the bottom is the whole integration in about 40 lines.
- [PROTOCOL.md](PROTOCOL.md): everything about *how* it works, plus what is verified and what is not.

## Where to go next

- Print numbers from your hub program in a format you can parse (for example `<S,12,-3,0>`) and chart them. `spikeble.js` does the text buffering for you:

  ```js
  hub.onReading(/<S,(-?\d+),(-?\d+),(-?\d+)>/, ([a, b, c]) => { /* use the numbers */ });
  ```

  See `tabletop-arena` for a complete example that turns printed numbers into game controls, and [HUB_API.md](HUB_API.md) for the hub side.
- Use the `"device"` event for ready-made readings (no hub program required), for example a motor's `position` to drive an on-screen slider.
- Send data **to** the hub program: not covered here (the docs describe a generic `TunnelMessage`, but its use is undocumented). If you need that today, look at `spikecomm` (PROTOCOL.md section 6).
- Connect two or more hubs: create one `new SpikeBLE.SpikeHub()` per hub (untested).

## Left out on purpose / limitations

- Tested on a real hub (firmware 1.8.149): connecting, `print()` output, live device data, program start/stop/upload. Not tried: renaming the hub, `TunnelMessage`, more than one hub at a time. See the verification table in [PROTOCOL.md](PROTOCOL.md).
- No reconnect logic, no multi-hub, no firmware update, no hub renaming UI.

## Troubleshooting

- **"Web Bluetooth is not available":** use Chrome or Edge, not Safari/Firefox.
- **The hub doesn't appear in the picker:** the hub must be on, the SPIKE App closed, and nothing else connected to it.
- **Connect button does nothing / a security error appears:** serve the folder with `python3 -m http.server` (Mac) / `python -m http.server` (Windows) and use `http://localhost:8000`. (`file://` worked in Chrome when tested.)
- **Connected but no console text:** the program has to be *running* on the hub. Use "Start program in slot" or the hub's button, and check the raw box for whatever did arrive.
