# Firmware Blocker Handoff: Watchdog Keepalive Not Latched

## Update 2026-04-03 (Clean V3 rollout)

- Integration direction is now aligned to `APP_PROTOCOL_CLEAN_V3.md` from firmware team.
- COM operational scope is aligned to [App COM Mission Profile V1](app-com-mission-profile-v1.md).
- App control path has been migrated to single-frame `control_action` V3 sending for runtime commands.
- Legacy Wi-Fi control fanout/raw-text/mixed envelope paths have been removed from app runtime control flow.
- Remaining blocker validation now focuses on strict ACK correlation (`ack_id == cmd_id`) and confirmed execution of canonical actions (`sit/stretch/butt_up/jump/...`) over Wi-Fi-only control.

## Severity

- Priority: Blocker
- Impact: Robot drops from ARM to HOLD even when app receives repeated `ACK OK`.
- Scope: Current firmware build used in Windows app integration tests.

## Observed behavior (field)

1. Operator presses ARM.
2. UI receives repeated ACK lines (`ACK OK ...`).
3. Robot still falls back to HOLD after watchdog window.

Representative log pattern from app:

```text
ACK OK id=- code=0x00 reason=unknown
ACK OK id=- code=0x00 reason=unknown
...
```

Key anomaly:
- `ack_id` is missing (`id=-`) even when `ack_required=true` keepalive probes are sent.

## Why this is blocking

- App cannot correlate ACK to the exact keepalive `cmd_id` without `ack_id`.
- Current ACK stream may be generic or unrelated, so keepalive success is ambiguous.
- Safety-compliant keepalive actions (`heartbeat`, `status`) do not prevent ARM->HOLD in field tests.

## Required firmware fixes (must-have)

1. ACK correlation compliance:
   - When `ack_required=true`, ACK must include `ack_id` exactly equal to incoming `cmd_id`.
2. Keepalive lease compliance:
   - Valid keepalive action (`payload.action=heartbeat`) must refresh watchdog lease used to prevent HOLD fallback.
3. ACK reason normalization:
   - `reason_code=0x00` should map to `reason_text=ok`.
4. Telemetry coherence:
   - `nav_meta.watchdog_age_ms` must drop/reset after accepted keepalive.

## Explicit non-requirements (safety guard)

- Do not map keepalive to motion/system side effects.
- Do not require auto-ARM keepalive as a workaround.

## Contract reference

- Keepalive contract: [keepalive-contract-v1.md](keepalive-contract-v1.md)
- Handoff baseline: [embedded-handoff-windows-robot.md](embedded-handoff-windows-robot.md)

## Firmware validation checklist (for re-test)

1. Keepalive `ack_required=true` returns ACK with matching `ack_id`.
2. `watchdog_age_ms` remains under lease threshold during sustained keepalive.
3. No ARM->HOLD fallback while keepalive is valid.
4. No motion/safety state change caused by keepalive frames.
5. `reason_code=0x00` emitted with `reason_text=ok`.

## Suggested quick test command (gateway path)

Send periodic keepalive with unique `cmd_id` and verify ACK id match:

```json
{
  "eventName": "control_action",
  "payload": {
    "schema_v": 1,
    "cmd_id": 30001,
    "cmd_type": "config",
    "source": "wifi",
    "ttl_ms": 1200,
    "ack_required": true,
    "ts_client": 1711910000000,
    "payload": { "action": "heartbeat", "lease_ms": 1500 }
  },
  "ts": 1711910000000
}
```

Expected ACK (shape):

```json
{
  "type": "ack",
  "ack_id": 30001,
  "status": "OK",
  "reason_code": 0,
  "reason_text": "ok"
}
```

## Firmware team update (reported 2026-04-02)

Firmware team reported the following completion status:

1. Firmware build from current build directory: completed.
2. Keepalive path and ACK correlation implemented in `wifi_http_server.c`.
3. Focused file checks for protocol and safety manager: no errors.
4. `ctest` output in this workspace: `No tests were found` (no test definitions declared).

Current status: firmware fix is reported complete, pending app-side integration re-verification with live robot.

## Integration re-verification result (2026-04-02 18:56-18:57)

Result: FAIL (blocker persists).

Observed evidence:

1. Repeated keepalive ACK lines still show missing id (`ACK OK id=- code=0x00 reason=ok`).
2. App correlation check logs repeated mismatches:
   - `WDG hb_ack_unmatched • got=- expected=...`
3. Watchdog still degrades to error:
   - `WDG fallback_error • streak=10`

Interpretation:

- ACK correlation is still not contract-compliant at runtime (missing `ack_id`).
- Keepalive cannot be verified as accepted per-cmd.
- End-to-end fix is NOT complete in current flashing build.

Status override: BLOCKER remains OPEN.

## Firmware workaround applied (reported 2026-04-02)

Firmware team reported a workaround in `components/control/control_loop.c`:

1. Link watchdog default set to disabled.
2. Source policy now forces watchdog globally disabled.
3. No automatic HOLD transition on keepalive loss (WiFi or USB).

Operational effect:

- ARM/HOLD drops due to keepalive timeout are removed.

Safety impact (important):

- This is a safety regression versus intended watchdog design.
- Robot will no longer auto-enter HOLD on command-link loss.

Status with workaround:

- Functional control: unblocked.
- Safety-compliant contract closure: still pending until watchdog behavior is restored with correct keepalive/ACK correlation semantics.

## Re-test pass gate (agreed)

Mark this blocker PASS only when all three signals are observed together:

1. ACK correlation is valid:
   - `ack_required=true` requests return ACK with `ack_id == cmd_id`.
2. No correlation mismatch warnings:
   - No `WDG hb_ack_unmatched` lines caused by missing or wrong `ack_id`.
3. Watchdog lease is demonstrably refreshed:
   - `nav_meta.watchdog_age_ms` drops after accepted heartbeat, and
   - no `fallback_error` streak growth while heartbeat traffic is continuous.

## App-side closeout checks (required now)

1. Verify keepalive ACK lines include concrete `ack_id` (not `-`) and match sent `cmd_id`.
2. Hold ARM for at least 30 seconds with active keepalive; robot must not auto-fall to HOLD.
3. Confirm telemetry `watchdog_age_ms` remains below watchdog threshold during the hold period.
4. Confirm no keepalive-triggered state oscillation and safety commands still preempt.
