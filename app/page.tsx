"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";

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
type KeyMode = "poly" | "mono" | "chord";
type PanelMode = "keys" | "loop" | "fx" | "step" | null;
type LoopStatus = "idle" | "recording" | "playing";
type LoopEvent = { type: "on" | "off"; note: number; velocity: number; at: number };
type Mood = { name: string; english: string; description: string; colors: readonly (readonly [number, number, number])[] };

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
const MOODS: readonly Mood[] = [
  { name: "温暖", english: "WARM", description: "琥珀 · 珊瑚 · 烛光", colors: [[130, 62, 42], [206, 100, 62], [246, 176, 82], [255, 220, 156]] },
  { name: "复古", english: "AGED", description: "橄榄 · 黄铜 · 胶片", colors: [[62, 68, 43], [112, 112, 68], [174, 139, 72], [218, 188, 124]] },
  { name: "热烈", english: "BLAZE", description: "猩红 · 橙焰 · 洋红", colors: [[144, 18, 48], [232, 48, 58], [255, 116, 42], [255, 72, 137]] },
  { name: "宽容", english: "OPEN", description: "青蓝 · 天空 · 淡紫", colors: [[36, 106, 146], [72, 169, 196], [103, 139, 255], [188, 164, 255]] },
] as const;

const CHORD_INTERVALS: Record<number, readonly [number, number]> = {
  0: [4, 7], 2: [3, 7], 4: [3, 7], 5: [4, 7], 7: [4, 7], 9: [3, 7], 11: [3, 6],
};

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
  toneFilter: BiquadFilterNode | null = null;
  reverbWet: GainNode | null = null;
  delayNode: DelayNode | null = null;
  delayWet: GainNode | null = null;
  delayFeedback: GainNode | null = null;
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
    this.toneFilter = context.createBiquadFilter();
    this.toneFilter.type = "lowpass";
    this.toneFilter.frequency.value = 7200;
    this.toneFilter.Q.value = 0.55;
    this.keysBus.connect(this.toneFilter);
    this.toneFilter.connect(this.master);
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
    this.reverbWet = wet;
    this.keysBus.connect(reverb);
    reverb.connect(wet);
    wet.connect(this.master);

    this.delayNode = context.createDelay(1.2);
    this.delayNode.delayTime.value = 0.24;
    this.delayWet = context.createGain();
    this.delayWet.gain.value = 0.08;
    this.delayFeedback = context.createGain();
    this.delayFeedback.gain.value = 0.28;
    this.keysBus.connect(this.delayNode);
    this.delayNode.connect(this.delayWet);
    this.delayWet.connect(this.master);
    this.delayNode.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delayNode);

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

  setTone(value: number) {
    if (!this.context || !this.toneFilter) return;
    const frequency = 900 * 2 ** (value / 18);
    this.toneFilter.frequency.setTargetAtTime(Math.min(15000, frequency), this.context.currentTime, 0.03);
  }

  setFx(reverb: number, delay: number, feedback: number) {
    if (!this.context) return;
    this.reverbWet?.gain.setTargetAtTime(reverb * 0.0042, this.context.currentTime, 0.03);
    this.delayWet?.gain.setTargetAtTime(delay * 0.0032, this.context.currentTime, 0.03);
    this.delayFeedback?.gain.setTargetAtTime(Math.min(0.78, feedback * 0.0078), this.context.currentTime, 0.03);
  }

  click(accent = false) {
    const context = this.ensureAudio();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = accent ? 1320 : 880;
    gain.gain.setValueAtTime(accent ? 0.12 : 0.07, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.055);
    oscillator.connect(gain);
    gain.connect(this.master!);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.06);
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

