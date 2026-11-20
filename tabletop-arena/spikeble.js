/* ============================================================================
 * spikeble.js  --  talk to a LEGO SPIKE Prime hub (SPIKE App 3 firmware) from a
 *                  web page using Web Bluetooth.
 *
 * One file, no dependencies, no build step.  Load it with a plain <script> tag:
 *
 *     <script src="spikeble.js"></script>
 *     <script>
 *       const hub = new SpikeBLE.SpikeHub();
 *       hub.on("console", text => console.log("hub printed:", text));
 *       connectButton.onclick = () => hub.connect();   // must be a button click!
 *     </script>
 *
 * Version 1.1.0 (see SpikeBLE.VERSION). The master copy lives in the web-bt
 * project; other projects keep their own copy, so compare versions to spot an old one.
 *
 * Protocol source: https://lego.github.io/spike-prime-docs/  (see PROTOCOL.md
 * in this folder for a plain-English summary of everything used below).
 *
 * The file has four layers, top to bottom:
 *   1. Constants   (UUIDs, message IDs)
 *   2. Framing     (COBS encoding + XOR + 0x02 terminator, CRC-32)
 *   3. Messages    (build requests, parse responses / notifications)
 *   4. SpikeHub    (a class that does the Bluetooth part and ties it together)
 *
 * The first three layers are pure functions (no Bluetooth), so they can be
 * tested in Node:  node -e "const S=require('./spikeble.js'); console.log(S.pack([0]))"
 * ========================================================================== */
"use strict";

