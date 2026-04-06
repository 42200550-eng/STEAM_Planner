# App COM Mission Profile V1

Status: Proposed
Date: 2026-04-03
Owner: Firmware + App

## COM Mission (Single Source of Truth)

COM in app has exactly one mission: prepare and service robot units until they are Wi-Fi ready; COM is not a runtime motion/control channel.

Definition of done for COM mission in one robot session:
1. Robot identity is readable (robot_id, MAC/chip id, firmware version/signature).
2. Provisioning keys are written and saved (`wifi_ssid`, `wifi_password`, `robot_id`, `control_udp_port`).
3. Required diagnostics/calibration steps are completed and persisted.
4. Robot is marked Wi-Fi-ready and can be unplugged from COM.

## Single-App Multi-Robot Operating Principle

This product targets one operator app for many robots.

Operational loop per robot:
1. Plug COM into the same app.
2. Flash and service firmware in Workshop Mode.
3. Provision identity and Wi-Fi settings.
4. Mark robot Wi-Fi-ready and unplug COM.
5. Operate that robot from the same app over Wi-Fi in Field Mode.

When switching to another robot, repeat the same COM preparation loop in the same app, then run that robot over Wi-Fi.

Hard rule:
1. COM is a preparation/service gate.
2. Runtime control ownership remains Wi-Fi-only.

## 1. Why COM Still Matters

COM is not the runtime control channel anymore, but it is critical for lifecycle operations:
1. Bring-up and first-time onboarding.
2. Firmware flashing and recovery.
3. Calibration and hardware diagnostics.
4. Fleet preparation for many robots on one app.

This separation keeps runtime control stable on Wi-Fi and prevents dual-channel command conflicts.

## 2. COM Scope (Allowed)

COM operations in app SHOULD include:
1. Flash firmware (normal, forced, rollback).
2. Read device identity:
- chip id / MAC
- firmware version/build signature
- robot_id
3. Provisioning:
- wifi_ssid
- wifi_password
- control_udp_port
- robot_id
4. Calibration:
- servo calibration
- imu calibration
- save/reset calibration
5. Diagnostics:
- status snapshot
- link status snapshot
- config dump
- sensor sanity checks
6. Recovery tools:
- enter safe/hold mode
- clear stale config
- factory restore workflow

## 3. COM Scope (Disallowed)

COM operations in app MUST NOT include runtime movement control:
1. arm/start for normal run
2. gait movement stream
3. action playback in run mode

Reason:
1. Avoid Wi-Fi/COM race conditions.
2. Keep one deterministic command owner.
3. Make multi-robot scaling possible.

## 4. App Operating Modes

### 4.1 Workshop Mode (COM)

Purpose: setup and maintenance per robot.

Allowed UI groups:
1. Flash
2. Provision
3. Calibrate
4. Diagnose

Exit criteria:
1. Firmware healthy
2. Provision saved
3. Robot reachable on Wi-Fi

### 4.2 Field Mode (Wi-Fi)

Purpose: runtime operation.

Allowed UI groups:
1. Connect/arm
2. Movement/actions
3. Telemetry

Constraint:
1. COM panel becomes read-only hint panel or hidden.

## 5. Recommended End-to-End Workflow

For one robot:
1. Connect COM.
2. Flash firmware.
3. Run COM diagnostics.
4. Calibrate if needed.
5. Provision Wi-Fi and robot_id.
6. Disconnect COM.
7. Switch to Wi-Fi and run control.

For multiple robots:
1. Repeat Workshop Mode per robot over COM once.
2. Register each robot in app inventory by robot_id + MAC.
3. In Field Mode, control each robot only via Wi-Fi endpoint.

## 6. Fleet Readiness Data Model (App Side)

Per robot, app should persist:
1. robot_id
2. chip_mac
3. firmware_version
4. firmware_signature
5. control_udp_port
6. last_known_ip
7. calibration_revision
8. provisioning_revision
9. health_state
10. last_service_time

## 7. Flash Pipeline Requirements

1. Pre-checks:
- COM port available
- device identity readable
- battery/power sanity
2. Flash stages:
- bootloader
- partition table
- app image
3. Post-checks:
- reconnect COM
- verify build signature/version
- optional quick self-test

If post-check fails:
1. offer rollback image
2. keep robot tagged as service_required

## 8. Provisioning Contract in App

COM provisioning UI should map exactly to firmware keys:
1. prov wifi_ssid=<ssid>
2. prov wifi_password=<password>
3. prov robot_id=<id>
4. prov control_udp_port=<port>
5. prov save

App must parse ACK/ERR and show per-key result.

## 9. Practical Answer to "No COM Arm = Cannot Do Anything"

You can still do all maintenance tasks through COM.
Runtime behavior is intentionally moved to Wi-Fi.

So the intended split is:
1. COM = Service and manufacturing path.
2. Wi-Fi = Operational control path.

This is the correct foundation for controlling many robots in one app.

## 10. Near-Term App Backlog

Priority P0:
1. Build Workshop Mode shell (Flash/Provision/Calib/Diag).
2. Enforce Field Mode Wi-Fi-only control.
3. Add robot inventory screen (robot_id, MAC, firmware).

Priority P1:
1. Batch provisioning assistant.
2. Firmware package manager (stable/candidate/rollback).
3. Service history per robot.

Priority P2:
1. Parallel fleet monitor over Wi-Fi telemetry.
2. Multi-robot command orchestration (staged rollout).

## 11. Acceptance Criteria

1. No COM runtime command is required for normal operation.
2. One robot can be fully prepared using COM only up to Wi-Fi-ready state.
3. After COM unplug, app controls robot over Wi-Fi with full feature set.
4. At least 5 robots can be onboarded and tracked in app inventory without protocol conflict.