"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type MidiEvent = {
  type: "on" | "off" | "pedal";
  note?: number;
  velocity?: number;
  value?: number;
  on?: boolean;
  channel: number;
  time: number;
  portId: string;
};

type DeviceProfile = "partykeys36" | "popupiano29" | null;
type LightMode = "palette71" | "rgb15";

const NOTES = Array.from({ length: 36 }, (_, index) => 48 + index);
const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const WHITE_NOTES = NOTES.filter((note) => ![1, 3, 6, 8, 10].includes(note % 12));
const BLACK_NOTES = NOTES.filter((note) => [1, 3, 6, 8, 10].includes(note % 12));
const SAMPLE_PITCHES = [48, 51, 54, 57, 60, 63, 66, 69, 72, 75, 78, 81, 84];
const SAMPLE_LAYERS = [
  { suffix: 4, maxVelocity: 45 },
  { suffix: 8, maxVelocity: 78 },
  { suffix: 12, maxVelocity: 106 },
  { suffix: 16, maxVelocity: 127 },
];
const PK_HEADER = [0xf0, 0x05, 0x30, 0x7f, 0x7f, 0x20, 0x00];
const COLORS = [
  [93, 214, 235],
  [97, 226, 174],
  [246, 178, 86],
  [255, 111, 137],
] as const;

function noteLabel(note: number) {
  return `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`;
}

function sampleName(note: number) {
  const names = ["C", "Cs", "D", "Ds", "E", "F", "Fs", "G", "Gs", "A", "As", "B"];
  return `${names[note % 12]}${Math.floor(note / 12) - 1}`;
}

function normalizeMidiTimestamp(value: unknown) {
  let time = Number(value);
  const now = performance.now();
  if (!Number.isFinite(time)) return now;
  if (time > 1e11 && Number.isFinite(performance.timeOrigin)) time -= performance.timeOrigin;
  return Math.abs(time - now) > 60_000 ? now : time;
}

function encodeChannel(value: number) {
  const clean = Math.max(0, Math.min(255, Math.round(value)));
  return [Math.floor(clean / 128), clean % 128];
}

function rgbFrame(key: number, rgb: readonly number[]) {
  return [
    ...PK_HEADER,
    0x15,
    0x01,
    ...encodeChannel(rgb[0]),
    ...encodeChannel(rgb[1]),
    ...encodeChannel(rgb[2]),
    0x01,
    key,
    0xf7,
  ];
}

function partyKeysAllOff(mode: LightMode) {
  if (mode === "palette71") return [...PK_HEADER, 0x71, 0x00, 0xf7];
  return [
    ...PK_HEADER,
    0x15,
    0x01,
    0, 0, 0, 0, 0, 0,
    36,
    ...Array.from({ length: 36 }, (_, index) => index),
    0xf7,
  ];
}

class PianoEngine {
  context: AudioContext | null = null;
  master: GainNode | null = null;
  keysBus: GainNode | null = null;
  compressor: DynamicsCompressorNode | null = null;
  fallbackWave: PeriodicWave | null = null;
  buffers: AudioBuffer[][] | null = null;
  loading: Promise<void> | null = null;
  ready = false;
  sustain = false;
  volume = 0.76;
  active = new Map<string, { node: AudioScheduledSourceNode; gain: GainNode; source: string }>();
  deferred = new Set<string>();

  ensureAudio() {
    if (!this.context) this.createGraph();
    void this.context?.resume();
    if (!this.loading) this.loading = this.loadSamples();
    return this.context!;
  }

