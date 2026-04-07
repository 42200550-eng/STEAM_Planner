# App Wi-Fi Connection Spec (F1-F5 Verification)

Status: Ready for firmware verification
Date: 2026-04-07
Owner: App Team
Scope: Wi-Fi runtime connection and control path in desktop app

## 1) Goal

Define the exact Wi-Fi connection behavior implemented in app so firmware team can verify end-to-end interoperability against F1-F5 handoff.

## 2) Transport Topology

- App UI sends runtime commands to local gateway HTTP API.
- Gateway forwards UDP packets to robot runtime target.
- Runtime target can be overridden per request by app (targetHost, targetPort).

HTTP gateway endpoint:
- POST /api/udp-gateway

Gateway behavior:
- Accepts request body with frame object.
- Supports per-request target override:
  - targetHost: string
  - targetPort: number
- If override absent, falls back to environment ROBOT_UDP_HOST and ROBOT_UDP_PORT.

## 3) Runtime Target (Known IP flow)

App Wi-Fi panel fields:
- Runtime Target IP
- Runtime Target Port

Validation before Wi-Fi connect:
- targetHost must be non-empty
- targetPort must be 1..65535

Persistence:
- Saved in local storage key: steam_planner_runtime_udp_target_v1
- Loaded automatically on app restart

## 4) Wi-Fi Connect Procedure

Triggered by pressing KET NOI WIFI button.

If currently connected:
- App clears last Wi-Fi ACK and telemetry timestamps
- App sets connection state to DISCONNECTED

If currently disconnected:
- App performs up to 3 handshake attempts
- Each attempt sequence:
  1. Send control action status (await reply)
  2. Send control action status again (await reply)
- Success condition (strict):
  - Receive at least one valid robot ACK for status where:
    - ACK frame type is accepted by parser (control_ack or ack)
    - ack_id matches sent cmd_id
    - code/reason_code equals 0
  - Receive at least one valid telemetry frame within 2 seconds of handshake attempt
- Failure condition:
  - If gateway only returns HTTP ok but no valid robot ACK/telemetry, handshake is FAIL
- Failure condition:
  - All attempts fail => app shows handshake fail to targetHost:targetPort

## 5) Command Envelope Sent To Firmware

App sends canonical frame to gateway under body.frame:
- type: control_action
- schema_v: 3
- cmd_id: monotonic integer
- ts_client: epoch ms
- ack_required: true
- ttl_ms: 1200
- action: one of runtime actions (status, arm, hold, estop, stop, move/action/gait/speed/height)
- params: optional object, includes value for scalar actions

Gateway forwards frame as UDP JSON payload unchanged.

## 6) Connection State Machine In App

States:
- DISCONNECTED
- LINK_REACHABLE
- READY_AP_FALLBACK
- READY_STA_PRIMARY
- DEGRADED

Inputs:
- wifiAckAt (last accepted ACK timestamp)
- wifiTelemetryAt (last telemetry timestamp)
- linkMode (sta_primary or ap_fallback)

Thresholds:
- ackWindowMs = 1100 (recommended range 1000-1200)
- telemetryFreshMs = 1800 (recommended range 1500-2000)
- degradedMs = 5000

Transitions:
- READY_AP_FALLBACK or READY_STA_PRIMARY:
  - ACK fresh and telemetry fresh
  - branch by linkMode
- LINK_REACHABLE:
  - ACK fresh but telemetry not fresh
- DEGRADED:
  - has evidence but outside fresh windows and still within degraded window
- DISCONNECTED:
  - no fresh evidence

## 7) Firmware Response Expectations

### 7.0 Canonical capability format (current firmware)

Firmware currently sends capability in telemetry JSON under `capability` with snake_case boolean keys:

```json
{
  "capability": {
    "can_arm": true,
    "can_motion": true,
    "can_service": true,
    "calib_write_requires_com": true
  }
}
```

Contract note:
- This is the primary expected format for F1-F5 verification.
- App parser remains tolerant to compatibility variants, but firmware should keep the canonical format above.

### 7.0.1 Serial link_status text format

Firmware serial diagnostic output uses numeric flags (0/1), for example:

```text
capability: can_arm=0 can_motion=0 can_service=1 calib_write_requires_com=1
```

Parsing rule:
- `1` => true
- `0` => false

Firmware reference:
- `Firmware-C-ESP32/components/protocol/protocol_service.c`

### 7.0.2 Internal robot link status source

Firmware sets boolean capability fields in `robot_link_get_status`:
- can_arm
- can_motion
- can_service
- calib_write_requires_com

Firmware reference:
- `Firmware-C-ESP32/components/protocol/wifi_http_server.c`

### 7.0.3 ACK payload scope

Capability is not part of ACK payload.

Capability sources are:
- telemetry JSON (`capability` object)
- serial `link_status` text line

### 7.1 Minimal parser compatibility contract

ACK accepted keys (tolerant):
- frame/event/type: one of `control_ack`, `ack`
- ack_id or cmd_id
- ok or status
- code or reason_code
- msg or reason_text

Telemetry accepted keys (tolerant):
- frame/event/type: one of `telemetry`, `telemetry_update`
- or robot_state present
- link_mode if available
- capability object at top-level or nested payload

Compatibility mode requirement:
- App parser must accept both `control_ack` and `ack` formats during firmware transition periods.

For control decision path:
- event: control_ack
- ack_id equals cmd_id
- ok boolean
- code numeric reason code (0, 100, 102, 103, 105, 107, 108)
- msg optional text
- link_mode optional (sta_primary or ap_fallback)

