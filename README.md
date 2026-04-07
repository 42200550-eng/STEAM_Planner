## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Start UDP simulator (Terminal 1):
   `npm run dev:sim`
4. Start UDP gateway (Terminal 2):
   `npm run dev:gateway`
5. Run the app (Terminal 3):
   `npm run dev`

## Run P2 Smoke Tests

Execute firmware-contract smoke tests:

`npm.cmd run test:run`

## UDP Gateway (Round 3+)

- Frontend emits events to `/api/udp-gateway`
- Vite proxies `/api/*` to `http://localhost:8787`
- Gateway forwards JSON payloads as UDP packets to `ROBOT_UDP_HOST:ROBOT_UDP_PORT`

Quick health check:
`curl http://localhost:8787/api/health`

If ports are occupied, run with overrides:
- PowerShell gateway: `$env:GATEWAY_PORT='8788'; $env:ROBOT_UDP_PORT='9010'; npm run dev:gateway`
- PowerShell simulator: `$env:ROBOT_UDP_PORT='9010'; npm run dev:sim`

## Windows Desktop Build (Electron)

Build Windows installer:
`npm run build:desktop`

Installer output:
- `release/steam-planner-0.0.0-setup.exe`

## Quick Test With Real Robot (Windows)

1. Configure robot target in PowerShell:
   - `$env:ROBOT_UDP_HOST='192.168.4.1'`
   - `$env:ROBOT_UDP_PORT='9000'`
2. Start gateway + desktop app:
   - `npm run dev:windows`
3. In app, connect and verify telemetry + command flow.
