import dgram from 'node:dgram';
import process from 'node:process';
import dotenv from 'dotenv';
import express from 'express';

dotenv.config();

const app = express();

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  next();
});

app.use(express.json({ limit: '256kb' }));

const udpHost = process.env.ROBOT_UDP_HOST || '127.0.0.1';
const udpPort = Number(process.env.ROBOT_UDP_PORT || 9000);
const gatewayPort = Number(process.env.GATEWAY_PORT || 8787);
const udpReplyTimeoutMs = Math.max(50, Number(process.env.ROBOT_UDP_RESPONSE_TIMEOUT_MS || 220));

function tryParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function forwardUdpWithOptionalReply(encoded, options = {}) {
  const awaitReply = options.awaitReply !== false;

  return new Promise((resolve, reject) => {
    const requestSocket = dgram.createSocket('udp4');
    let settled = false;

    const finalize = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      requestSocket.close();
      resolve(result);
    };

    requestSocket.once('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      requestSocket.close();
      reject(error);
    });

    let timeoutId = null;
    if (awaitReply) {
      timeoutId = setTimeout(() => {
        finalize({
          replyTimedOut: true,
          udpReplyRaw: null,
          udpReply: null,
          replyFrom: null,
          forwardedWithoutReply: false,
        });
      }, udpReplyTimeoutMs);

      requestSocket.once('message', (message, rinfo) => {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
        }
        const raw = message.toString('utf8').trim();
        finalize({
          replyTimedOut: false,
          udpReplyRaw: raw,
          udpReply: tryParseJson(raw),
          replyFrom: `${rinfo.address}:${rinfo.port}`,
          forwardedWithoutReply: false,
        });
      });
    }

    requestSocket.bind(0, '0.0.0.0', () => {
      requestSocket.send(encoded, udpPort, udpHost, (error) => {
        if (error) {
          if (timeoutId !== null) {
            clearTimeout(timeoutId);
          }
          if (settled) {
            return;
          }
          settled = true;
          requestSocket.close();
          reject(error);
          return;
        }

        if (!awaitReply) {
          finalize({
            replyTimedOut: false,
            udpReplyRaw: null,
            udpReply: null,
            replyFrom: null,
            forwardedWithoutReply: true,
          });
        }
      });
    });
  });
}

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
  const { frame, eventName, payload, ts, awaitReply } = req.body ?? {};
  const hasFrame = frame && typeof frame === 'object' && !Array.isArray(frame);
  const hasLegacyEnvelope = typeof eventName === 'string' && eventName.trim().length > 0;

  if (!hasFrame && !hasLegacyEnvelope) {
    res.status(400).json({ ok: false, error: 'frame is required' });
    return;
  }

  const packet = hasFrame
    ? frame
    : {
        eventName,
        payload: payload ?? {},
        ts: typeof ts === 'number' ? ts : Date.now(),
      };

  const encoded = Buffer.from(JSON.stringify(packet), 'utf8');

  try {
    const reply = await forwardUdpWithOptionalReply(encoded, {
      awaitReply: awaitReply !== false,
    });
    res.json({
      ok: true,
      forwardedTo: `${udpHost}:${udpPort}`,
      bytes: encoded.byteLength,
      eventName: hasFrame ? 'frame' : eventName,
      replyTimedOut: reply.replyTimedOut,
      replyFrom: reply.replyFrom,
      udpReplyRaw: reply.udpReplyRaw,
      udpReply: reply.udpReply,
      forwardedWithoutReply: reply.forwardedWithoutReply,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'udp forward failed';
    res.status(500).json({ ok: false, error: message });
  }
});

app.listen(gatewayPort, () => {
  console.log(`[gateway] listening on http://localhost:${gatewayPort}`);
  console.log(`[gateway] forwarding UDP packets to ${udpHost}:${udpPort}`);
});