For telemetry/state path:
- event telemetry or robot_state present
- capability object may appear at top-level or inside payload:
  - capability.can_arm
  - capability.can_motion
  - capability.can_service
  - capability.calib_write_requires_com

### 7.2 Capability update bottleneck (root-cause narrative)

Observed production symptom:
- Firmware side capability has changed, but app still shows:
  - `CAPABILITY can_arm=0 can_motion=0 can_service=1 ...`
- At the same time, control ACK remains healthy (`ACK OK code=0`).

Why this can happen even when firmware is correct:

1. Split response channels:
- ACK is returned on control path (`control_ack`).
- Capability is returned on telemetry/link_status path (not in ACK).

2. Handshake success can be ACK-dominant:
- App may receive repeated ACK frames quickly.
- Telemetry frames with capability may be delayed, dropped, or not routed back in the same burst window.

3. State machine dependency:
- `wifiAckAt` updates from ACK.
- `wifiTelemetryAt` does not update if telemetry frame is not observed.
- Capability store in app remains stale until telemetry/link_status parser receives fresh capability fields.

4. Permission side effect:
- If capability is stale (`can_arm=0`, `can_motion=0`), app-level gating can block motion even though firmware already switched capability internally.

Where the pipeline is blocked (exact choke points):
- Choke A (network/transport): gateway receives ACK but misses follow-up telemetry frame in response burst.
- Choke B (routing/NIC): UDP reply from telemetry path does not return via expected interface while ACK does.
- Choke C (parser input starvation): parser is correct, but it never sees a frame carrying capability keys.
- Choke D (timing window): telemetry arrives outside the app freshness window, so UI keeps stale CAP snapshot.

Important contract clarification:
- This is not evidence that firmware capability was not updated.
- It is evidence that capability-bearing frames did not complete the app ingestion path.

Current app mitigations for this bottleneck:
- Gateway captures UDP reply bursts (not first packet only).
- App parses both primary reply and bundled supplemental replies.
- During Wi-Fi handshake, app requests COM `link_status` as fallback to refresh capability when telemetry is missing.
- Safety fallback allows ARM/motion validation by firmware ACK when capability telemetry is stale (while still preferring fresh capability).

## 8) App Permission Engine (Signal-driven)

ARM button enabled only when all true:
- Wi-Fi connected (connection state not DISCONNECTED)
- linkMode is sta_primary
- capability.can_arm is true

Motion controls enabled only when all true:
- Wi-Fi connected
- capability.can_motion is true
- robot armed state is true

Stale-capability fallback behavior (runtime mitigation):
- When telemetry/capability is stale for an extended window, app can temporarily allow ARM and motion by fallback path.
- Final authority remains firmware ACK/reject codes.
- This avoids deadlock where firmware is ready but capability telemetry has not reached app yet.

No manual Workshop/Field runtime toggle is used for runtime gating.

## 9) ACK Code To Recovery Guidance

App maps firmware ACK codes to operator guidance:
- 108 reject_not_sta:
  - Robot not STA primary, connect robot to router first
- 107 not_armed:
  - Arm robot when can_arm is true
- 105 queue_or_parse:
  - Reduce command rate and retry
- 103 duplicate:
  - Duplicate cmd id; app issues new command id on retry
- 102 ttl_expired:
  - Check network delay/jitter
- 100 bad_payload:
  - Schema mismatch; check contract alignment

## 10) Verification Matrix For Firmware Team

Case A: Known IP handshake
- Set Runtime Target IP to robot STA IP
- Press KET NOI WIFI
- Pass only when at least:
  - 1 valid ACK (ack_id match, code=0)
  - 1 valid telemetry frame
  - all within 2 seconds from handshake attempt
- Fail when only gateway HTTP success is present without robot ACK/telemetry

Case B: AP fallback arm reject
- Force AP fallback
- Send arm
- Expect control_ack code 108
- Expect app guidance for STA requirement

Case C: STA primary arm accept
- Move to STA primary
- capability.can_arm becomes true
- Send arm
- Expect control_ack code 0 and ack_id match

Case D: Motion gate
- With can_motion false, motion commands blocked
- With can_motion true but not armed, motion commands blocked
- With can_motion true and armed, motion commands allowed

Case E: Capability propagation
- Change capability flags on firmware side
- App status rows and CAP line must update accordingly

## 11) Gateway Observability

Gateway response includes:
- forwardedTo targetHost:targetPort
- udpReplyRaw
- udpReply (if parseable)
- udpReplies (bundled burst replies)
- replyCount (number of replies captured in burst window)
- replyTimedOut

Firmware verification should record:
- ack_id, code, msg, link_mode, capability snapshots
- targetHost/targetPort used during each test
- replyCount per request during handshake/status polling

## 12) Routing and NIC Policy (multi-homed host)

When control PC has multiple adapters (LAN/hotspot/Wi-Fi dongle):
- Gateway routing must reach targetHost on the correct interface.
- For each test, log:
  - forwardedTo (targetHost:targetPort)
  - replyFrom (robot source IP:port)
  - local interface used by gateway socket (if available from runtime diagnostics)

Debug rule:
- "Gateway HTTP ok" is not considered connectivity proof unless robot ACK and telemetry are both observed.

## 13) Recovery When Robot IP Changes

Recovery triggers:
- repeated handshake timeout
- repeated reject_not_sta (108)

Required app behavior:
- prompt operator to re-check Runtime Target IP/Port
- allow quick re-target using detected IP from latest telemetry/link_status
- re-run handshake after target update
