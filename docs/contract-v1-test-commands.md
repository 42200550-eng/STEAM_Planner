# Contract V1 Sequential Test Commands

This runbook is designed for quick execution of Contract V1 integration validation.
Use it together with [contract_v1_test_report.md](../contract_v1_test_report.md) and mark each test case after collecting evidence.

## 0. Preconditions

- Firmware flashed with Contract V1 build.
- Robot powered and reachable via USB (serial) and WiFi (UDP path through gateway).
- App workspace: d:/Download/STEAM_APP/STEAM_Planner

## 1. Start Services

Open 2 terminals in project root:

Terminal A:
```powershell
npm.cmd run dev:gateway
```

Terminal B:
```powershell
npm.cmd run dev
```

Optional (desktop+gateway combo):
```powershell
npm.cmd run dev:windows
```

## 2. App Connect Smoke

1. In app, select COM port and click KET NOI.
2. In Firmware Console (app), send:
```text
hello
telem on
```
3. Expect ACK + telemetry lines in LOG tab.

## 3. Helper: Build a WiFi command payload in PowerShell

Use this helper once in Terminal C:

```powershell
function Send-NavCmd {
  param(
    [int]$CmdId,
    [string]$Action = "forward",
    [double]$Value = 0.4,
    [int]$TtlMs = 500,
    [bool]$AckRequired = $true
  )

  $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $body = @{
    eventName = "control_action"
    payload = @{
      schema_v = 1
      cmd_id = $CmdId
      cmd_type = "move"
      source = "wifi"
      ttl_ms = $TtlMs
      ack_required = $AckRequired
      ts_client = $now
      payload = @{
        action = $Action
        value = $Value
      }
    }
    ts = $now
  } | ConvertTo-Json -Depth 8

  Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/udp-gateway" -Method Post -ContentType "application/json" -Body $body
}
```

## 4. Guardrail Tests

### 4.1 Dedup WiFi (report case 2.1)

```powershell
Send-NavCmd -CmdId 100 -Action "forward" -Value 0.4 -TtlMs 500 -AckRequired $true
Send-NavCmd -CmdId 100 -Action "forward" -Value 0.4 -TtlMs 500 -AckRequired $true
```

Expected:
- First accepted.
- Second rejected with reason code 0x02 (ERR_DUPLICATE_ID).

### 4.2 Dedup Serial (report case 2.2)

In Firmware Console, send two JSON commands with same cmd_id via serial.
Expected second rejected with 0x02.

### 4.3 Cross-channel independence (report case 2.3)

1. Send via WiFi:
```powershell
Send-NavCmd -CmdId 300 -Action "forward" -Value 0.3 -TtlMs 500 -AckRequired $true
```
2. Send same cmd_id=300 via serial.

Expected:
- Both accepted (dedup cache is per source).

### 4.4 TTL stale (report case 2.4)

```powershell
Send-NavCmd -CmdId 400 -Action "forward" -Value 0.3 -TtlMs 1 -AckRequired $true
```

Expected:
- Rejected with 0x01 (ERR_STALE_TTL).

### 4.5 Provisioning lock (report cases 2.5 and 2.6)

1. Put firmware phase into PROVISIONING (per your provisioning flow).
2. Send movement cmd (WiFi or serial) -> expect 0x03.
3. Send ESTOP -> must be accepted.

### 4.6 Dual-active reject (report case 2.7)

1. Keep WiFi as active transport.
2. Send movement from serial.

Expected:
- Reject with 0x04 (ERR_DUAL_ACTIVE).

## 5. Safety Preemption Tests

### 5.1 Movement flood then ESTOP (report cases 3.1, 3.3, 3.4)

```powershell
1..20 | ForEach-Object { Send-NavCmd -CmdId (500 + $_) -Action "forward" -Value 0.6 -TtlMs 800 -AckRequired $true }
```

Then immediately send ESTOP from app safety button or serial command.

Expected:
- Robot stops immediately.
- No movement resumes after stop.
- ESTOP passes even during PROVISIONING.

### 5.2 Measure ESTOP latency (report case 3.2)

- Capture timestamp at send and first motor-stop observable event.
- Record measured latency in report.

## 6. ACK Contract Checks (report section 4)

For each accept/reject scenario verify:

- ack_id equals original cmd_id.
- reason_code matches behavior.
- phase/transport fields are accurate.
- If ack_required=true and accepted, ACK status is OK.
- If ack_required=false and accepted, ACK may be omitted by design.

## 7. Telemetry nav_meta Checks (report section 5)

Observe telemetry stream and confirm fields exist and change correctly:

- transport
- phase
- q_depth
- drp_pkts
- watchdog_age_ms
- last_err_code
- last_err_text

Force transitions (WiFi down/up) and verify:

- WIFI_PRIMARY -> SERIAL_FALLBACK -> WIFI_PRIMARY
- drp_pkts increments on rejected commands
- watchdog_age_ms resets when valid WiFi command arrives

## 8. Signoff Gate

Mark PASS only when all are true:

1. All reject paths return valid ACK with matching ack_id.
2. No movement resumes after estop flood scenario.
3. UI shows phase/transport transitions consistently with telemetry.
4. Required report sections are filled with evidence.

## 9. Evidence Collection Tips

- Keep LOG tab visible and record screenshots for each reject reason code.
- Save terminal output for gateway requests.
- Note firmware build hash/version in report header.
