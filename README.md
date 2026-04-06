<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/6da9e705-9a1a-46a6-a553-d5a90eceeee7

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
