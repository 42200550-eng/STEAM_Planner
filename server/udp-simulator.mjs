import dgram from 'node:dgram';
import process from 'node:process';
import dotenv from 'dotenv';

dotenv.config();

const listenPort = Number(process.env.ROBOT_UDP_PORT || 9000);
const listenHost = process.env.ROBOT_UDP_HOST || '127.0.0.1';
const socket = dgram.createSocket('udp4');

socket.on('error', (error) => {
  console.error('[udp-sim] socket error:', error.message);
});

socket.on('listening', () => {
  const addr = socket.address();
  console.log(`[udp-sim] listening on ${addr.address}:${addr.port}`);
});

socket.on('message', (msg, rinfo) => {
  let parsed = null;
  try {
    parsed = JSON.parse(msg.toString('utf8'));
  } catch {
    parsed = { raw: msg.toString('utf8') };
  }

  console.log('[udp-sim] packet', {
    from: `${rinfo.address}:${rinfo.port}`,
    bytes: msg.byteLength,
    payload: parsed,
  });
});

socket.bind(listenPort, listenHost);