function WaveDisplay({ activeNotes, bpm, mood, keyMode, panelContent }: {
  activeNotes: Set<number>;
  bpm: number;
  mood: Mood;
  keyMode: KeyMode;
  panelContent?: React.ReactNode;
}) {
  return (
    <div className="display" aria-label="Audio monitor">
      <div className="display-head"><span><i /> PARTYKEYS LAB</span><span>{bpm} <b>●</b></span></div>
      <div className="scope">
        <div className="rings"><i /><i /><i /><span>{activeNotes.size || "~"}</span></div>
        <div className="wave-line">
          {Array.from({ length: 16 }, (_, index) => (
            <i key={index} style={{ "--wave": `${(Math.sin(index * 1.8 + activeNotes.size) * (activeNotes.size ? 12 : 4)).toFixed(3)}deg` } as React.CSSProperties} />
          ))}
        </div>
      </div>
      <div className="display-foot">
        <span style={{ color: `rgb(${mood.colors[2].join(",")})` }}>MOOD<br /><b>{mood.english}</b></span>
        <span style={{ color: "#61d99f" }}>ENGINE<br /><b>4 LAYER</b></span>
        <span>KEY MODE<br /><b>{keyMode === "poly" ? "ROOT" : keyMode === "mono" ? "MONO" : "TRIAD"}</b></span>
        <span style={{ color: "#e99b72" }}>LEVEL<br /><b>{activeNotes.size ? "LIVE" : "IDLE"}</b></span>
      </div>
      {panelContent}
    </div>
  );
}