const SpikeBLE = (() => {

  const VERSION = "1.1.0";

  // ==========================================================================
  // 1. CONSTANTS
  // ==========================================================================

  // The hub advertises this service, so we use it to filter the device picker.
  const SERVICE_UUID = "0000fd02-0000-1000-8000-00805f9b34fb";
  // We WRITE requests to RX ("RX" = the hub's receive side).
  const RX_UUID      = "0000fd02-0001-1000-8000-00805f9b34fb";
  // We get NOTIFICATIONS from TX ("TX" = the hub's transmit side).
  const TX_UUID      = "0000fd02-0002-1000-8000-00805f9b34fb";

  // Message type IDs. The first byte of every (un-framed) message.
  const MSG = {
    InfoRequest: 0x00,               InfoResponse: 0x01,
    StartFirmwareUploadRequest: 0x0A, StartFirmwareUploadResponse: 0x0B,
    StartFileUploadRequest: 0x0C,    StartFileUploadResponse: 0x0D,
    TransferChunkRequest: 0x10,      TransferChunkResponse: 0x11,
    BeginFirmwareUpdateRequest: 0x14, BeginFirmwareUpdateResponse: 0x15,
    SetHubNameRequest: 0x16,         SetHubNameResponse: 0x17,
    GetHubNameRequest: 0x18,         GetHubNameResponse: 0x19,
    DeviceUuidRequest: 0x1A,         DeviceUuidResponse: 0x1B,
    ProgramFlowRequest: 0x1E,        ProgramFlowResponse: 0x1F,
    ProgramFlowNotification: 0x20,
    ConsoleNotification: 0x21,       // <-- what print() in your hub program becomes
    DeviceNotificationRequest: 0x28, DeviceNotificationResponse: 0x29,
    TunnelMessage: 0x32,
    DeviceNotification: 0x3C,        // <-- live sensor/motor/battery data
    ClearSlotRequest: 0x46,          ClearSlotResponse: 0x47,
  };
  const MSG_NAME = {};
  for (const [name, id] of Object.entries(MSG)) MSG_NAME[id] = name;

  // Handy name tables (from the docs' enumerations page).
  const PORT_NAMES  = ["A", "B", "C", "D", "E", "F"];
  const COLOR_NAMES = { 0: "black", 1: "magenta", 2: "purple", 3: "blue", 4: "azure",
                        5: "turquoise", 6: "green", 7: "yellow", 8: "orange", 9: "red",
                        10: "white", [-1]: "none" };

  // ==========================================================================
  // 2. FRAMING:  message bytes  ->  COBS  ->  XOR 3  ->  + 0x02 terminator
  // ==========================================================================
  // Why? The hub uses 0x02 to mean "end of message", so 0x02 must never appear
  // inside a message. COBS rewrites the data so that 0x00, 0x01 and 0x02 (the
  // "delimiter" bytes) disappear: each run of data gets a "code" byte in front
  // that remembers which delimiter followed it and how long the run is.

  const DELIMITER   = 0x02;  // end-of-frame marker, and the biggest escaped value
  const NO_DELIMITER = 0xFF; // code word: "84 data bytes, no delimiter after them"
  const CODE_OFFSET = 2;     // code words start at 3 so they never look like a delimiter
  const MAX_BLOCK   = 84;    // longest run, counting the code byte itself
  const XOR_MASK    = 3;     // each encoded byte is XORed with this (kills 0x01/0x02/0x03)

  /** COBS-encode an array of bytes (SPIKE flavour). Returns a Uint8Array. */
  function cobsEncode(data) {
    const out = [];
    let codeIndex = 0, block = 1;
    const beginBlock = () => { codeIndex = out.length; out.push(NO_DELIMITER); block = 1; };
    beginBlock();
    for (const b of data) {
      if (b > DELIMITER) { out.push(b); block++; }      // ordinary byte: copy it
      if (b <= DELIMITER || block > MAX_BLOCK) {        // delimiter found, or run too long
        if (b <= DELIMITER) out[codeIndex] = b * MAX_BLOCK + block + CODE_OFFSET;
        beginBlock();                                   // (too-long run keeps code 0xFF)
      }
    }
    out[codeIndex] = block + CODE_OFFSET;               // code word for the last run
    return Uint8Array.from(out);
  }

  /** Reverse of cobsEncode. Throws on an empty input. */
  function cobsDecode(buf) {
    if (buf.length === 0) throw new Error("cobsDecode: empty input");
    const out = [];
    const unescape = (code) => {                        // code word -> [delimiter value, block length]
      if (code === NO_DELIMITER) return [null, MAX_BLOCK + 1];
      let value = Math.floor((code - CODE_OFFSET) / MAX_BLOCK);
      let block = (code - CODE_OFFSET) % MAX_BLOCK;
      if (block === 0) { block = MAX_BLOCK; value -= 1; }
      return [value, block];
    };
    let [value, block] = unescape(buf[0]);
    for (let i = 1; i < buf.length; i++) {
      block--;
      if (block > 0) { out.push(buf[i]); continue; }    // still inside the run: data byte
      if (value !== null) out.push(value);              // run ended: put the delimiter byte back
      [value, block] = unescape(buf[i]);                // this byte is the next code word
    }
    return Uint8Array.from(out);
  }

  /** Message bytes -> bytes ready to write to the hub (includes final 0x02). */
  function pack(message) {
    const enc = cobsEncode(message);
    const out = new Uint8Array(enc.length + 1);
    for (let i = 0; i < enc.length; i++) out[i] = enc[i] ^ XOR_MASK;
    out[enc.length] = DELIMITER;                        // the terminator is NOT xored
    return out;
  }

  /** One complete frame from the hub (with its trailing 0x02) -> message bytes. */
  function unpack(frame) {
    let start = 0;
    if (frame[0] === 0x01) start = 1;                   // optional "high priority" prefix
    const body = new Uint8Array(frame.length - 1 - start);
    for (let i = 0; i < body.length; i++) body[i] = frame[start + i] ^ XOR_MASK;
    return cobsDecode(body);
  }

  // CRC-32 (the same one zlib / Python's binascii.crc32 use). Only needed for
  // uploading a program. The hub wants the data zero-padded to a multiple of 4.
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  /** crc32(bytes, seed) -- pass the previous result as `seed` to chain chunks. */
  function crc32(data, seed = 0) {
    const rem = data.length % 4;
    const padded = new Uint8Array(data.length + (rem ? 4 - rem : 0));
    padded.set(data);
    let c = (seed ^ 0xFFFFFFFF) >>> 0;
    for (const b of padded) c = (CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8)) >>> 0;
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  // ==========================================================================
  // 3. MESSAGES  (all multi-byte numbers are little-endian)
  // ==========================================================================

  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();

  // ---- Building requests (each returns the un-framed message bytes) --------
  const build = {
    infoRequest:  () => Uint8Array.of(MSG.InfoRequest),
    getHubName:   () => Uint8Array.of(MSG.GetHubNameRequest),
    clearSlot:    (slot) => Uint8Array.of(MSG.ClearSlotRequest, slot),
    /** action: 0 = start program in slot, 1 = stop it */
    programFlow:  (start, slot) => Uint8Array.of(MSG.ProgramFlowRequest, start ? 0 : 1, slot),
    /** intervalMs = how often the hub pushes DeviceNotifications (0 turns them off) */
    deviceNotificationRequest: (intervalMs) => {
      const m = new DataView(new ArrayBuffer(3));
      m.setUint8(0, MSG.DeviceNotificationRequest);
      m.setUint16(1, intervalMs, true);
      return new Uint8Array(m.buffer);
    },
    /** fileName: max 31 chars. slot: 0-19. crc: whole-file crc32(). */
    startFileUpload: (fileName, slot, crc) => {
      const m = new Uint8Array(1 + 32 + 1 + 4);
      m[0] = MSG.StartFileUploadRequest;
      m.set(textEncoder.encode(fileName).slice(0, 31), 1);     // rest stays 0 = NUL padding
      m[33] = slot;
      new DataView(m.buffer).setUint32(34, crc, true);
      return m;
    },
    /** runningCrc = crc32 of everything sent so far INCLUDING this chunk. */
    transferChunk: (runningCrc, chunk) => {
      const m = new Uint8Array(7 + chunk.length);
      const v = new DataView(m.buffer);
      m[0] = MSG.TransferChunkRequest;
      v.setUint32(1, runningCrc, true);
      v.setUint16(5, chunk.length, true);
      m.set(chunk, 7);
      return m;
    },
  };

  // ---- Parsing DeviceNotification payloads ---------------------------------
  // A DeviceNotification holds several small records back-to-back. Each starts
  // with a type byte, and each type has a fixed size.
  const DEVICE_RECORD_SIZE = { 0x00: 2, 0x01: 21, 0x02: 26, 0x0A: 12, 0x0B: 4, 0x0C: 9, 0x0D: 4, 0x0E: 11 };

  function parseDeviceRecord(type, v, o) {           // v = DataView, o = offset of the type byte
    switch (type) {
      case 0x00: return { kind: "battery", percent: v.getUint8(o + 1) };
      case 0x01: return { kind: "imu",
        upFace: v.getUint8(o + 1), yawFace: v.getUint8(o + 2),
        yaw: v.getInt16(o + 3, true), pitch: v.getInt16(o + 5, true), roll: v.getInt16(o + 7, true),
        accel: [v.getInt16(o + 9, true), v.getInt16(o + 11, true), v.getInt16(o + 13, true)],
        gyro:  [v.getInt16(o + 15, true), v.getInt16(o + 17, true), v.getInt16(o + 19, true)] };
      case 0x02: {
        const pixels = []; for (let i = 0; i < 25; i++) pixels.push(v.getUint8(o + 1 + i));
        return { kind: "matrix5x5", pixels };
      }
      case 0x0A: return { kind: "motor", port: PORT_NAMES[v.getUint8(o + 1)],
        deviceType: v.getUint8(o + 2),           // 0x30 medium, 0x31 large, 0x41 small
        absolutePosition: v.getInt16(o + 3, true), // -180..179 degrees
        power: v.getInt16(o + 5, true),            // -10000..10000
        speed: v.getInt8(o + 7),                   // -100..100
        position: v.getInt32(o + 8, true) };       // cumulative degrees (can be huge)
      case 0x0B: return { kind: "force", port: PORT_NAMES[v.getUint8(o + 1)],
        force: v.getUint8(o + 2),                  // 0..100
        pressed: v.getUint8(o + 3) === 1 };
      case 0x0C: return { kind: "color", port: PORT_NAMES[v.getUint8(o + 1)],
        color: v.getInt8(o + 2), colorName: COLOR_NAMES[v.getInt8(o + 2)] || "?",
        r: v.getUint16(o + 3, true), g: v.getUint16(o + 5, true), b: v.getUint16(o + 7, true) };
      case 0x0D: return { kind: "distance", port: PORT_NAMES[v.getUint8(o + 1)],
        mm: v.getInt16(o + 2, true) };             // -1 = nothing detected
      case 0x0E: {
        const pixels = []; for (let i = 0; i < 9; i++) pixels.push(v.getUint8(o + 2 + i));
        return { kind: "colorMatrix", port: PORT_NAMES[v.getUint8(o + 1)], pixels };
      }
    }
    return null;
  }

  /** Parse the records inside a DeviceNotification payload (bytes after the 3-byte header). */
  function parseDeviceRecords(payload) {
    const v = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const records = [];
    let o = 0;
    while (o < payload.length) {
      const type = payload[o], size = DEVICE_RECORD_SIZE[type];
      if (!size || o + size > payload.length) break;  // unknown type: sizes unknown, so stop
      records.push(parseDeviceRecord(type, v, o));
      o += size;
    }
    return records;
  }

  /** Turn un-framed message bytes into an object: { type: "InfoResponse", ...fields }. */
  function parseMessage(m) {
    const id = m[0];
    const type = MSG_NAME[id] || ("Unknown0x" + id.toString(16));
    const v = new DataView(m.buffer, m.byteOffset, m.byteLength);
    switch (id) {
      case MSG.InfoResponse:
        return { type, rpcVersion: `${m[1]}.${m[2]}.${v.getUint16(3, true)}`,
          firmwareVersion: `${m[5]}.${m[6]}.${v.getUint16(7, true)}`,
          maxPacketSize: v.getUint16(9, true),   // biggest single write to RX
          maxMessageSize: v.getUint16(11, true),
          maxChunkSize: v.getUint16(13, true),   // biggest file chunk for uploads
          productGroupDevice: v.getUint16(15, true) };
      case MSG.ConsoleNotification: {            // text up to the first NUL byte
        let end = m.indexOf(0, 1); if (end < 0) end = m.length;
        return { type, text: textDecoder.decode(m.slice(1, end)) };
      }
      case MSG.DeviceNotification:
        return { type, records: parseDeviceRecords(m.slice(3, 3 + v.getUint16(1, true))) };
      case MSG.ProgramFlowNotification:
        return { type, action: m[1] === 0 ? "start" : "stop" };
      case MSG.GetHubNameResponse: {
        let end = m.indexOf(0, 1); if (end < 0) end = m.length;
        return { type, name: textDecoder.decode(m.slice(1, end)) };
      }
      case MSG.ClearSlotResponse: case MSG.StartFileUploadResponse:
      case MSG.TransferChunkResponse: case MSG.ProgramFlowResponse:
      case MSG.DeviceNotificationResponse: case MSG.SetHubNameResponse:
        return { type, ok: m[1] === 0x00 };      // 0 = acknowledged, 1 = not acknowledged
      case MSG.TunnelMessage:
        return { type, data: m.slice(3, 3 + v.getUint16(1, true)) };
    }
    return { type, bytes: m };
  }

  // ==========================================================================
  // 4. SpikeHub : the Bluetooth part
  // ==========================================================================
  // Events you can subscribe to with hub.on(name, fn):
  //   "console"     (text)      raw text of one ConsoleNotification (a print() from the hub).
  //                             NOTE: one print() arrives as TWO of these: the text, then a lone "\r\n".
  //   "line"        (line)      same text, but re-assembled into complete lines
  //   "device"      (records)   array of {kind:"motor"|"force"|"battery"|...} objects
  //   "programflow" (action)    "start" or "stop"
  //   "message"     (msg)       every parsed message (good for debugging)
  //   "info"        (info)      the InfoResponse, right after connecting
  //   "disconnect"  ()          the hub went away
  class SpikeHub {
    constructor() {
      this.device = null;
      this.rx = null;
      this.tx = null;
      this.info = null;               // filled in by connect()
      this.maxPacketSize = 20;        // safe default until InfoResponse arrives
      this._handlers = {};
      this._rxBuffer = [];            // bytes received but not yet a whole frame
      this._lineBuffer = "";          // console text not yet a whole line
      this._pending = [];             // requests waiting for a response
      this._readers = [];             // onReading() subscriptions
      this._writeChain = Promise.resolve();   // BLE writes must happen one at a time
    }

    on(event, fn) { (this._handlers[event] = this._handlers[event] || []).push(fn); return this; }
    _emit(event, arg) { for (const fn of this._handlers[event] || []) { try { fn(arg); } catch (e) { console.error(e); } } }
    get connected() { return !!(this.device && this.device.gatt && this.device.gatt.connected); }

    /** Opens the browser's Bluetooth picker. MUST be called from a click handler. */
    async connect() {
      if (!navigator.bluetooth) throw new Error("Web Bluetooth is not available. Use Chrome or Edge (not Safari/Firefox).");
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [SERVICE_UUID] }],     // only show SPIKE hubs
        optionalServices: [SERVICE_UUID],
      });
      this._rxBuffer = []; this._lineBuffer = "";     // forget leftovers from any earlier connection
      for (const r of this._readers) r.text = "";
      this.device.addEventListener("gattserverdisconnected", () => this._emit("disconnect"));
      const server  = await this.device.gatt.connect();
      const service = await server.getPrimaryService(SERVICE_UUID);
      this.rx = await service.getCharacteristic(RX_UUID);
      this.tx = await service.getCharacteristic(TX_UUID);
      this.tx.addEventListener("characteristicvaluechanged", (e) => {
        const dv = e.target.value;
        this._onBytes(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength));
      });
      await this.tx.startNotifications();            // from now on the hub can talk to us
      this.info = await this.request(build.infoRequest(), MSG.InfoResponse);
      this.maxPacketSize = this.info.maxPacketSize;
      this._emit("info", this.info);
      return this.info;
    }

    disconnect() { if (this.connected) this.device.gatt.disconnect(); }

    /**
     * Turn printed text into numbers. Give a regular expression with one capture group per
     * number; `fn` is called with an array of Numbers for every complete match.
     *
     *     // hub program does: print("<S,{},{},{}>".format(a, b, c))
     *     hub.onReading(/<S,(-?\d+),(-?\d+),(-?\d+)>/, ([a, b, c]) => { ... });
     *
     * It copes with text split across messages and with the stray "\r\n" messages, because
     * it keeps its own buffer and only looks for complete matches. Wrapping each reading in
     * markers (the < > above) is what makes that reliable. Captures that are not numbers
     * become NaN. If several readings arrive at once, `fn` is called once for each, in order.
     */
    onReading(regex, fn) {
      const reader = { re: new RegExp(regex.source, "g"), fn, text: "" };
      this._readers.push(reader);
      return this;
    }

    // ---- sending -----------------------------------------------------------
    /** Frame a message and write it to the hub, split to max_packet_size. */
    send(message) {
      if (!this.rx || !this.connected) return Promise.reject(new Error("Not connected to a hub"));
      const frame = pack(message);
      const size = this.maxPacketSize;
      const result = this._writeChain.then(async () => {
        for (let i = 0; i < frame.length; i += size) {
          const piece = frame.slice(i, i + size);
          if (this.rx.writeValueWithoutResponse) await this.rx.writeValueWithoutResponse(piece);
          else await this.rx.writeValue(piece);
        }
      });
      this._writeChain = result.catch(() => {});   // one failed write must not break every later write
      return result;
    }

    /** Send a message and wait for the response with message ID `responseId`. */
    request(message, responseId, timeoutMs = 4000) {
      return new Promise((resolve, reject) => {
        const entry = { id: responseId, resolve };
        entry.timer = setTimeout(() => {
          this._pending = this._pending.filter((p) => p !== entry);
          reject(new Error("Timed out waiting for " + (MSG_NAME[responseId] || responseId)));
        }, timeoutMs);
        this._pending.push(entry);
        this.send(message).catch(reject);
      });
    }

    // ---- handy high-level commands ----------------------------------------
    async startProgram(slot) { return this.request(build.programFlow(true, slot), MSG.ProgramFlowResponse); }
    async stopProgram(slot)  { return this.request(build.programFlow(false, slot), MSG.ProgramFlowResponse); }
    async getHubName()       { return (await this.request(build.getHubName(), MSG.GetHubNameResponse)).name; }
    /** Ask the hub to push DeviceNotifications every intervalMs (0 = stop). */
    async setDeviceNotifications(intervalMs) {
      return this.request(build.deviceNotificationRequest(intervalMs), MSG.DeviceNotificationResponse);
    }

    /**
     * Upload Python source text to a program slot (0-19). Optionally start it.
     * Sequence: ClearSlot -> StartFileUpload -> TransferChunk x N -> ProgramFlow(start)
     * NOTE: written from the LEGO docs/example but not yet tested on a real hub.
     */
    async uploadProgram(source, slot = 0, { start = true, fileName = "program.py", onProgress } = {}) {
      if (!this.info) throw new Error("Connect first.");
      const data = textEncoder.encode(source);
      const check = (resp, what) => { if (!resp.ok) throw new Error(what + " was rejected by the hub"); };

      // Clearing may be refused on an empty slot, so we ignore that answer.
      await this.request(build.clearSlot(slot), MSG.ClearSlotResponse);
      check(await this.request(build.startFileUpload(fileName, slot, crc32(data)), MSG.StartFileUploadResponse), "StartFileUpload");

      let running = 0;                                // running CRC across chunks
      const chunkSize = this.info.maxChunkSize;
      for (let i = 0; i < data.length; i += chunkSize) {
        const chunk = data.slice(i, i + chunkSize);
        running = crc32(chunk, running);
        check(await this.request(build.transferChunk(running, chunk), MSG.TransferChunkResponse), "TransferChunk");
        if (onProgress) onProgress(Math.min(i + chunkSize, data.length), data.length);
      }
      if (start) check(await this.startProgram(slot), "ProgramFlow start");
    }

    // ---- receiving ---------------------------------------------------------
    // Notifications are BLE packets, NOT messages: one message can arrive in
    // several packets. So we collect bytes and cut a frame at every 0x02.
    _onBytes(bytes) {
      for (const b of bytes) {
        this._rxBuffer.push(b);
        if (b === DELIMITER) {
          const frame = Uint8Array.from(this._rxBuffer);
          this._rxBuffer = [];
          try { this._onMessage(parseMessage(unpack(frame))); }
          catch (e) { console.warn("Bad frame from hub", frame, e); }
        }
      }
    }

    _feedReaders(text) {
      for (const r of this._readers) {
        r.text += text;
        let m, consumed = 0;
        r.re.lastIndex = 0;
        while ((m = r.re.exec(r.text)) !== null) {
          consumed = r.re.lastIndex;
          try { r.fn(m.slice(1).map(Number)); } catch (e) { console.error(e); }
          if (m[0] === "") r.re.lastIndex++;               // a pattern that can match nothing must still advance
        }
        r.text = r.text.slice(consumed).slice(-200);      // keep a possible partial reading, but never grow forever
      }
    }

    _onMessage(msg) {
      this._emit("message", msg);
      // Anyone waiting for this kind of response?
      const i = this._pending.findIndex((p) => MSG_NAME[p.id] === msg.type);
      if (i >= 0) { const [p] = this._pending.splice(i, 1); clearTimeout(p.timer); p.resolve(msg); }

      if (msg.type === "ConsoleNotification") {
        this._emit("console", msg.text);
        this._feedReaders(msg.text);
        this._lineBuffer += msg.text;
        const lines = this._lineBuffer.split(/\r?\n/);
        this._lineBuffer = lines.pop();               // last piece may be an unfinished line
        for (const line of lines) this._emit("line", line);
      } else if (msg.type === "DeviceNotification") {
        this._emit("device", msg.records);
      } else if (msg.type === "ProgramFlowNotification") {
        this._emit("programflow", msg.action);
      }
    }
  }

  return { VERSION, SERVICE_UUID, RX_UUID, TX_UUID, MSG, MSG_NAME, PORT_NAMES,
           cobsEncode, cobsDecode, pack, unpack, crc32,
           build, parseMessage, parseDeviceRecords, SpikeHub };
})();

// Lets Node `require()` the file for tests; harmless in the browser.
if (typeof module !== "undefined" && module.exports) module.exports = SpikeBLE;
