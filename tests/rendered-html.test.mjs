import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the PartyKeys instrument", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>PartyKeys Play Lab/);
  assert.match(html, /连接 PartyKeys/);
  assert.match(html, /PARTYKEYS LAB/);
  assert.match(html, /36-key piano keyboard/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview/);
});

test("ships the complete four-layer sample set and protocol safeguards", async () => {
  const [files, source, keyboardImage] = await Promise.all([
    readdir(new URL("../public/samples/", import.meta.url)),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/partykeys-keyboard-front.png", import.meta.url)),
  ]);
  assert.equal(files.filter((file) => file.endsWith(".mp3")).length, 52);
  assert.ok(keyboardImage.length > 100_000);
  assert.match(source, /0xf0, 0x05, 0x30, 0x7f, 0x7f, 0x20, 0x00/);
  assert.match(source, /frame\.length > 256/);
  assert.match(source, /partykey\/i/);
  assert.match(source, /popupiano\/i/);
  assert.match(source, /useState<LightMode>\("rgb15"\)/);
  assert.match(source, /请点右下角“连接 MIDI 设备”/);
  assert.match(source, /connectMidi\(false\)/);
  assert.match(source, /nativeBluetoothOutput/);
  assert.match(source, /inputs\.length === 1 && outputs\.length === 1/);
  assert.match(source, /data1 === 64/);
  assert.doesNotMatch(source, /0x90,\s*note,\s*0x40/);
});
