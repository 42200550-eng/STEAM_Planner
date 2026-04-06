<div align="center">
  <img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# STEAM Planner

Ứng dụng điều khiển robot dog của URLAB, hỗ trợ:
- Giao diện dashboard React/Vite để điều khiển và theo dõi telemetry.
- Cầu nối UDP Gateway (`/api/udp-gateway`) để chuyển lệnh từ app sang robot qua UDP.
- Runtime desktop Electron cho Windows, có tích hợp COM service phục vụ provisioning/diagnostics.

## Kiến trúc nhanh

- `src/`: frontend React (dashboard, điều khiển, watchdog, telemetry).
- `server/gateway.mjs`: HTTP gateway chuyển tiếp lệnh UDP đến robot.
- `server/udp-simulator.mjs`: UDP simulator để test local.
- `electron/`: main process + preload cho bản desktop Windows.
- `docs/`: đặc tả contract tích hợp app/firmware.

## Yêu cầu môi trường

- Node.js >= 20 (khuyến nghị dùng bản LTS).
- npm.
- Windows + PowerShell nếu chạy chế độ desktop COM (`dev:windows`).

## Cài đặt

```bash
npm install
```

Tạo file môi trường local từ mẫu:

```bash
cp .env.example .env.local
```

Thiết lập tối thiểu trong `.env.local`:
- `GEMINI_API_KEY`
- `GATEWAY_PORT` (mặc định `8787`)
- `ROBOT_UDP_HOST` (mặc định `127.0.0.1`)
- `ROBOT_UDP_PORT` (mặc định `9000`)

## Chạy local (Web + UDP)

Mở 3 terminal:

1) Chạy UDP simulator:
```bash
npm run dev:sim
```

2) Chạy UDP gateway:
```bash
npm run dev:gateway
```

3) Chạy frontend:
```bash
npm run dev
```

Frontend chạy tại `http://localhost:3000` (được cấu hình trong script `npm run dev`), gateway mặc định `http://localhost:8787`.

Kiểm tra health gateway:

```bash
curl http://localhost:8787/api/health
```

## Chạy desktop Windows (Electron)

Chạy đồng thời gateway + desktop app:

```bash
npm run dev:windows
```

Luồng sử dụng điển hình:
1. Kết nối COM để provisioning/diagnostics.
2. Cấu hình Wi-Fi cho robot.
3. Chuyển qua điều khiển runtime qua Wi-Fi (UDP).

## Build

Build web:

```bash
npm run build
```

Build Windows installer:

```bash
npm run build:desktop
```

Artifact mặc định:
- `release/steam-planner-<version>-setup.exe`

Build bản portable:

```bash
npm run build:desktop:portable
```

## Scripts chính

- `npm run dev`: chạy frontend Vite.
- `npm run dev:gateway`: chạy HTTP -> UDP gateway.
- `npm run dev:sim`: chạy UDP simulator local.
- `npm run dev:desktop`: chạy frontend + Electron.
- `npm run dev:windows`: chạy gateway + desktop (Windows workflow).
- `npm run lint`: kiểm tra TypeScript (`tsc --noEmit`).
- `npm run clean`: xóa `dist` và `release`.

## Tài liệu kỹ thuật liên quan

- [Embedded Team Handoff](docs/embedded-handoff-windows-robot.md)
- [Keepalive Contract V1](docs/keepalive-contract-v1.md)
- [App COM Mission Profile V1](docs/app-com-mission-profile-v1.md)
- [Contract V1 Test Commands](docs/contract-v1-test-commands.md)

## Gợi ý test nhanh với robot thật (Windows)

PowerShell:

```powershell
$env:ROBOT_UDP_HOST='192.168.4.1'
$env:ROBOT_UDP_PORT='9000'
npm run dev:windows
```
