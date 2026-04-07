# Embedded Team Handoff (Windows app + Robot Wi-Fi)

## Related specs
- [Keepalive Contract V1](keepalive-contract-v1.md)
- [App COM Mission Profile V1](app-com-mission-profile-v1.md)
- [App F1-F5 Regression Pack](app-f1-f5-regression-pack.md)

COM mission summary: COM is only for workshop/service operations (flash, provision, calibrate, diagnose) until Wi-Fi-ready handoff; runtime control ownership stays on Wi-Fi.

Single-app operation summary: the same app is used to prepare each robot over COM, then control that robot over Wi-Fi; switching robots means repeating COM preparation for the next unit in the same app.

## Target user flow
1. User installs Windows app.
2. User plugs USB cable to robot for first-time network provisioning.
3. User sets Wi-Fi profile for robot.
4. User unplugs USB.
5. Robot joins Wi-Fi and accepts control commands from app.

## Required embedded deliverables

### 0) Desktop COM scan behavior (current app)
- App desktop scans COM ports every ~2.2 seconds on Windows using .NET `SerialPort.GetPortNames()` and enriches labels via PnP data.
- App shows only `COMx` ports in selector.
- Operator chooses COM and presses `KET NOI`.
- App sends initial hello frame after connect:
```json
{
  "type": "hello",
  "source": "steam_planner",
  "ts": 1711910000000
}
```
- Embedded side should reply one line JSON ACK immediately:
```json
{
  "type": "ack",
  "stage": "usb_connected",
  "robot_id": "RB-01",
  "fw": "1.0.0",
  "ts": 1711910000100
}
```

- App status line interpretation:
  - `... ACK ...` -> command handshake accepted.
  - `... TELEMETRY ...` -> robot is streaming state.
  - `Offline` -> COM not connected.
  - `Error: ...` -> COM/driver/port issue.

### 1) USB provisioning mode
- Expose a stable USB interface (CDC serial or HID) when cable is connected.
- Provide commands to set and persist:
  - `wifi_ssid`
  - `wifi_password`
  - `robot_id` (optional but recommended)
  - `control_udp_port` (default `9000`)
- Return explicit ACK/ERR with error code for each provisioning write.
- Persist config in non-volatile storage and confirm with `config_saved=true`.

### 2) Wi-Fi behavior after unplug
- On USB disconnect, auto-start Wi-Fi connection using saved credentials.
- If Wi-Fi join fails, fallback AP mode with known SSID pattern:
  - `URLAB-ROBOT-<robot_id>`
- Publish robot IP and status for diagnostics.
- Keep startup-to-ready time under 10 seconds when credentials are valid.

### 3) Control transport contract
- Robot must listen UDP on configured port (default `9000`).
- Gateway forwards packets in this JSON envelope:
```json
{
  "eventName": "control_action",
  "payload": { "action": "arm", "ts": 1711910000000, "source": "header" },
  "ts": 1711910000000
}
```
- Robot should parse by `eventName` and ignore unknown fields.
- Add deduplication by timestamp + short command TTL (recommended 500-1000 ms).

### 4) Command set to support (from current robot operations)
- System actions:
  - `arm`
  - `hold`
  - `stop` / emergency stop (highest priority)
- Behaviors:
  - `sit`
  - `stretch`
  - `butt_up`
  - `jump`
  - `hi`
- Move controls:
  - directional: `forward`, `backward`, `left`, `right`, `stop`
  - scalar controls: `speed` (range 0-10), `height` (range 0-100)
- Gaits:
  - `walk`
  - `trot`
  - `stomp`

### 5) Telemetry feedback expected
- Push or expose telemetry at 5-10 Hz minimum:
  - battery percent
  - velocity
  - body temperature
  - current gait
  - robot state (`idle`, `running`, `hold`, `estop`)
  - Wi-Fi RSSI (recommended)
- Include monotonically increasing counter for packet-loss detection.

Recommended telemetry line frame over USB during provisioning/debug:
```json
{
  "type": "telemetry",
  "seq": 1024,
  "battery": 63,
  "velocity": 0.12,
  "temp": 45.1,
  "state": "idle",
  "wifi": { "mode": "sta", "ssid": "URLAB-LAB", "ip": "192.168.4.1", "rssi": -54 },
  "ts": 1711910000200
}
```

Line protocol rule:
- One JSON object per line (`\n` terminated).
- UTF-8 text.
- Maximum line length <= 1024 bytes.

### 6) Safety requirements
- `stop` must preempt all active behaviors and movement.
- Enforce max acceleration and safe height boundaries onboard.
- Apply watchdog timeout: if no valid command for N ms, transition to safe hold.
- Reject commands when robot is not armed, except `arm` and `stop`.

## Contract V1 (Frozen)

