import { test, expect } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadPolyfill(posted) {
  const fakeWindow = {
    navigator: {},
    webkit: { messageHandlers: { midiBridge: { postMessage: (m) => posted.push(m) } } }
  };
  const src = fs.readFileSync(__dirname + '/webmidi-polyfill.js', 'utf8');
  const fn = new Function('window', 'navigator', src);
  fn(fakeWindow, fakeWindow.navigator);
  return fakeWindow;
}

test('installs requestMIDIAccess', () => {
  const w = loadPolyfill([]);
  expect(typeof w.navigator.requestMIDIAccess).toBe('function');
});

test('access resolves and onmidimessage fires with bytes', async () => {
  const posted = [];
  const w = loadPolyfill(posted);

  const p = w.navigator.requestMIDIAccess();
  expect(posted[0].cmd).toBe('access');
  w.__webMIDIBridge._resolve({ id: posted[0].id, ok: true, payload: {
    inputs: [{ id: 'in1', name: 'K', manufacturer: 'M', version: '1' }],
    outputs: []
  } });
  const access = await p;

  let received = null;
  access.inputs.get('in1').onmidimessage = (e) => { received = e; };
  w.__webMIDIBridge._deliverInput([{ id: 'in1', data: [144, 60, 100], time: 5 }]);

  expect(received).not.toBeNull();
  expect(Array.from(received.data)).toEqual([144, 60, 100]);
  expect(received.receivedTime).toBe(5);
});

test('output.send posts send command with bytes', async () => {
  const posted = [];
  const w = loadPolyfill(posted);
  const p = w.navigator.requestMIDIAccess();
  w.__webMIDIBridge._resolve({ id: posted[0].id, ok: true, payload: {
    inputs: [],
    outputs: [{ id: 'out1', name: 'O', manufacturer: '', version: '1' }]
  } });
  const access = await p;

  access.outputs.get('out1').send(new Uint8Array([0x90, 60, 100]));
  const sendMsg = posted.find(m => m.cmd === 'send');
  expect(sendMsg).toBeDefined();
  expect(sendMsg.payload.portId).toBe('out1');
  expect(sendMsg.payload.data).toEqual([144, 60, 100]);
});

test('statechange updates maps and fires onstatechange', async () => {
  const posted = [];
  const w = loadPolyfill(posted);
  const p = w.navigator.requestMIDIAccess();
  w.__webMIDIBridge._resolve({ id: posted[0].id, ok: true, payload: { inputs: [], outputs: [] } });
  const access = await p;

  let fired = false;
  access.onstatechange = () => { fired = true; };
  w.__webMIDIBridge._statechange({
    inputs: [{ id: 'in2', name: 'New', manufacturer: '', version: '1' }],
    outputs: []
  });
  expect(fired).toBe(true);
  expect(access.inputs.size()).toBe(1);
  expect(access.inputs.get('in2')).not.toBeNull();
});
