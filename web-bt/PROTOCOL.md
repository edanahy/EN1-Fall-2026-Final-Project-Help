# SPIKE Prime Bluetooth protocol (SPIKE App 3 hubs): reference for web pages

A self-contained summary of how a **web page talks to a LEGO Education SPIKE Prime hub over Bluetooth Low Energy (Web Bluetooth)**. It exists so that people (and LLMs) can build hub-connected web apps **without re-reading LEGO's docs**.

- Captured: 2026-11-20 from <https://lego.github.io/spike-prime-docs/> (pages: connect, encoding, messages, enums, glossary) and LEGO's reference client <https://github.com/LEGO/spike-prime-docs/tree/main/examples/python> (`app.py`, `cobs.py`, `crc.py`, `messages.py`, `_tests/test_cobs.py`).
- Working JavaScript implementation of everything below: [spikeble.js](spikeble.js). Demo page: [index.html](index.html).
- If this file and LEGO's site ever disagree, LEGO's site wins; please then fix this file.

## Verification status (read this first)

| Item | Status |
|---|---|
| COBS framing, XOR, terminator | **Tested in Node** against LEGO's published test vectors (below) plus randomized round trips |
| CRC-32 | **Tested in Node** against Python `zlib.crc32` (with zero-padding to a multiple of 4) |
| Parsing InfoResponse / ConsoleNotification / DeviceNotification | Tested on hand-built byte arrays in Node, **and confirmed on a real hub** (below) |
| Fragmented notifications + request/response matching | Tested in Node with a fake transport |
| Web Bluetooth calls (`requestDevice`, notifications, InfoRequest/Response) | **Confirmed on a real hub**, opened from `file://` in Chrome (2026-11-20) |
| `print()` from a hub program arriving as ConsoleNotification | **Confirmed.** Each `print()` arrived as **two** ConsoleNotifications: the text, then a separate one containing only `\r\n` |
| `ProgramFlowRequest` start/stop from the page | **Confirmed** (used by `tabletop-arena` and the demo page) |
| Device notifications (section 4) | **Confirmed** with the demo page: live motor/sensor data streams. **Hot-swap:** newly plugged devices appear, but the hub never reports an *unplugged* device, so a client that doesn't expire old values shows stale data (the demo page now expires rows) |
| Program upload (ClearSlot, StartFileUpload, TransferChunk) | Reported working by the instructor using the demo page ("everything worked") |
| Two hubs connected to one page | **Confirmed** with `twohubs.html` from `file://`: both connected through separate picker clicks and streamed independently with correct per-hub labeling (simulated-hub tests also checked that commands and data stay in the right panel). Three or more hubs, and sustained-load behavior, not yet tried |
| `getHubName`, `setHubName`, `TunnelMessage`, `DeviceUuid` | Not tried on a real hub |

**Observed InfoResponse (real hub, 2026-11-20):** firmware `1.8.149`, protocol (RPC) `1.0.47`, `max_packet_size` = 182 bytes, `max_chunk_size` = 4096 bytes. If something misbehaves, the demo page's raw console box and `hub.on("message", ...)` show exactly what the hub sent.

## 1. Connecting (GATT)

The hub is a BLE peripheral with one custom service:

| Name | UUID | Direction | Operation |
|---|---|---|---|
| Service | `0000fd02-0000-1000-8000-00805f9b34fb` | | advertised, so use it as the scan filter |
| **RX** | `0000fd02-0001-1000-8000-00805f9b34fb` | page → hub | **write without response** |
| **TX** | `0000fd02-0002-1000-8000-00805f9b34fb` | hub → page | **notify** |

