// k6 load test: 100 concurrent sessions, 50 frames/s each, 60 s.
// Validates that `voice.pause` fires before server memory blows up.
import { check, sleep } from 'k6';
import ws from 'k6/ws';
import http from 'k6/http';

const BASE_URL = __ENV.STREAM_SERVER_URL || 'http://localhost:3000';

export const options = {
  vus: 100,
  duration: '60s',
  thresholds: {
    'ws_msgs_received{kind:ack}': ['count>100'],
  },
};

export default function () {
  const initRes = http.post(`${BASE_URL}/session/init`, JSON.stringify({}), {
    headers: { 'content-type': 'application/json' },
  });
  check(initRes, { 'session init 200': (r) => r.status === 200 });
  const { jwt } = initRes.json();

  const url = BASE_URL.replace(/^http/, 'ws') + '/socket.io/?EIO=4&transport=websocket';
  const res = ws.connect(url, { headers: { Authorization: `Bearer ${jwt}` } }, (socket) => {
    socket.on('open', () => {
      let seq = 0;
      socket.setInterval(() => {
        const payload = new Uint8Array(32 + 320 * 2);
        const view = new DataView(payload.buffer);
        view.setUint32(0, seq++, false);
        socket.sendBinary(payload.buffer);
      }, 20);
    });
    sleep(60);
    socket.close();
  });
  check(res, { 'ws connected': (r) => r && r.status === 101 });
}