export default function Home() {
  const engineRef = useRef<PianoEngine | null>(null);
  const midiRef = useRef<any>(null);
  const outputRef = useRef<any>(null);
  const profileRef = useRef<DeviceProfile>(null);
  const lightModeRef = useRef<LightMode>("palette71");
  const moodRef = useRef(0);
  const heldRef = useRef(new Set<number>());
  const heldCountsRef = useRef(new Map<number, number>());
  const generatedNotesRef = useRef(new Map<string, number[]>());
  const monoRef = useRef<{ note: number; source: string } | null>(null);
  const loopEventsRef = useRef<LoopEvent[]>([]);
  const loopStartRef = useRef(0);
  const runningStatusRef = useRef(new Map<string, number>());
  const [activeNotes, setActiveNotes] = useState(new Set<number>());
  const [connection, setConnection] = useState<"idle" | "waiting" | "connected" | "unsupported" | "error">("idle");
  const [deviceName, setDeviceName] = useState("未连接");
  const [deviceProfile, setDeviceProfile] = useState<DeviceProfile>(null);
  const [lightMode, setLightMode] = useState<LightMode>("palette71");
  const [statusText, setStatusText] = useState("点击任意琴键开始");
  const [volume, setVolume] = useState(76);
  const [tone, setTone] = useState(54);
  const [bpm, setBpm] = useState(120);
  const [playing, setPlaying] = useState(false);
  const [moodIndex, setMoodIndex] = useState(0);
  const [keyMode, setKeyMode] = useState<KeyMode>("poly");
  const [panel, setPanel] = useState<PanelMode>("keys");
  const [loopStatus, setLoopStatus] = useState<LoopStatus>("idle");
  const [loopProgress, setLoopProgress] = useState(0);
  const [loopEvents, setLoopEvents] = useState<LoopEvent[]>([]);
  const [reverb, setReverb] = useState(37);
  const [delay, setDelay] = useState(18);
  const [feedback, setFeedback] = useState(28);
  const [stepMode, setStepMode] = useState<"metronome" | "sequencer">("metronome");
  const [stepPattern, setStepPattern] = useState([true, false, false, false, true, false, false, false]);
  const [activeStep, setActiveStep] = useState(-1);

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
      const palette = MOODS[moodRef.current].colors.flatMap(([r, g, b]) => [Math.min(127, Math.round(r / 2)), Math.min(127, Math.round(g / 2)), Math.min(127, Math.round(b / 2))]);
      send([0xf0, 0x03, 0x1e, 4, 1, ...palette, 0xf7]);
      const pairs = Array.from({ length: 29 }, (_, index) => [index, 0]).flat();
      send([0xf0, 0x03, 0x20, 29, ...pairs, 0xf7]);
    }
  }, [send]);

  const lightNote = useCallback((note: number, on: boolean, velocity = 96) => {
    const profile = profileRef.current;
    if (!profile || !outputRef.current) return;
    if (profile === "partykeys36" && note >= 48 && note <= 83) {
      if (lightModeRef.current === "rgb15") {
        const color = on ? MOODS[moodRef.current].colors[Math.min(3, Math.floor(Math.max(1, velocity) / 32))] : [0, 0, 0];
        send(rgbFrame(note - 48, color));
      } else {
        const moodPalettes = [[3, 4, 5, 6], [7, 6, 5, 4], [1, 2, 3, 12], [8, 9, 10, 12]];
        const colorId = moodPalettes[moodRef.current][Math.min(3, Math.floor(Math.max(1, velocity) / 32))];
        send([...PK_HEADER, 0x71, 0x01, note, on ? colorId : 0x00, 0xf7]);
      }
    }
    if (profile === "popupiano29" && note >= 48 && note <= 76) {
      send([0xf0, 0x03, 0x20, 0x01, note - 48, on ? 0x01 : 0x00, 0xf7]);
    }
  }, [send]);

  const setNoteState = useCallback((note: number, on: boolean) => {
    const count = heldCountsRef.current.get(note) || 0;
    if (on) {
      heldCountsRef.current.set(note, count + 1);
      heldRef.current.add(note);
    } else if (count <= 1) {
      heldCountsRef.current.delete(note);
      heldRef.current.delete(note);
    } else heldCountsRef.current.set(note, count - 1);
    setActiveNotes(new Set(heldRef.current));
  }, []);

  const recordLoopEvent = useCallback((type: "on" | "off", note: number, velocity: number, source: string) => {
    if (loopStatus !== "recording" || source.startsWith("loop") || source.startsWith("step")) return;
    const at = Math.max(0, performance.now() - loopStartRef.current);
    loopEventsRef.current.push({ type, note, velocity, at });
  }, [loopStatus]);

  const soundNoteOn = useCallback((note: number, velocity = 100, source = "screen") => {
    engineRef.current?.noteOn(note, velocity, source);
    setNoteState(note, true);
    lightNote(note, true, velocity);
    recordLoopEvent("on", note, velocity, source);
    setStatusText(`${noteLabel(note)} · 力度 ${velocity}`);
  }, [lightNote, recordLoopEvent, setNoteState]);

  const soundNoteOff = useCallback((note: number, source = "screen") => {
    engineRef.current?.noteOff(note, source);
    setNoteState(note, false);
    lightNote(note, false);
    recordLoopEvent("off", note, 0, source);
  }, [lightNote, recordLoopEvent, setNoteState]);

  const noteOn = useCallback((note: number, velocity = 100, source = "screen") => {
    const sourceKey = `${source}:${note}`;
    if (generatedNotesRef.current.has(sourceKey)) return;
    if (keyMode === "mono" && monoRef.current) {
      const previous = monoRef.current;
      const previousKey = `${previous.source}:${previous.note}`;
      const previousNotes = generatedNotesRef.current.get(previousKey) || [previous.note];
      previousNotes.forEach((generated) => soundNoteOff(generated, `${previous.source}-${previous.note}`));
      generatedNotesRef.current.delete(previousKey);
    }
    const intervals = CHORD_INTERVALS[note % 12] || [4, 7];
    const generated = keyMode === "chord" ? [note, note + intervals[0], note + intervals[1]] : [note];
    const playable = generated.filter((value) => value >= 21 && value <= 108);
    generatedNotesRef.current.set(sourceKey, playable);
    if (keyMode === "mono") monoRef.current = { note, source };
    playable.forEach((generatedNote) => soundNoteOn(generatedNote, velocity, `${source}-${note}`));
    if (keyMode === "chord") setStatusText(`${noteLabel(note)} · ${intervals[1] === 6 ? "减三和弦" : intervals[0] === 3 ? "小三和弦" : "大三和弦"}`);
  }, [keyMode, soundNoteOff, soundNoteOn]);

  const noteOff = useCallback((note: number, source = "screen") => {
    const sourceKey = `${source}:${note}`;
    const generated = generatedNotesRef.current.get(sourceKey) || [note];
    generated.forEach((generatedNote) => soundNoteOff(generatedNote, `${source}-${note}`));
    generatedNotesRef.current.delete(sourceKey);
    if (monoRef.current?.note === note && monoRef.current.source === source) monoRef.current = null;
  }, [soundNoteOff]);

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

  const startLoopRecording = useCallback(() => {
    engineRef.current?.ensureAudio();
    loopEventsRef.current = [];
    setLoopEvents([]);
    loopStartRef.current = performance.now();
    setLoopProgress(0);
    setLoopStatus("recording");
    setPanel("loop");
    setStatusText("LOOP 录制中 · 接下来 8 拍会自动循环");
  }, []);

  const stopLoop = useCallback((clear = false) => {
    setLoopStatus("idle");
    setLoopProgress(0);
    if (clear) {
      loopEventsRef.current = [];
      setLoopEvents([]);
      setStatusText("LOOP 已清空");
    } else setStatusText("LOOP 已停止");
  }, []);

  useEffect(() => {
    if (!engineRef.current) engineRef.current = new PianoEngine();
  }, []);

  useEffect(() => {
    lightModeRef.current = lightMode;
    if (deviceProfile === "partykeys36") initLights(deviceProfile, lightMode);
  }, [deviceProfile, initLights, lightMode]);

  useEffect(() => {
    moodRef.current = moodIndex;
    if (deviceProfile === "popupiano29") initLights(deviceProfile, "palette71");
  }, [deviceProfile, initLights, moodIndex]);

  useEffect(() => {
    engineRef.current?.setVolume(volume / 100);
  }, [volume]);

  useEffect(() => {
    engineRef.current?.setTone(tone);
  }, [tone]);

  useEffect(() => {
    engineRef.current?.setFx(reverb, delay, feedback);
  }, [delay, feedback, reverb]);

  useEffect(() => {
    if (loopStatus !== "recording") return;
    const duration = (60_000 / bpm) * 8;
    let frame = 0;
    const update = () => {
      const elapsed = performance.now() - loopStartRef.current;
      setLoopProgress(Math.min(1, elapsed / duration));
      if (elapsed >= duration) {
        const recorded = [...loopEventsRef.current];
        const balances = new Map<number, number>();
        recorded.forEach((event) => balances.set(event.note, (balances.get(event.note) || 0) + (event.type === "on" ? 1 : -1)));
        balances.forEach((count, note) => {
          for (let index = 0; index < count; index += 1) recorded.push({ type: "off", note, velocity: 0, at: duration - 8 });
        });
        recorded.sort((a, b) => a.at - b.at);
        loopEventsRef.current = recorded;
        setLoopEvents(recorded);
        setLoopStatus(recorded.some((event) => event.type === "on") ? "playing" : "idle");
        setStatusText(recorded.length ? "LOOP 已接管 · 8 拍无限循环" : "LOOP 没有录到音符");
        return;
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [bpm, loopStatus]);

  useEffect(() => {
    if (loopStatus !== "playing" || !loopEvents.length) return;
    const duration = (60_000 / bpm) * 8;
    const timers = new Set<number>();
    const activeLoopNotes = new Set<number>();
    const origin = performance.now();
    let frame = 0;
    const scheduleCycle = () => {
      loopEvents.forEach((event) => {
        const timer = window.setTimeout(() => {
          const source = `loop-${event.note}`;
          if (event.type === "on") {
            activeLoopNotes.add(event.note);
            soundNoteOn(event.note, event.velocity, source);
          } else {
            activeLoopNotes.delete(event.note);
            soundNoteOff(event.note, source);
          }
        }, Math.min(duration - 1, event.at));
        timers.add(timer);
      });
      const next = window.setTimeout(scheduleCycle, duration);
      timers.add(next);
    };
    const progress = () => {
      setLoopProgress(((performance.now() - origin) % duration) / duration);
      frame = requestAnimationFrame(progress);
    };
    scheduleCycle();
    frame = requestAnimationFrame(progress);
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      cancelAnimationFrame(frame);
      activeLoopNotes.forEach((note) => soundNoteOff(note, `loop-${note}`));
    };
  }, [bpm, loopEvents, loopStatus, soundNoteOff, soundNoteOn]);

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
    let step = 0;
    const tick = () => {
      const index = step % 8;
      setActiveStep(index);
      const enabled = stepPattern[index];
      engineRef.current?.click(index === 0 || enabled);
      if (stepMode === "sequencer" && enabled) {
        const note = [60, 62, 64, 67, 69, 67, 64, 62][index];
        soundNoteOn(note, index === 0 ? 104 : 78, `step-${index}`);
        window.setTimeout(() => soundNoteOff(note, `step-${index}`), Math.max(80, 60_000 / bpm * 0.42));
      }
      step += 1;
    };
    tick();
    const timer = window.setInterval(tick, 60_000 / bpm);
    return () => { window.clearInterval(timer); setActiveStep(-1); };
  }, [bpm, playing, soundNoteOff, soundNoteOn, stepMode, stepPattern]);

  const profileLabel = deviceProfile === "partykeys36" ? "PK36" : deviceProfile === "popupiano29" ? "PP29" : "MIDI";
  const statusClass = connection === "connected" ? "connected" : connection === "error" || connection === "unsupported" ? "error" : "";
  const blackPositions = useMemo(() => {
    return BLACK_NOTES.map((note) => {
      const whitesBefore = NOTES.filter((candidate) => candidate < note && ![1, 3, 6, 8, 10].includes(candidate % 12)).length;
      return { note, left: `${(whitesBefore / WHITE_NOTES.length) * 100}%` };
    });
  }, []);

  const mood = MOODS[moodIndex];
  const panelContent = panel ? (
    <div className={`mini-panel mini-panel-${panel}`}>
      <div className="mini-panel-head">
        <b>{panel === "keys" ? "KEY BEHAVIOR" : panel === "loop" ? "8-BEAT LOOP" : panel === "fx" ? "FX RACK" : "CLOCK / STEP"}</b>
        <button aria-label="Close panel" onClick={() => setPanel(null)}>×</button>
      </div>
      {panel === "keys" && (
        <div className="key-mode-options">
          {([
            ["poly", "主音", "正常复音"],
            ["mono", "旋律单音", "后音切前音"],
            ["chord", "和弦", "单键三和弦"],
          ] as const).map(([value, name, hint]) => (
            <button key={value} className={keyMode === value ? "panel-active" : ""} onClick={() => { setKeyMode(value); setStatusText(`${name}模式 · ${hint}`); }}>
              <b>{name}</b><small>{hint}</small>
            </button>
          ))}
        </div>
      )}
      {panel === "loop" && (
        <div className="loop-panel">
          <div className="loop-meta"><span className={loopStatus}>{loopStatus === "recording" ? "● REC" : loopStatus === "playing" ? "▶ LOOP" : "○ READY"}</span><span>{loopEvents.filter((event) => event.type === "on").length} NOTES</span></div>
          <div className="loop-track">
            {Array.from({ length: 8 }, (_, index) => <i key={index} className={Math.floor(loopProgress * 8) === index ? "now" : ""} />)}
            <span style={{ width: `${loopProgress * 100}%` }} />
          </div>
          <div className="panel-actions">
            <button onClick={startLoopRecording}>{loopStatus === "recording" ? "重新录制" : "录制 8 拍"}</button>
            <button onClick={() => stopLoop(false)}>停止</button>
            <button onClick={() => stopLoop(true)}>清空</button>
          </div>
        </div>
      )}
      {panel === "fx" && (
        <div className="fx-panel">
          {[["混响", reverb, setReverb], ["延迟", delay, setDelay], ["反馈", feedback, setFeedback]].map(([name, value, setter]) => (
            <label key={name as string}><span>{name as string}</span><input type="range" min="0" max="100" value={value as number} onChange={(event) => (setter as (value: number) => void)(Number(event.target.value))} /><b>{value as number}</b></label>
          ))}
        </div>
      )}
      {panel === "step" && (
        <div className="step-panel">
          <button className={stepMode === "metronome" ? "panel-active" : ""} onClick={() => setStepMode("metronome")}><b>节拍提示</b><small>滴 · 答 · 答 · 答</small></button>
          <button className={stepMode === "sequencer" ? "panel-active" : ""} onClick={() => setStepMode("sequencer")}><b>八步音序</b><small>亮起的步会发声</small></button>
          <div><button onClick={() => setBpm((value) => Math.max(50, value - 2))}>−</button><strong>{bpm} BPM</strong><button onClick={() => setBpm((value) => Math.min(180, value + 2))}>＋</button></div>
        </div>
      )}
    </div>
  ) : null;

  return (
    <main className="app-shell" style={{ "--mood": `rgb(${mood.colors[2].join(",")})`, "--mood-soft": `rgba(${mood.colors[2].join(",")},.45)` } as React.CSSProperties}>
      <header className="topbar">
        <div className="window-dots" aria-hidden="true"><i /><i /><i /></div>
        <a className="wordmark" href="https://foundation.partykeys.ai" target="_blank" rel="noreferrer">
          <Image className="brand-logo" src="/brand-logo.png" alt="PartyKeys" width={32} height={32} priority />
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
            <div className="speaker"><Image className="speaker-logo" src="/brand-logo.png" alt="PartyKeys" width={72} height={72} priority /></div>
            <div className="utility-stack">
              <button aria-label="Master volume" onClick={() => setVolume((value) => value > 0 ? 0 : 76)}><span className="mini-knob" /><small>VOL</small></button>
              <button aria-label="Audio monitor">◖))</button>
              <button aria-label="Help" onClick={() => setStatusText("电脑键盘 A–K 也能演奏 · 连接后硬件灯光会同步")}>?</button>
              <a aria-label="Open PartyKeys Foundation" href="https://foundation.partykeys.ai" target="_blank" rel="noreferrer">F</a>
            </div>
          </section>

          <WaveDisplay activeNotes={activeNotes} bpm={bpm} mood={mood} keyMode={keyMode} panelContent={panelContent} />

          <div className="knob-row">
            <Knob label="TONE" value={tone} color="#61d9aa" onChange={setTone} />
            <Knob label="REVERB" value={reverb} color="#62c8e6" onChange={setReverb} />
            <Knob label="DELAY" value={delay} color="#f1b671" onChange={setDelay} />
            <Knob label="MASTER" value={volume} color="#ff758a" onChange={setVolume} />
          </div>

          <div className="side-stack">
            <button aria-label="Microphone">●<small>MIC</small></button>
            <button className={connection === "connected" ? "side-active" : ""} onClick={connectMidi}>COM<small>{connection === "connected" ? "ON" : "MIDI"}</small></button>
          </div>
        </div>

        <div className="pad-row">
          <div className="mode-pads">
            <button className={keyMode === "poly" ? "active-pad" : ""} onClick={() => { setKeyMode("poly"); setPanel("keys"); }}><span>●</span><small>主音</small></button>
            <button className={keyMode === "mono" ? "active-pad" : ""} onClick={() => { setKeyMode("mono"); setPanel("keys"); }}><span>⌁</span><small>旋律单音</small></button>
            <button className={keyMode === "chord" ? "active-pad" : ""} onClick={() => { setKeyMode("chord"); setPanel("keys"); }}><span>✣</span><small>和弦</small></button>
            <button className={loopStatus !== "idle" ? "active-pad loop-active" : ""} onClick={() => { setPanel("loop"); if (loopStatus === "idle") startLoopRecording(); }}><span>∞</span><small>LOOP</small></button>
            <button className={panel === "fx" ? "active-pad" : ""} onClick={() => setPanel("fx")}><span>≋</span><small>FX</small></button>
          </div>
          <div className="sound-pads">
            {MOODS.map((item, index) => <button key={item.name} className={moodIndex === index ? "selected" : ""} style={{ "--pad-color": `rgb(${item.colors[2].join(",")})` } as React.CSSProperties} onClick={() => { setMoodIndex(index); setStatusText(`${item.name}配色 · ${item.description}`); }}><b>{item.name}</b><small>{item.english}</small></button>)}
          </div>
          <div className="step-pads">
            {Array.from({ length: 8 }, (_, index) => <button key={index} className={`${stepPattern[index] ? "armed" : ""} ${playing && activeStep === index ? "step-on" : ""}`} onClick={() => { setStepPattern((pattern) => pattern.map((value, candidate) => candidate === index ? !value : value)); setPanel("step"); }}><b>{index + 1}</b><small>{activeStep === index ? "NOW" : stepPattern[index] ? "ON" : "STEP"}</small></button>)}
          </div>
          <button className="more-button" onClick={() => { setPanel("step"); setLightMode((mode) => mode === "palette71" ? "rgb15" : "palette71"); }}>•••<small>{lightMode === "rgb15" ? "RGB 15" : "COMPAT 71"}</small></button>
        </div>

        <div className="lower-deck">
          <aside className="transport">
            <div className="edit-row"><button onClick={() => setPanel("keys")}>⇧<small>KEY MODE</small></button><button onClick={() => setPanel("loop")}>▣<small>LOOP VIEW</small></button><button onClick={() => setPanel("fx")}>✂<small>FX RACK</small></button></div>
            <div className="play-row"><button className={loopStatus === "recording" ? "recording" : ""} onClick={startLoopRecording}>◉<small>LOOP REC</small></button><button className={playing ? "playing" : ""} onClick={() => setPlaying((value) => !value)}>{playing ? "Ⅱ" : "▶"}<small>{playing ? "PAUSE" : stepMode === "metronome" ? "CLICK" : "STEP"}</small></button><button onClick={() => { setPlaying(false); stopLoop(false); engineRef.current?.releaseAll(); generatedNotesRef.current.clear(); heldRef.current.clear(); heldCountsRef.current.clear(); setActiveNotes(new Set()); allLightsOff(); }}>■<small>STOP ALL</small></button></div>
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
