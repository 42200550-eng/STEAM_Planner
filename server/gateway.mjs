import dgram from 'node:dgram';
import process from 'node:process';
import dotenv from 'dotenv';
import express from 'express';

dotenv.config();

const app = express();
app.use(express.json({ limit: '256kb' }));

const udpHost = process.env.ROBOT_UDP_HOST || '127.0.0.1';
const udpPort = Number(process.env.ROBOT_UDP_PORT || 9000);
const gatewayPort = Number(process.env.GATEWAY_PORT || 8787);

const socket = dgram.createSocket('udp4');

socket.on('error', (err) => {
  console.error('[gateway] UDP socket error:', err.message);
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'urlab-udp-gateway',
    udpHost,
    udpPort,
    now: Date.now(),
  });
});

app.post('/api/udp-gateway', async (req, res) => {
  const { eventName, payload, ts } = req.body ?? {};

  if (!eventName || typeof eventName !== 'string') {
    res.status(400).json({ ok: false, error: 'eventName is required' });
    return;
  }

  const packet = {
    eventName,
    payload: payload ?? {},
    ts: typeof ts === 'number' ? ts : Date.now(),
  };

  const encoded = Buffer.from(JSON.stringify(packet), 'utf8');

  socket.send(encoded, udpPort, udpHost, (error) => {
    if (error) {
      res.status(500).json({ ok: false, error: error.message });
      return;
    }

    res.json({
      ok: true,
      forwardedTo: `${udpHost}:${udpPort}`,
      bytes: encoded.byteLength,
      eventName,
    });
  });
});

app.listen(gatewayPort, () => {
  console.log(`[gateway] listening on http://localhost:${gatewayPort}`);
  console.log(`[gateway] forwarding UDP packets to ${udpHost}:${udpPort}`);
});