Keepalive extension for watchdog-safe liveness is defined in:
- [keepalive-contract-v1.md](keepalive-contract-v1.md)

### Command envelope (required)
All command paths (WiFi/Serial) should carry this schema:

```json
{
  "schema_v": 1,
  "cmd_id": 105,
  "cmd_type": "move",
  "source": "wifi",
  "ttl_ms": 200,
  "ack_required": true,
  "ts_client": 1711910000000,
  "payload": { "action": "forward", "value": 0.5 }
}
```

Validation rules:
- Missing `schema_v` or `cmd_id` => reject as malformed.
- `ttl_ms` is enforced at dequeue-time in firmware.
- Dedup scope is per-source (`wifi` and `serial` independent).

### Reason-code dictionary
- `0x00` `OK`
- `0x01` `ERR_STALE_TTL`
- `0x02` `ERR_DUPLICATE_ID`
- `0x03` `ERR_PROV_LOCKED`
- `0x04` `ERR_DUAL_ACTIVE`
- `0x05` `ERR_MALFORMED`
- `0x06` `ERR_NOT_ARMED`

### ACK frame (separate from telemetry)
For command decisions and guard rejections, firmware emits dedicated ACK frames:

```json
{
  "type": "ack",
  "ack_id": 105,
  "status": "OK",
  "reason_code": 0,
  "reason_text": "ok",
  "phase": "WIFI_PRIMARY",
  "transport": "wifi",
  "fw_ts": 1205166
}
```

Notes:
- If `ack_required=true`, app treats command as completed only after ACK `status=OK`.
- Rejected commands must still emit ACK with proper `reason_code`.

### Telemetry nav_meta extension
Telemetry heartbeat includes contract status metadata:

```json
{
  "type": "telemetry",
  "nav_meta": {
    "transport": "wifi",
    "phase": "WIFI_PRIMARY",
    "q_depth": 2,
    "drp_pkts": 12,
    "watchdog_age_ms": 48,
    "last_err_code": 0,
    "last_err_text": "ok"
  }
}
```

### Provisioning policy
During `PROVISIONING` phase:
- Block movement/action/gait commands with `ERR_PROV_LOCKED`.
- Allow safety and setup commands: `ESTOP`, `STOP`, `HELLO`, `STATUS`, `PROV_*`.
- Do not enable motion on WiFi until provisioning is complete and phase transition is explicit.

## Integration checklist (joint test)
1. USB provisioning success and persisted after power cycle.
2. Wi-Fi auto-connect success after USB unplug.
3. App can send system commands and receive ACK behavior.
4. Directional control and speed/height ranges behave correctly.
5. E-stop works under packet loss and high command rate.
6. Robot returns telemetry continuously during movement.

## App Mapping (Implemented)

### Keyboard controls
- `W` -> forward
- `A` -> left
- `S` -> backward
- `D` -> right
- `SPACE` -> stop / e-stop action

### Action keys
- `1` -> sit
- `2` -> stretch
- `3` -> butt_up
- `4` -> jump

### Studio controls
- Speed slider -> `speed` action (UDP 0-10) + serial `speed=0.0..1.0`
- Height slider -> `height` action (UDP 0-100) + serial `hgt=50..120`
- Joint amplitude slider -> serial `step_h=10..45`
- Gait buttons -> walk / trot / stomp
- Firmware Console -> raw serial command passthrough (`status`, `help`, `pid_*`, `imu_cal`, `prov ...`)

### Transport behavior
- App sends UDP envelope using `eventName: control_action`.
- When USB COM is connected, app also sends serial command equivalent where available.

## Implementation status (2026-04-02)

### Completed
- Firmware Contract V1 implementation completed: gatekeeper, dedup per-source, TTL drop, provisioning lock, single-active mux, ACK routing callback, estop preemption.
- App Contract V1 sync completed:
  - Runtime parses ACK and telemetry nav_meta contract fields.
  - UI surfaces phase/transport/queue status and reject reason.
  - Provisioning phase movement guard is enforced in UI behavior.
- Contract V1 frozen in this document (command envelope, reason codes, ACK frame, telemetry nav_meta, provisioning policy).

### Remaining (release gate)
- Run integrated validation matrix and collect evidence:
  - Dedup and TTL cases.
  - Provisioning lock behavior.
  - Dual-active reject behavior.
  - Estop preemption latency budget.
  - ACK contract completeness.
  - Telemetry nav_meta correctness.
- Close PASS or FAIL signoff by Firmware Lead, App Lead, QA or Integration.

### Exit criteria
- All Contract V1 reject paths produce valid ACK with matching `ack_id`.
- No movement resumes after estop in flood scenario.
- Watchdog and transport phase transitions are visible and consistent in UI.
