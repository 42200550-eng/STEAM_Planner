# App F1-F5 Regression Pack

Status: Active
Date: 2026-04-06
Owner: App Team
Scope: Router-first single robot, ARM only at STA primary, COM service-only

## 0. A1-A4 delivery status

Completed in app implementation:
- A1 Permission Engine Refactor: runtime gating is signal-driven (`isWifiConnected`, `linkMode`, `capability.can_arm`, `capability.can_motion`).
- A2 UI Simplification: manual Workshop/Field runtime toggle removed; COM service and Wi-Fi runtime controls are shown together with independent connect buttons.
- A3 COM Flash/Provision Wizard: service wizard path now exists in WiFi panel with steps Detect -> Flash Done -> Provision Save -> Reboot -> Auto Discover IP.
- A4 Error/Recovery UX: ACK code mapping now provides explicit operator guidance for firmware codes (including 108 not STA primary).

Limit note for A3:
- Flash execution is still operator-driven from firmware toolchain, and app wizard provides checkpoint flow (`FLASH DONE`) before provisioning/reboot/discovery.

## 1. Automated smoke tests (P2)

Run in project root:

```powershell
npm.cmd run test:run
```

Current smoke coverage:
- ACK code mapping for firmware taxonomy (including code 108 reject_not_sta)
- Capability parser (`can_arm`, `can_motion`, `can_service`, `calib_write_requires_com`)
- UI gating rules used by app for ARM/motion enablement

Test file:
- `src/lib/firmwareContract.test.ts`

## 1.1 Best-practice Wi-Fi connect flow (known IP)

Use this when robot IP is already known (example `192.168.137.150`):

1. In app WiFi panel, set:
- Runtime Target IP = `192.168.137.150`
- Runtime Target Port = `9000`
2. Click `KET NOI WIFI` in header.
3. Verify status line shows `WIFI RUNTIME ONLINE` and `LINK ...` not `DISCONNECTED`.
4. Verify capability snapshot updates (`can_arm`, `can_motion`) before ARM/motion tests.

Notes:
- Gateway now supports per-request target override (`targetHost`, `targetPort`), so no gateway restart is needed when switching robot IP.
- `USE DETECTED IP` button can auto-fill runtime target from latest telemetry/link_status.

Reference spec for firmware verification:
- [App Wi-Fi Connection Spec F1-F5](app-wifi-connection-spec-f1-f5.md)

## 2. Manual regression matrix (release gate)

### Case A: AP fallback rejects ARM
1. Put robot in AP fallback.
2. Ensure app shows capability `can_arm=0`.
3. Send ARM from UI.

Expected:
- ARM button disabled, or ARM command rejected.
- If command reaches firmware, ACK code must be `108`.
- UI guidance must indicate: connect robot to router STA first.

### Case B: STA primary enables ARM
1. Move robot to STA primary.
2. Wait until capability `can_arm=1`.
3. Send ARM.

Expected:
- ACK code `0`.
- Runtime state transitions to armed/running flow.

### Case C: Motion gating follows capability + armed
1. Keep `can_motion=0` and try gait/sliders/movement.
2. Set `can_motion=1` but keep robot not armed and retry.
3. Arm robot and retry.

Expected:
- Step 1 blocked.
- Step 2 blocked.
- Step 3 allowed.

### Case D: COM service-only runtime isolation
1. In Workshop mode, run calibration/provision command over COM.
2. In Workshop mode, attempt runtime movement action.

Expected:
- Service command accepted.
- Runtime command blocked by app policy.

### Case E: Calib write requires COM
1. Validate capability `calib_write_requires_com=1`.
2. Attempt calibration write in Field mode.
3. Attempt calibration write in Workshop mode via COM.

Expected:
- Field path blocked.
- Workshop COM path succeeds.

## 3. Evidence checklist

For each case, capture:
- LOG lines containing `ACK`, `ack_id`, `code`, and capability snapshot.
- App state line: `LINK ...` and `CAP can_arm=... can_motion=...`.
- Firmware version and robot id from header status.

## 4. Exit criteria

Release candidate can pass only if all conditions are true:
1. ACK code 108 appears for ARM in non-STA conditions.
2. ARM is accepted only when capability and link state are both valid.
3. Motion controls follow `can_motion && armed`.
4. COM keeps service mission only (no runtime ownership).
5. Automated smoke test command remains green in CI/local.