  createGraph() {
    const AudioCtor = window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const context = new AudioCtor();
    this.context = context;
    this.master = context.createGain();
    this.master.gain.value = this.volume;
    this.compressor = context.createDynamicsCompressor();
    this.compressor.threshold.value = -14;
    this.compressor.ratio.value = 3;
    this.compressor.knee.value = 8;
    this.keysBus = context.createGain();
    this.keysBus.connect(this.master);
    this.master.connect(this.compressor);
    this.compressor.connect(context.destination);

    const impulse = context.createBuffer(2, Math.floor(context.sampleRate * 1.9), context.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = impulse.getChannelData(channel);
      for (let index = 0; index < data.length; index += 1) {
        data[index] = (Math.random() * 2 - 1) * (1 - index / data.length) ** 2.6;
      }
    }
    const reverb = context.createConvolver();
    const wet = context.createGain();
    reverb.buffer = impulse;
    wet.gain.value = 0.16;
    this.keysBus.connect(reverb);
    reverb.connect(wet);
    wet.connect(this.master);

    const harmonics = [0, 1, 0.55, 0.28, 0.14, 0.07];
    const real = new Float32Array(harmonics.length);
    const imaginary = new Float32Array(harmonics);
    this.fallbackWave = context.createPeriodicWave(real, imaginary);
  }

  async loadSamples() {
    if (!this.context) return;
    try {
      const decoded = await Promise.all(
        SAMPLE_LAYERS.flatMap((layer, layerIndex) =>
          SAMPLE_PITCHES.map(async (pitch, pitchIndex) => {
            const response = await fetch(`/samples/${sampleName(pitch)}v${layer.suffix}.mp3`);
            if (!response.ok) throw new Error("sample unavailable");
            const buffer = await this.context!.decodeAudioData(await response.arrayBuffer());
            return { layerIndex, pitchIndex, buffer };
          }),
        ),
      );
      this.buffers = SAMPLE_LAYERS.map(() => new Array<AudioBuffer>(SAMPLE_PITCHES.length));
      decoded.forEach(({ layerIndex, pitchIndex, buffer }) => {
        this.buffers![layerIndex][pitchIndex] = buffer;
      });
      this.ready = true;
    } catch {
      this.ready = false;
    }
  }

  setVolume(value: number) {
    this.volume = value;
    if (this.master && this.context) this.master.gain.setTargetAtTime(value, this.context.currentTime, 0.03);
  }

  noteOn(note: number, velocity = 96, source = "screen") {
    const context = this.ensureAudio();
    const key = `${source}:${note}`;
    this.releaseVoice(key, 0.035, true);
    while (this.active.size >= 48) {
      const oldest = this.active.keys().next().value;
      if (!oldest) break;
      this.releaseVoice(oldest, 0.035, true);
    }

    const gain = context.createGain();
    let node: AudioScheduledSourceNode;
    if (this.ready && this.buffers) {
      const layerIndex = Math.max(0, SAMPLE_LAYERS.findIndex((layer) => velocity <= layer.maxVelocity));
      let pitchIndex = 0;
      SAMPLE_PITCHES.forEach((pitch, index) => {
        if (Math.abs(note - pitch) < Math.abs(note - SAMPLE_PITCHES[pitchIndex])) pitchIndex = index;
      });
      const sourceNode = context.createBufferSource();
      sourceNode.buffer = this.buffers[layerIndex][pitchIndex];
      sourceNode.playbackRate.value = 2 ** ((note - SAMPLE_PITCHES[pitchIndex]) / 12);
      gain.gain.value = 0.32 + 0.55 * (Math.max(1, velocity) / 127);
      node = sourceNode;
    } else {
      const oscillator = context.createOscillator();
      oscillator.setPeriodicWave(this.fallbackWave!);
      oscillator.frequency.value = 440 * 2 ** ((note - 69) / 12);
      const level = Math.max((velocity / 127) * 0.32, 0.01);
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(level, context.currentTime + 0.008);
      gain.gain.exponentialRampToValueAtTime(Math.max(level * 0.3, 0.001), context.currentTime + 1.4);
      node = oscillator;
    }
    node.connect(gain);
    gain.connect(this.keysBus!);
    node.start(context.currentTime);
    this.active.set(key, { node, gain, source });
  }

  noteOff(note: number, source = "screen") {
    const key = `${source}:${note}`;
    if (this.sustain && source === "midi") this.deferred.add(key);
    else this.releaseVoice(key, 0.28, true);
  }

