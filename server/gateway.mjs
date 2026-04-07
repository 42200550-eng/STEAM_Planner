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
const udpReplyTimeoutMs = Math.max(100, Number(process.env.ROBOT_UDP_RESPONSE_TIMEOUT_MS || 900));
const udpBurstSettleMs = Math.max(80, Number(process.env.ROBOT_UDP_BURST_SETTLE_MS || 320));

function normalizeTargetHost(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  // Keep validation permissive so hostnames and IPv4/IPv6 can be passed through.
  return normalized.length <= 255 ? normalized : null;
}

function normalizeTargetPort(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  const normalized = Math.round(numeric);
  if (normalized < 1 || normalized > 65535) {
    return null;
  }

  return normalized;
}

function tryParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function forwardUdpWithOptionalReply(encoded, options = {}) {
  const awaitReply = options.awaitReply !== false;
  const targetHost = normalizeTargetHost(options.targetHost) || udpHost;
  const targetPort = normalizeTargetPort(options.targetPort) || udpPort;

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
    let settleTimeoutId = null;
    const replies = [];

    const completeWithReplies = () => {
      if (replies.length === 0) {
        finalize({
          replyTimedOut: true,
          udpReplyRaw: null,
          udpReply: null,
          replyFrom: null,
          forwardedWithoutReply: false,
          udpReplies: [],
          replyCount: 0,
        });
        return;
      }

      const first = replies[0];
      finalize({
        replyTimedOut: false,
        udpReplyRaw: first.raw,
        udpReply: first.parsed,
        replyFrom: first.replyFrom,
        forwardedWithoutReply: false,
        udpReplies: replies,
        replyCount: replies.length,
      });
    };

    if (awaitReply) {
      timeoutId = setTimeout(() => {
        if (settleTimeoutId !== null) {
          clearTimeout(settleTimeoutId);
          settleTimeoutId = null;
        }
        completeWithReplies();
      }, udpReplyTimeoutMs);

      requestSocket.on('message', (message, rinfo) => {
        const raw = message.toString('utf8').trim();
        replies.push({
          raw,
          parsed: tryParseJson(raw),
          replyFrom: `${rinfo.address}:${rinfo.port}`,
        });

        if (settleTimeoutId !== null) {
          clearTimeout(settleTimeoutId);
        }

        // Keep a burst window to capture telemetry/capability frames arriving shortly after ACK.
        settleTimeoutId = setTimeout(() => {
          if (timeoutId !== null) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          settleTimeoutId = null;
          completeWithReplies();
        }, udpBurstSettleMs);
      });
    }

    requestSocket.bind(0, '0.0.0.0', () => {
      requestSocket.send(encoded, targetPort, targetHost, (error) => {
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
            udpReplies: [],
            replyCount: 0,
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
    supportsTargetOverride: true,
    udpReplyTimeoutMs,
    udpBurstSettleMs,
    now: Date.now(),
  });
});

app.post('/api/udp-gateway', async (req, res) => {
  const { frame, eventName, payload, ts, awaitReply, targetHost, targetPort } = req.body ?? {};
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

  const effectiveTargetHost = normalizeTargetHost(targetHost) || udpHost;
  const effectiveTargetPort = normalizeTargetPort(targetPort) || udpPort;

  try {
    const reply = await forwardUdpWithOptionalReply(encoded, {
      awaitReply: awaitReply !== false,
      targetHost: effectiveTargetHost,
      targetPort: effectiveTargetPort,
    });
    res.json({
      ok: true,
      forwardedTo: `${effectiveTargetHost}:${effectiveTargetPort}`,
      bytes: encoded.byteLength,
      eventName: hasFrame ? 'frame' : eventName,
      replyTimedOut: reply.replyTimedOut,
      replyFrom: reply.replyFrom,
      udpReplyRaw: reply.udpReplyRaw,
      udpReply: reply.udpReply,
      udpReplies: reply.udpReplies,
      replyCount: reply.replyCount,
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
