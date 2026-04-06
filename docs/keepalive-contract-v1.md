# Keepalive Contract V1 (Safety-Preserving)

## Goal

Define a dedicated WiFi keepalive payload so app and firmware can keep watchdog alive **without sending motion/system control commands**.

## Non-negotiable safety rule

- Keepalive must never call or map to motion/system actions (`arm`, `hold`, `stop`, `estop`, gait, movement).
- Keepalive is transport-liveness only.
- Safety state transitions remain controlled only by explicit operator commands and firmware safety logic.

## Command envelope (fixed)

Use existing Contract V1 envelope:

```json
{
  "schema_v": 1,
  "cmd_id": 21001,
  "cmd_type": "config",
  "source": "wifi",
  "ttl_ms": 1200,
  "ack_required": false,
  "ts_client": 1711910000000,
  "payload": {
    "action": "heartbeat",
    "lease_ms": 1500
  }
}
```

## Field semantics

- `cmd_type`: `config` (never `system` for keepalive)
- `payload.action`: must be exact string `heartbeat`
- `payload.lease_ms`: requested watchdog lease window from app (default `1500`)
- `ack_required`: `false` for periodic heartbeat

## Firmware handling

On valid keepalive frame:

1. Validate envelope and source (`wifi`).
2. Validate `payload.action == heartbeat`.
3. Refresh WiFi watchdog lease with `lease_ms` bounded by firmware limits.
4. Do not alter robot motion/safety state.
5. Update telemetry `nav_meta.watchdog_age_ms` accordingly.

On invalid keepalive frame:

- Ignore frame or reject with standard malformed code (`0x05`), but do not change motion state.

## Optional ACK behavior

- Periodic keepalive: `ack_required=false` and ACK may be omitted.
- Diagnostic probe keepalive: app may send one-off with `ack_required=true` for connectivity diagnostics.

Example diagnostic probe:

```json
{
  "schema_v": 1,
  "cmd_id": 21999,
  "cmd_type": "config",
  "source": "wifi",
  "ttl_ms": 1200,
  "ack_required": true,
  "ts_client": 1711910000500,
  "payload": {
    "action": "heartbeat",
    "lease_ms": 1500
  }
}
```

Expected ACK when requested:

```json
{
  "type": "ack",
  "ack_id": 21999,
  "status": "OK",
  "reason_code": 0,
  "reason_text": "ok",
  "phase": "WIFI_PRIMARY",
  "transport": "wifi",
  "fw_ts": 1205166
}
```

## App runtime knobs

Use current app env to enable this contract:

- `VITE_WATCHDOG_HEARTBEAT_ACTION=heartbeat`
- `VITE_WATCHDOG_TIMEOUT_MS=1500`
- `VITE_WATCHDOG_HEARTBEAT_MS=300`
- `VITE_WATCHDOG_FALLBACK_MS=3000`

## Acceptance checklist

1. Repeated keepalive does not change `state` (`idle/running/hold/estop`).
2. Keepalive loss causes watchdog fallback only after configured lease expires.
3. Recovered keepalive updates `watchdog_age_ms` back to low values.
4. No ARM/HOLD oscillation when keepalive is enabled.
5. Safety commands still preempt as before (`estop`, `stop`).

## Firmware validation note (2026-04-02)

Feedback from firmware team against this checklist:

1. Keepalive does not change robot state: PASS.
2. Watchdog lease is refreshed by bounded `lease_ms`: PASS.
3. `watchdog_age_ms` present in telemetry: PASS.
4. No ARM/HOLD oscillation introduced by keepalive: PASS by design.
5. Safety preemption behavior remains unchanged: PASS.

Status: keepalive payload and handling are aligned for integration rollout.

## Field blocker update (2026-04-02, later run)

Later integration runs show a blocker on current firmware build:

1. App receives repeated `ACK OK`, but `ack_id` is missing (`id=-`).
2. Robot can still fall back from ARM to HOLD despite keepalive traffic.
3. This indicates ACK correlation and or watchdog lease refresh are not verifiable end-to-end.

Until firmware emits ACK with matching `ack_id` and verified lease refresh behavior,
integration status should be treated as BLOCKED (not rollout-ready).

Detailed handoff package:
- [firmware-watchdog-blocker-2026-04-02.md](firmware-watchdog-blocker-2026-04-02.md)

## Firmware completion report (2026-04-02)

Firmware team reported:

1. Build completed successfully from existing build directory.
2. Keepalive and ACK correlation updated in `wifi_http_server.c`.
3. No errors found in focused protocol and safety manager files.
4. `ctest` currently shows `No tests were found` in this workspace.

Contract status: firmware change reported complete, integration verification in app is the final gate.