  setPedal(on: boolean) {
    this.sustain = on;
    if (!on) {
      [...this.deferred].forEach((key) => this.releaseVoice(key, 0.34, true));
      this.deferred.clear();
    }
  }

  releaseVoice(key: string, release: number, force = false) {
    const voice = this.active.get(key);
    if (!voice || (!force && this.sustain && voice.source === "midi")) return;
    this.active.delete(key);
    this.deferred.delete(key);
    const time = this.context?.currentTime ?? 0;
    voice.gain.gain.cancelScheduledValues(time);
    voice.gain.gain.setValueAtTime(Math.max(voice.gain.gain.value, 0.0005), time);
    voice.gain.gain.exponentialRampToValueAtTime(0.0001, time + release);
    try { voice.node.stop(time + release + 0.05); } catch { /* already stopped */ }
  }

  releaseAll() {
    [...this.active.keys()].forEach((key) => this.releaseVoice(key, 0.08, true));
    this.deferred.clear();
    this.sustain = false;
  }
}

function Knob({ label, value, color, onChange }: { label: string; value: number; color: string; onChange: (value: number) => void }) {
  return (
    <label className="knob-cell">
      <span className="knob" style={{ "--turn": `${-132 + value * 2.64}deg`, "--accent": color } as React.CSSProperties}>
        <span className="knob-mark" />
      </span>
      <input aria-label={label} type="range" min="0" max="100" value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <span className="knob-label">{label}</span>
      <strong>{String(value).padStart(2, "0")}</strong>
    </label>
  );
}

function WaveDisplay({ activeNotes, bpm }: { activeNotes: Set<number>; bpm: number }) {
  return (
    <div className="display" aria-label="Audio monitor">
      <div className="display-head"><span><i /> PARTYKEYS LAB</span><span>{bpm} <b>●</b></span></div>
      <div className="scope">
        <div className="rings"><i /><i /><i /><span>{activeNotes.size || "~"}</span></div>
        <div className="wave-line">
          {Array.from({ length: 16 }, (_, index) => (
            <i key={index} style={{ "--wave": `${Math.sin(index * 1.8 + activeNotes.size) * (activeNotes.size ? 12 : 4)}deg` } as React.CSSProperties} />
          ))}
        </div>
      </div>
      <div className="display-foot">
        <span style={{ color: "#54cfe7" }}>COLOR<br /><b>AURORA</b></span>
        <span style={{ color: "#61d99f" }}>ENGINE<br /><b>4 LAYER</b></span>
        <span>PROFILE<br /><b>36 KEYS</b></span>
        <span style={{ color: "#e99b72" }}>LEVEL<br /><b>{activeNotes.size ? "LIVE" : "IDLE"}</b></span>
      </div>
    </div>
  );
}