("RX/TX" are named from the hub's point of view.)

Connection sequence (what `SpikeHub.connect()` does):

1. `navigator.bluetooth.requestDevice({ filters: [{ services: [SERVICE] }] })`. Must be called from a **user click**. There is no device-name filter.
2. `device.gatt.connect()` → `getPrimaryService(SERVICE)` → `getCharacteristic(RX)` and `getCharacteristic(TX)`.
3. `tx.startNotifications()` and listen for `characteristicvaluechanged`.
4. Send **InfoRequest**, read **InfoResponse** → learn `max_packet_size` (largest single write) and `max_chunk_size` (largest file chunk).
5. From now on: write framed requests to RX; read framed messages from TX.

Browser rules: Chrome, Edge or another Chromium browser only (no Safari, Firefox or iOS). Needs a secure context: `https://` and `http://localhost` always qualify, and **a double-clicked `file://` page was confirmed to connect and stream in Chrome**. If some browser or setup refuses `requestDevice` from `file://`, serve the folder with `python3 -m http.server` and open `http://localhost:8000`. The hub talks to **one** central at a time, so close the SPIKE App (and any other page) first.

## 2. Framing: how bytes travel

Every message (section 3) is turned into a **frame** before writing, and every notification stream is cut back into frames when reading.

**Sending** one message (`pack`):

1. **COBS-encode** the message bytes (SPIKE variant below).
2. **XOR** every encoded byte with `0x03`.
3. **Append `0x02`** (the end-of-frame marker; this byte is *not* XORed).
4. Write the result to RX in pieces of at most `max_packet_size` bytes (write-without-response, one at a time, in order). Before InfoResponse is known, a safe default is 20 bytes.

The `0x01` byte may prefix a frame on the wire ("high priority" messages). A client never needs to send it, but **must accept it** on receive (skip it if it is the first byte).

**Receiving** (`unpack`): BLE notifications are *packets, not messages*. One message can span several notifications, and one notification can in principle hold several. Append every received byte to a buffer and **cut a frame each time you see `0x02`**. For each frame: drop the leading `0x01` if present, drop the trailing `0x02`, XOR each byte with `0x03`, COBS-decode. (Safe because after encoding+XOR the byte `0x02` can only be the terminator.)

### The COBS variant (constants)

| Constant | Value | Meaning |
|---|---|---|
| `DELIMITER` | `0x02` | also the frame terminator; the biggest value that gets escaped |
| `COBS_CODE_OFFSET` | `2` | code words start at 3 |
| `MAX_BLOCK_SIZE` | `84` | longest run, counting its code byte |
| `NO_DELIMITER` | `0xFF` | code word meaning "full 84-byte run, no delimiter after it" |
| `XOR` | `3` | |

Unlike standard COBS, this escapes **0x00, 0x01 and 0x02** (three delimiter values), not just 0x00. Each run of "ordinary" bytes (values > 2) is preceded by a **code word** that encodes the run length and *which* delimiter byte follows it:

```
code word = delimiter_value * 84 + block_size + 2        (block_size counts the code byte itself, 1..84)
final run  : code = block_size + 2                         (no delimiter follows the last run)
full run   : code = 0xFF, run has exactly 84 data bytes, no delimiter
```

Encode (pseudocode; matches LEGO's `cobs.py`):

```
out = []; begin_block(): code_index = len(out); out.append(0xFF); block = 1
begin_block()
for b in data:
    if b > 2:  out.append(b); block += 1
    if b <= 2 or block > 84:
        if b <= 2: out[code_index] = b*84 + block + 2
        begin_block()                      # (a too-long run keeps code 0xFF)
out[code_index] = block + 2
```

Decode:

```
unescape(code):
    if code == 0xFF: return (None, 85)
    value, block = divmod(code - 2, 84)
    if block == 0: block = 84; value -= 1
    return (value, block)
value, block = unescape(buf[0])
for byte in buf[1:]:
    block -= 1
    if block > 0: out.append(byte); continue        # still inside the run
    if value is not None: out.append(value)        # run ended: restore the delimiter byte
    value, block = unescape(byte)                  # this byte is the next code word
```

### Test vectors (from LEGO's `test_cobs.py`; all pass in [spikeble.js](spikeble.js))

`pack(message)` = COBS + XOR 3 + `02`:

| message bytes | wire bytes |
|---|---|
| `00` | `00 00 02` |
| `01` | `54 00 02` |
| `FF FE DF D5 7D AF 64 61 36 15 41 2D` | `0C FC FD DC D6 7E AC 67 62 35 16 42 2E 02` |
| `00 01 02 03 04 05 06 00 01 02 03 04 05 54 EA 36 00 2D 17 0C` | `00 54 A8 04 00 07 06 05 54 A8 0A 00 07 06 57 E9 35 05 2E 14 0F 02` |

Worked examples: InfoRequest `[00]` goes out as `00 00 02`; "start the program in slot 0" `[1E 00 00]` goes out as `07 1D 00 00 02`.

## 3. Messages

Every un-framed message starts with a one-byte **type ID**. Numbers are **little-endian**. `string[n]` is a NUL-terminated string in at most `n` bytes. A "status" byte is `0x00` = acknowledged (success), `0x01` = not acknowledged.

| ID | Name | Direction | Layout after the ID byte |
|---|---|---|---|
| `0x00` | InfoRequest | → hub | (nothing) |
| `0x01` | InfoResponse | ← hub | rpc_major u8, rpc_minor u8, rpc_build u16, fw_major u8, fw_minor u8, fw_build u16, **max_packet_size u16**, max_message_size u16, **max_chunk_size u16**, product_group_device u16 (`0` = SPIKE Prime). 17 bytes in total |
| `0x18` / `0x19` | GetHubName Req / Resp | | resp: string[30] |
| `0x16` / `0x17` | SetHubName Req / Resp | | req: string[30] (≤29 chars); resp: status |
| `0x1A` / `0x1B` | DeviceUuid Req / Resp | | resp: 16 raw bytes |
| `0x1E` | **ProgramFlowRequest** | → hub | action u8 (`0` start, `1` stop), slot u8 (0-19) |
| `0x1F` | ProgramFlowResponse | ← hub | status |
| `0x20` | ProgramFlowNotification | ← hub | action u8 (`0` start, `1` stop). No slot field |
| `0x21` | **ConsoleNotification** | ← hub | string[256]: text printed by the running program |
| `0x28` | **DeviceNotificationRequest** | → hub | interval_ms u16 (`0` = turn off) |
| `0x29` | DeviceNotificationResponse | ← hub | status |
| `0x3C` | **DeviceNotification** | ← hub | payload_size u16, then payload = back-to-back device records (section 4) |
| `0x32` | TunnelMessage | both | payload_size u16, payload bytes (no sub-format documented) |
| `0x46` | ClearSlotRequest | → hub | slot u8 |
| `0x47` | ClearSlotResponse | ← hub | status |
| `0x0C` | StartFileUploadRequest | → hub | file_name string[32] (≤31 chars, NUL padded), slot u8, crc u32. 38 bytes in total |
| `0x0D` | StartFileUploadResponse | ← hub | status |
| `0x10` | TransferChunkRequest | → hub | running_crc u32, size u16, data[size] |
| `0x11` | TransferChunkResponse | ← hub | status |
| `0x0A` `0x0B` `0x14` `0x15` | Firmware upload/update messages | | not needed for apps; see LEGO's docs |

### How `print()` reaches the page

Text printed by a running hub program arrives as **ConsoleNotification (0x21)**: type byte, then the text, then NUL padding (read up to the first NUL). **Observed on a real hub: one `print("abc")` produced two ConsoleNotifications, `abc` and then a separate `\r\n`.** So never assume one `print()` = one notification, and ignore (or trim) whitespace-only chunks when showing "the last message". Keep a text buffer and parse it yourself. The `SpikeHub` class emits both `"console"` (the raw text of each message) and `"line"` (re-assembled complete lines). A robust trick for streaming numbers is to wrap each reading in markers, e.g. print `<S,12,-3,0>` and find complete readings with a regex (this is what `tabletop-arena` does).

### Starting and stopping programs

Send ProgramFlowRequest: `1E 00 <slot>` to start the program stored in that slot (slots 0-19, the ones the SPIKE App downloads into), `1E 01 <slot>` to stop. A program only produces console output while it is running.

## 4. DeviceNotification: live hub data with no program at all

Send `DeviceNotificationRequest(interval_ms)` once; afterwards the hub **pushes** a `0x3C` message every `interval_ms` (the LEGO example uses 5000; this repo's demo uses 100; the practical minimum is untested). The payload is a sequence of **device records**, each starting with its own type byte. Record sizes are fixed, so walk the payload by size; an **unknown type byte cannot be skipped** (stop parsing).

| Type | Record | Size | Fields (after the type byte) |
|---|---|---|---|
| `0x00` | Battery | 2 | percent u8 |
| `0x01` | IMU | 21 | up_face u8, yaw_face u8, yaw i16, pitch i16, roll i16, accel x,y,z i16 ×3, gyro x,y,z i16 ×3 |
| `0x02` | 5×5 light matrix | 26 | 25 pixel values u8 |
| `0x0A` | **Motor** | 12 | port u8, device_type u8 (`0x30` medium, `0x31` large, `0x41` small), absolute_position i16 (−180..179°), power i16 (−10000..10000), speed i8 (−100..100), **position i32** (cumulative degrees) |
| `0x0B` | **Force sensor** | 4 | port u8, force u8 (0..100), pressed u8 (1 = pressed) |
| `0x0C` | Color sensor | 9 | port u8, color i8, red u16, green u16, blue u16 (0..1023) |
| `0x0D` | Distance sensor | 4 | port u8, distance i16 mm (40..2000, **−1 = nothing seen**) |
| `0x0E` | 3×3 color matrix | 11 | port u8, 9 pixels u8 (brightness high nibble, color low nibble) |

Only ports with something plugged in produce a record, and **there is no "unplugged" record**: when a device is removed its record simply stops appearing. Remember when you last saw each record and expire it yourself (the demo page drops a row after 3 update intervals, minimum 1.5 s). Port numbers: `0`=A `1`=B `2`=C `3`=D `4`=E `5`=F. Color enum: 0 black, 1 magenta, 2 purple, 3 blue, 4 azure, 5 turquoise, 6 green, 7 yellow, 8 orange, 9 red, 10 white, −1/0xFF none. [spikeble.js](spikeble.js) already turns these into objects like `{kind:"motor", port:"A", position:1234, ...}`.

## 5. Uploading a program from the page (so no SPIKE App is needed)

Implemented as `hub.uploadProgram(sourceText, slot)`. The upload is the plain **Python source text** (UTF-8), not compiled `.mpy`, under the file name `program.py`. Sequence from LEGO's example:

1. InfoRequest → InfoResponse (gives `max_chunk_size`).
2. `ClearSlotRequest(slot)` (an "unsuccessful" answer is only a warning).
3. `StartFileUploadRequest("program.py", slot, crc32(whole_file))`; stop if status ≠ 0.
4. For each chunk of at most `max_chunk_size` bytes: `running_crc = crc32(chunk, seed = running_crc)`; send `TransferChunkRequest(running_crc, chunk)`; stop if status ≠ 0.
5. `ProgramFlowRequest(start, slot)` to run it.

Responses are matched to requests **by message ID only** (there are no sequence numbers), so only keep one request of each kind in flight.

**CRC-32:** the standard zlib/IEEE CRC-32 (reflected polynomial `0xEDB88320`, init and final XOR `0xFFFFFFFF`), computed on the data **zero-padded to a multiple of 4 bytes** (LEGO: "the CRC must be calculated on a multiple of 4 bytes"). "Running" means each chunk's CRC is seeded with the previous result. Padding is applied per call, so keep non-final chunks a multiple of 4 bytes (the real hub reported `max_chunk_size` = 4096, which is).

## 6. Gotchas

- `print()` timing/format: see section 3. Treat the "console" text as a stream.
- **Official protocol (this page) vs `spikecomm`:** they solve different problems.
  - *This page (official LEGO protocol):* nothing to install on the hub; the hub runs an ordinary program (started from the SPIKE App, the hub button, or the page) and the page reads its `print()` output, reads device data, and can start/stop/upload programs. The page cannot send arbitrary data *to* a running program (`TunnelMessage` is undocumented and untried).
  - *[`spikecomm`](https://github.com/edanahy/spikecomm)* (instructor's library, per its README v1.2.0): needs `spikecomm.py` copied onto each hub with `mpremote`, and programs must be started from the REPL over USB (not the SPIKE App's Run button). In exchange it gives hub-to-hub messaging (including one-to-many broadcast) and a simple two-way text channel between a web page and a hub program (Nordic UART service, not the LEGO protocol). It does not give a page the hub's `print()` output or program management.
  - Rule of thumb: **one hub feeding a web page, or the page managing programs → this page.** Hub-to-hub, or the page needs to *send* data into the hub program → `spikecomm`.
- **Hub-side code** (what to `print()`, which motor/sensor calls exist) is in [HUB_API.md](HUB_API.md).
- Write RX **without response** and **serialize writes** (`await` each one). Parallel writes cause "GATT operation already in progress".
- Keep reading TX even while writing; the hub can send notifications at any time (console text, device data).
- `max_message_size` in InfoResponse is not explained in LEGO's docs; `uploadProgram` does not use it.
- The docs site does not say which firmware versions speak this protocol. Check `InfoResponse` firmware fields if something is odd. LEGO's site is titled "SPIKE Prime protocol 1.0" for "SPIKE App 3 Prime hubs".
- Hub name / advertised name is not documented and not needed: filter by service UUID.

## 7. Using it

```html
<script src="spikeble.js"></script>
<script>
  const hub = new SpikeBLE.SpikeHub();
  hub.on("console", text => console.log("hub printed", text));       // print() output
  hub.on("device",  records => console.log(records));                // after setDeviceNotifications
  // Numbers printed by the hub as  print("<S,{},{}>".format(a, b)):
  hub.onReading(/<S,(-?\d+),(-?\d+)>/, ([a, b]) => console.log(a, b));
  connectBtn.onclick = async () => {                                  // must be a click
    await hub.connect();
    await hub.setDeviceNotifications(100);        // optional: live motor/sensor data, no program
    await hub.startProgram(0);                    // optional: run the program in slot 0
  };
</script>
```

API summary (all in [spikeble.js](spikeble.js)): `new SpikeBLE.SpikeHub()` with `connect()`, `disconnect()`, `on(event, fn)`, `send(bytes)`, `request(bytes, responseId)`, `onReading(regex, fn)`, `startProgram(slot)`, `stopProgram(slot)`, `setDeviceNotifications(ms)`, `getHubName()`, `uploadProgram(source, slot, {start, onProgress})`. Events: `console`, `line`, `device`, `programflow`, `message`, `info`, `disconnect`. `SpikeBLE.VERSION` is the library version (this file's master copy is in `web-bt`; projects copy it). Pure helpers (usable without Bluetooth, and in Node via `require`): `pack`, `unpack`, `cobsEncode`, `cobsDecode`, `crc32`, `build.*`, `parseMessage`.