export default function Home() {
  const engineRef = useRef<PianoEngine | null>(null);
  const midiRef = useRef<any>(null);
  const outputRef = useRef<any>(null);
  const profileRef = useRef<DeviceProfile>(null);
  const lightModeRef = useRef<LightMode>("palette71");
  const heldRef = useRef(new Set<number>());
  const runningStatusRef = useRef(new Map<string, number>());
  const [activeNotes, setActiveNotes] = useState(new Set<number>());
  const [connection, setConnection] = useState<"idle" | "waiting" | "connected" | "unsupported" | "error">("idle");
  const [deviceName, setDeviceName] = useState("未连接");
  const [deviceProfile, setDeviceProfile] = useState<DeviceProfile>(null);
  const [lightMode, setLightMode] = useState<LightMode>("palette71");
  const [statusText, setStatusText] = useState("点击任意琴键开始");
  const [volume, setVolume] = useState(76);
  const [tone, setTone] = useState(54);
  const [space, setSpace] = useState(37);
  const [level, setLevel] = useState(68);
  const [bpm, setBpm] = useState(120);
  const [playing, setPlaying] = useState(false);
  const [selectedSound, setSelectedSound] = useState(0);

  if (!engineRef.current && typeof window !== "undefined") engineRef.current = new PianoEngine();

  const send = useCallback((frame: number[]) => {
    if (!outputRef.current || frame.length > 256) return;
    try { outputRef.current.send(frame); } catch { /* disconnected */ }
  }, []);

  const allLightsOff = useCallback(() => {
    if (profileRef.current === "partykeys36") send(partyKeysAllOff(lightModeRef.current));
    if (profileRef.current === "popupiano29") {
      const pairs = Array.from({ length: 29 }, (_, index) => [index, 0]).flat();
      send([0xf0, 0x03, 0x20, 29, ...pairs, 0xf7]);
    }
  }, [send]);

  const initLights = useCallback((profile: DeviceProfile, mode: LightMode) => {
    if (profile === "partykeys36") {
      send([...PK_HEADER, 0x0f, mode === "rgb15" ? 0x01 : 0x05, 0xf7]);
      send(partyKeysAllOff(mode));
    }
    if (profile === "popupiano29") {
      send([0xf0, 0x03, 0x1e, 4, 1, 47, 107, 117, 48, 113, 87, 123, 89, 43, 127, 56, 69, 0xf7]);
      const pairs = Array.from({ length: 29 }, (_, index) => [index, 0]).flat();
      send([0xf0, 0x03, 0x20, 29, ...pairs, 0xf7]);
    }
  }, [send]);

  const lightNote = useCallback((note: number, on: boolean, velocity = 96) => {
    const profile = profileRef.current;
    if (!profile || !outputRef.current) return;
    if (profile === "partykeys36" && note >= 48 && note <= 83) {
      if (lightModeRef.current === "rgb15") {
        const color = on ? COLORS[Math.min(3, Math.floor(Math.max(1, velocity) / 32))] : [0, 0, 0];
        send(rgbFrame(note - 48, color));
      } else {
        send([...PK_HEADER, 0x71, 0x01, note, on ? 0x08 : 0x00, 0xf7]);
      }
    }
    if (profile === "popupiano29" && note >= 48 && note <= 76) {
      send([0xf0, 0x03, 0x20, 0x01, note - 48, on ? 0x01 : 0x00, 0xf7]);
    }
  }, [send]);

  const setNoteState = useCallback((note: number, on: boolean) => {
    if (on) heldRef.current.add(note); else heldRef.current.delete(note);
    setActiveNotes(new Set(heldRef.current));
  }, []);

  const noteOn = useCallback((note: number, velocity = 100, source = "screen") => {
    engineRef.current?.noteOn(note, velocity, source);
    setNoteState(note, true);
    lightNote(note, true, velocity);
    setStatusText(`${noteLabel(note)} · 力度 ${velocity}`);
  }, [lightNote, setNoteState]);

  const noteOff = useCallback((note: number, source = "screen") => {
    engineRef.current?.noteOff(note, source);
    setNoteState(note, false);
    lightNote(note, false);
  }, [lightNote, setNoteState]);

  const parseMidiPacket = useCallback((data: unknown, rawTime: unknown, portId: string) => {
    const bytes = Array.from(data as ArrayLike<number> || [], (value) => Number(value) & 0xff).filter((value) => value < 0xf8);
    let index = 0;
    let runningStatus = runningStatusRef.current.get(portId) || 0;
    const emit = (event: MidiEvent) => {
      if (event.type === "on") noteOn(event.note!, event.velocity!, "midi");
      if (event.type === "off") noteOff(event.note!, "midi");
      if (event.type === "pedal") engineRef.current?.setPedal(Boolean(event.on));
    };
    while (index < bytes.length) {
      let status = bytes[index];
      if (status & 0x80) {
        index += 1;
        if (status >= 0xf0) {
          runningStatus = 0;
          if (status === 0xf0) {
            while (index < bytes.length && bytes[index] !== 0xf7) index += 1;
            if (index < bytes.length) index += 1;
          } else index += status === 0xf2 ? 2 : status === 0xf1 || status === 0xf3 ? 1 : 0;
          continue;
        }
        runningStatus = status;
      } else if (!runningStatus) {
        index += 1;
        continue;
      } else status = runningStatus;
      const command = status & 0xf0;
      const channel = status & 0x0f;
      const length = command === 0xc0 || command === 0xd0 ? 1 : 2;
      if (index + length > bytes.length) break;
      const data1 = bytes[index++];
      const data2 = length === 2 ? bytes[index++] : 0;
      const base = { channel, time: normalizeMidiTimestamp(rawTime), portId };
      if (command === 0x90 && data2 > 0) emit({ ...base, type: "on", note: data1, velocity: data2 });
      else if (command === 0x80 || (command === 0x90 && data2 === 0)) emit({ ...base, type: "off", note: data1, velocity: 0 });
      else if (command === 0xb0 && data1 === 64) emit({ ...base, type: "pedal", value: data2, on: data2 >= 64 });
    }
    runningStatusRef.current.set(portId, runningStatus);
  }, [noteOff, noteOn]);

  const bindPorts = useCallback((access: any) => {
    const inputs = [...(access?.inputs?.values?.() || [])].filter((port: any) => port.state !== "disconnected");
    const outputs = [...(access?.outputs?.values?.() || [])].filter((port: any) => port.state !== "disconnected");
    inputs.forEach((input: any) => {
      input.onmidimessage = (event: any) => parseMidiPacket(event.data, event.timeStamp ?? event.receivedTime, input.id || "midi");
    });
    const partyOutput = outputs.find((port: any) => /partykey/i.test(`${port.name} ${port.manufacturer}`));
    const popuOutput = outputs.find((port: any) => /popupiano/i.test(`${port.name} ${port.manufacturer}`));
    const output = partyOutput || popuOutput || null;
    outputRef.current = output;
    const profile: DeviceProfile = partyOutput ? "partykeys36" : popuOutput ? "popupiano29" : null;
    profileRef.current = profile;
    setDeviceProfile(profile);
    if (profile && output) {
      const mode = profile === "partykeys36" ? lightModeRef.current : "palette71";
      initLights(profile, mode);
      setConnection("connected");
      setDeviceName(output.name || (profile === "partykeys36" ? "PartyKeys 36" : "PopuPiano 29"));
      setStatusText("设备已连接 · 灯光与音色就绪");
    } else if (inputs.length) {
      setConnection("connected");
      setDeviceName(inputs[0].name || "标准 MIDI 键盘");
      setStatusText("标准 MIDI 已连接 · 仅启用发声");
    } else {
      setConnection("waiting");
      setDeviceName("等待设备");
      const isMidiBrowser = Boolean((window as any).webkit?.messageHandlers?.midiBridge && (window as any).__webMIDIBridge);
      setStatusText(isMidiBrowser ? "请在底部点“连接 MIDI 设备”完成蓝牙配对" : "请连接 USB/BLE MIDI，页面会自动发现");
    }
  }, [initLights, parseMidiPacket]);

  const connectMidi = useCallback(async () => {
    engineRef.current?.ensureAudio();
    const nav = navigator as Navigator & { requestMIDIAccess?: (options?: { sysex?: boolean }) => Promise<any> };
    if (!nav.requestMIDIAccess) {
      setConnection("unsupported");
      setStatusText("此浏览器不支持 Web MIDI，请使用 Chrome / Edge 或 MidiBrowser");
      return;
    }
    setConnection("waiting");
    setStatusText("正在请求 MIDI 与 SysEx 权限…");
    try {
      let access: any;
      try { access = await nav.requestMIDIAccess({ sysex: true }); }
      catch { access = await nav.requestMIDIAccess(); }
      midiRef.current = access;
      access.onstatechange = () => bindPorts(access);
      bindPorts(access);
    } catch {
      setConnection("error");
      setStatusText("MIDI 权限未开启，可刷新后重新允许");
    }
  }, [bindPorts]);

  useEffect(() => {
    lightModeRef.current = lightMode;
    if (deviceProfile === "partykeys36") initLights(deviceProfile, lightMode);
  }, [deviceProfile, initLights, lightMode]);

  useEffect(() => {
    engineRef.current?.setVolume(volume / 100);
  }, [volume]);

  useEffect(() => {
    const keyMap: Record<string, number> = { a: 60, w: 61, s: 62, e: 63, d: 64, f: 65, t: 66, g: 67, y: 68, h: 69, u: 70, j: 71, k: 72 };
    const down = (event: KeyboardEvent) => {
      if (event.repeat || !keyMap[event.key.toLowerCase()]) return;
      noteOn(keyMap[event.key.toLowerCase()], 94, "typing");
    };
    const up = (event: KeyboardEvent) => {
      if (!keyMap[event.key.toLowerCase()]) return;
      noteOff(keyMap[event.key.toLowerCase()], "typing");
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [noteOff, noteOn]);

  useEffect(() => {
    const cleanup = () => { allLightsOff(); engineRef.current?.releaseAll(); };
    window.addEventListener("beforeunload", cleanup);
    return () => { window.removeEventListener("beforeunload", cleanup); cleanup(); };
  }, [allLightsOff]);

  useEffect(() => {
    if (!playing) return;
    const pattern = [48, 55, 60, 64, 67, 72, 67, 55];
    let step = 0;
    const tick = () => {
      const note = pattern[step % pattern.length];
      noteOn(note, 56 + (step % 4) * 12, "sequence");
      window.setTimeout(() => noteOff(note, "sequence"), Math.max(90, 60_000 / bpm / 2));
      step += 1;
    };
    tick();
    const timer = window.setInterval(tick, 60_000 / bpm);
    return () => window.clearInterval(timer);
  }, [bpm, noteOff, noteOn, playing]);

  const profileLabel = deviceProfile === "partykeys36" ? "PK36" : deviceProfile === "popupiano29" ? "PP29" : "MIDI";
  const statusClass = connection === "connected" ? "connected" : connection === "error" || connection === "unsupported" ? "error" : "";
  const blackPositions = useMemo(() => {
    return BLACK_NOTES.map((note) => {
      const whitesBefore = NOTES.filter((candidate) => candidate < note && ![1, 3, 6, 8, 10].includes(candidate % 12)).length;
      return { note, left: `${(whitesBefore / WHITE_NOTES.length) * 100}%` };
    });
  }, []);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="window-dots" aria-hidden="true"><i /><i /><i /></div>
        <a className="wordmark" href="https://foundation.partykeys.ai" target="_blank" rel="noreferrer">
          <span className="brand-glyph"><i /><i /><i /></span>
          <span><b>PARTYKEYS</b><small>PLAY LAB</small></span>
        </a>
        <div className="top-actions">
          <span className={`device-pill ${statusClass}`}><i /> {profileLabel} · {deviceName}</span>
          <button className="connect-button" onClick={connectMidi}>{connection === "connected" ? "重新扫描" : "连接 PartyKeys"}</button>
        </div>
      </header>

      <section className="instrument" aria-label="PartyKeys Play Lab virtual instrument">
        <div className="top-deck">
          <section className="speaker-zone">
            <div className="speaker"><div className="speaker-logo"><i /><i /><i /></div></div>
            <div className="utility-stack">
              <button aria-label="Master volume" onClick={() => setVolume((value) => value > 0 ? 0 : 76)}><span className="mini-knob" /><small>VOL</small></button>
              <button aria-label="Audio monitor">◖))</button>
              <button aria-label="Help" onClick={() => setStatusText("电脑键盘 A–K 也能演奏 · 连接后硬件灯光会同步")}>?</button>
              <a aria-label="Open PartyKeys Foundation" href="https://foundation.partykeys.ai" target="_blank" rel="noreferrer">F</a>
            </div>
          </section>

          <WaveDisplay activeNotes={activeNotes} bpm={bpm} />

          <div className="knob-row">
            <Knob label="TONE" value={tone} color="#61d9aa" onChange={setTone} />
            <Knob label="SPACE" value={space} color="#62c8e6" onChange={setSpace} />
            <Knob label="COLOR" value={level} color="#f1b671" onChange={setLevel} />
            <Knob label="MASTER" value={volume} color="#ff758a" onChange={setVolume} />
          </div>

          <div className="side-stack">
            <button aria-label="Microphone">●<small>MIC</small></button>
            <button className={connection === "connected" ? "side-active" : ""} onClick={connectMidi}>COM<small>{connection === "connected" ? "ON" : "MIDI"}</small></button>
          </div>
        </div>

        <div className="pad-row">
          <div className="mode-pads">
            {[["⌁", "KEYS"], ["✣", "CHORD"], ["∞", "LOOP"], ["≋", "FX"]].map(([icon, label], index) => (
              <button key={label} className={selectedSound === index ? "active-pad" : ""} onClick={() => setSelectedSound(index)}><span>{icon}</span><small>{label}</small></button>
            ))}
          </div>
          <div className="sound-pads">
            {["PURE", "FELT", "WARM", "AIR"].map((label, index) => <button key={label} className={selectedSound === index ? "selected" : ""} onClick={() => setSelectedSound(index)}><b>{index + 1}</b><small>{label}</small></button>)}
          </div>
          <div className="step-pads">
            {Array.from({ length: 8 }, (_, index) => <button key={index} className={playing && index === 0 ? "step-on" : ""} onClick={() => { setBpm(96 + index * 6); setStatusText(`节拍 ${index + 1} · ${96 + index * 6} BPM`); }}><b>{index + 1}</b><small>{index % 2 ? "BEAT" : "STEP"}</small></button>)}
          </div>
          <button className="more-button" onClick={() => setLightMode((mode) => mode === "palette71" ? "rgb15" : "palette71")}>•••<small>{lightMode === "rgb15" ? "RGB 15" : "COMPAT 71"}</small></button>
        </div>

        <div className="lower-deck">
          <aside className="transport">
            <div className="edit-row"><button>⇧<small>LOAD</small></button><button>▣<small>SAVE</small></button><button>✂<small>EDIT</small></button></div>
            <div className="play-row"><button onClick={() => setStatusText("录音将在下一小节开始")}>◉<small>REC</small></button><button className={playing ? "playing" : ""} onClick={() => setPlaying((value) => !value)}>{playing ? "Ⅱ" : "▶"}<small>{playing ? "PAUSE" : "PLAY"}</small></button><button onClick={() => { setPlaying(false); engineRef.current?.releaseAll(); heldRef.current.clear(); setActiveNotes(new Set()); allLightsOff(); }}>■<small>STOP</small></button></div>
            <div className="nav-row"><button>◀◀</button><button>▶▶</button><button onClick={() => setBpm((value) => value === 120 ? 96 : 120)}><span>shift</span><small>{bpm} BPM</small></button></div>
          </aside>

          <div className="keyboard-wrap">
            <div className="keyboard" role="group" aria-label="36-key piano keyboard">
              <div className="white-keys">
                {WHITE_NOTES.map((note) => <button key={note} aria-label={noteLabel(note)} className={activeNotes.has(note) ? "pressed" : ""} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); noteOn(note); }} onPointerUp={() => noteOff(note)} onPointerCancel={() => noteOff(note)}><span>{note % 12 === 0 ? noteLabel(note) : ""}</span></button>)}
              </div>
              <div className="black-keys">
                {blackPositions.map(({ note, left }) => <button key={note} aria-label={noteLabel(note)} style={{ left }} className={activeNotes.has(note) ? "pressed" : ""} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); noteOn(note); }} onPointerUp={() => noteOff(note)} onPointerCancel={() => noteOff(note)} />)}
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="statusbar">
        <span className={`live-dot ${statusClass}`}><i /> {statusText}</span>
        <span>四层 Salamander C5 音源 · CC64 踏板 · Web MIDI / MidiBrowser</span>
        <a href="https://foundation.partykeys.ai" target="_blank" rel="noreferrer">Foundation ↗</a>
      </footer>
    </main>
  );
}
