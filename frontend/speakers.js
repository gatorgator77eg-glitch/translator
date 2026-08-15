"use strict";

(function () {
  const WINDOW_SECONDS = 60;
  const PROCESS_INTERVAL_MS = 5000;
  const ACTIVE_SECONDS = 120;
  const TALK_HOLD_MS = 6000;
  const TARGET_SAMPLE_RATE = 16000;
  const MIN_WINDOW_SECONDS = 3;

  const namesKey = "vt.speakerNames";
  let names = {};
  try {
    names = JSON.parse(localStorage.getItem(namesKey) || "{}");
  } catch {}

  const elements = {
    people: document.getElementById("people-count"),
    status: document.getElementById("room-status"),
    chips: document.getElementById("speaker-chips"),
  };

  let ctx = null;
  let sourceNode = null;
  let processor = null;
  let resampler = null;
  let chunks = [];
  let totalSeconds = 0;
  let capturing = false;
  let worker = null;
  let workerReady = false;
  let workerFailed = false;
  let intervalTimer = null;
  let uiTimer = null;
  let processing = false;
  let seq = 0;
  let currentWindowStart = 0;

  const speakers = new Map();
  let currentTag = null;
  let talkingTag = null;
  let lastTalkingAt = 0;

  class Resampler {
    constructor(inRate, outRate) {
      this.inRate = inRate;
      this.outRate = outRate;
      this.pos = 0;
    }

    process(input) {
      const inRate = this.inRate;
      const outRate = this.outRate;
      const outLength = Math.max(
        0,
        Math.floor(((this.pos + input.length) * outRate) / inRate) -
          Math.floor((this.pos * outRate) / inRate)
      );
      if (outLength === 0) {
        this.pos += input.length;
        return new Float32Array(0);
      }
      const out = new Float32Array(outLength);
      const firstOut = Math.ceil((this.pos * outRate) / inRate);
      for (let i = 0; i < outLength; i++) {
        const t = ((firstOut + i) * inRate) / outRate;
        const k = t - this.pos;
        const k0 = Math.floor(k);
        const frac = k - k0;
        const i0 = Math.min(Math.max(k0, 0), input.length - 1);
        const i1 = Math.min(i0 + 1, input.length - 1);
        out[i] = input[i0] + (input[i1] - input[i0]) * frac;
      }
      this.pos += input.length;
      return out;
    }
  }

  function setStatus(message, isError = false) {
    if (!elements.status) return;
    elements.status.textContent = message;
    elements.status.classList.toggle("error", isError);
  }

  function tagNumber(tag) {
    const n = Number(tag);
    return Number.isFinite(n) ? n : 0;
  }

  function speakerColor(tag) {
    const hue = (tagNumber(tag) * 137.5) % 360;
    return `hsl(${Math.round(hue)} 70% 55%)`;
  }

  function saveNames() {
    try {
      localStorage.setItem(namesKey, JSON.stringify(names));
    } catch {}
  }

  function ensureWorker() {
    if (worker || workerFailed || typeof Worker === "undefined") return;
    try {
      worker = new Worker("speakers.worker.js");
    } catch {
      workerFailed = true;
      setStatus("Speaker detection unavailable in this browser.", true);
      return;
    }
    worker.onmessage = (event) => handleMessage(event.data);
    worker.onerror = () => {
      workerFailed = true;
      setStatus("Speaker detection unavailable (worker failed to load).", true);
      render();
    };
    worker.postMessage({ type: "init" });
    setStatus("Loading speaker detection model…");
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case "artifact-progress":
        if (msg.total) {
          const pct = Math.round((msg.loaded / msg.total) * 100);
          setStatus(`Loading speaker model… (${pct}%)`);
        } else {
          setStatus(`Loading speaker model… (${msg.file})`);
        }
        break;
      case "ready":
        workerReady = true;
        render();
        break;
      case "segments":
        onSegments(msg.segments);
        break;
      case "process-error":
        processing = false;
        break;
      case "error":
        workerFailed = true;
        setStatus(`Speaker detection unavailable: ${msg.message}`, true);
        render();
        break;
    }
  }

  function start(stream) {
    if (ctx) stop();

    ensureWorker();
    chunks = [];
    totalSeconds = 0;
    currentWindowStart = 0;
    currentTag = null;
    talkingTag = null;
    lastTalkingAt = 0;
    speakers.clear();
    resampler = null;
    capturing = true;

    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: TARGET_SAMPLE_RATE,
      });
    } catch {
      ctx = null;
    }
    if (!ctx) {
      setStatus("Speaker detection unavailable in this browser.", true);
      render();
      return;
    }

    sourceNode = ctx.createMediaStreamSource(stream);
    processor = ctx.createScriptProcessor(2048, 1, 1);
    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      let samples = input;
      if (ctx.sampleRate !== TARGET_SAMPLE_RATE) {
        if (!resampler) resampler = new Resampler(ctx.sampleRate, TARGET_SAMPLE_RATE);
        samples = resampler.process(input);
      }
      if (samples.length) {
        chunks.push(samples);
        totalSeconds += samples.length / TARGET_SAMPLE_RATE;
        trim();
      }
    };
    sourceNode.connect(processor);
    processor.connect(ctx.destination);

    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    intervalTimer = setInterval(onTick, PROCESS_INTERVAL_MS);
    if (!uiTimer) {
      uiTimer = setInterval(() => {
        if (ctx && ctx.state === "suspended") {
          ctx.resume().catch(() => {});
          setStatus("Room needs audio access — click Start listening again if it stays blocked.", true);
        }
        if (talkingTag && Date.now() - lastTalkingAt >= TALK_HOLD_MS) {
          talkingTag = null;
          render();
        }
      }, 1000);
    }
    render();
  }

  function stop() {
    if (intervalTimer) {
      clearInterval(intervalTimer);
      intervalTimer = null;
    }
    if (uiTimer) {
      clearInterval(uiTimer);
      uiTimer = null;
    }
    if (processor) {
      try {
        processor.disconnect();
      } catch {}
      processor.onaudioprocess = null;
      processor = null;
    }
    if (sourceNode) {
      try {
        sourceNode.disconnect();
      } catch {}
      sourceNode = null;
    }
    if (ctx) {
      ctx.close().catch(() => {});
      ctx = null;
    }
    resampler = null;
    chunks = [];
    totalSeconds = 0;
    currentWindowStart = 0;
    capturing = false;
    talkingTag = null;
    lastTalkingAt = 0;
    currentTag = null;
    render();
  }

  function trim() {
    while (
      chunks.length > 1 &&
      totalSeconds - chunks[0].length / TARGET_SAMPLE_RATE >= WINDOW_SECONDS
    ) {
      totalSeconds -= chunks[0].length / TARGET_SAMPLE_RATE;
      chunks.shift();
    }
  }

  function concatWindow(seconds) {
    const outLength = Math.floor(seconds * TARGET_SAMPLE_RATE);
    const out = new Float32Array(outLength);
    let write = outLength;
    for (let i = chunks.length - 1; i >= 0 && write > 0; i--) {
      const c = chunks[i];
      const take = Math.min(c.length, write);
      write -= take;
      out.set(c.subarray(c.length - take), write);
    }
    return out;
  }

  function onTick() {
    if (!workerReady || workerFailed || processing) return;
    const windowSeconds = Math.min(totalSeconds, WINDOW_SECONDS);
    if (windowSeconds < MIN_WINDOW_SECONDS) return;
    currentWindowStart = totalSeconds - windowSeconds;
    const audio = concatWindow(windowSeconds);
    const id = ++seq;
    processing = true;
    worker.postMessage({ type: "process", id, sampleRate: TARGET_SAMPLE_RATE, audio }, [audio.buffer]);
  }

  function onSegments(segments) {
    processing = false;
    if (!capturing) return;
    if (!segments || !segments.length) return;
    const now = Date.now();
    const windowEnd = currentWindowStart + Math.min(totalSeconds, WINDOW_SECONDS);
    let maxEnd = -1;
    for (const seg of segments) {
      const tag = String(seg.speaker);
      const absEnd = currentWindowStart + seg.end;
      let entry = speakers.get(tag);
      if (!entry) {
        entry = { lastEnd: -1, lastSeenMs: 0 };
        speakers.set(tag, entry);
      }
      if (absEnd > entry.lastEnd) {
        entry.lastEnd = absEnd;
        entry.lastSeenMs = now;
      }
      if (absEnd > maxEnd) {
        maxEnd = absEnd;
        currentTag = tag;
      }
    }
    if (maxEnd >= 0 && windowEnd - maxEnd < 3) {
      talkingTag = currentTag;
      lastTalkingAt = now;
    }
    for (const [tag, entry] of speakers) {
      if (now - entry.lastSeenMs > ACTIVE_SECONDS * 1000) speakers.delete(tag);
    }
    render();
  }

  function renameSpeaker(tag) {
    const current = names[tag] || "";
    const value = window.prompt(`Name for Speaker ${tag}`, current);
    if (value === null) return;
    names[tag] = value.trim();
    if (!names[tag]) delete names[tag];
    saveNames();
    render();
  }

  function render() {
    const size = speakers.size;
    if (elements.people) {
      elements.people.textContent = String(size);
      elements.people.title =
        size === 1 ? "1 person detected by voice" : `${size} people detected by voice`;
    }

    if (workerFailed) {
      setStatus("Speaker detection unavailable (model failed to load).", true);
    } else if (!capturing) {
      setStatus("Start listening to detect people in the room.");
    } else if (!workerReady) {
      setStatus("Loading speaker detection model…");
    } else if (size === 0) {
      setStatus("Listening for voices…");
    } else {
      setStatus(
        `${size} ${size === 1 ? "person" : "people"} detected by voice. Tap a chip to rename.`
      );
    }

    if (!elements.chips) return;
    const now = Date.now();
    const sorted = [...speakers.entries()].sort((a, b) => tagNumber(a[0]) - tagNumber(b[0]));
    elements.chips.textContent = "";
    for (const [tag] of sorted) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "speaker-chip";
      chip.title = "Click to rename this speaker";
      chip.style.setProperty("--spk-color", speakerColor(tag));
      const talking =
        tag === talkingTag && now - lastTalkingAt < TALK_HOLD_MS;
      if (talking) chip.classList.add("talking");
      else if (tag === currentTag) chip.classList.add("active");

      const dot = document.createElement("span");
      dot.className = "speaker-dot";
      dot.setAttribute("aria-hidden", "true");
      chip.appendChild(dot);

      const name = document.createElement("span");
      name.className = "speaker-name";
      name.textContent = names[tag] || `Speaker ${tag}`;
      chip.appendChild(name);

      chip.addEventListener("click", () => renameSpeaker(tag));
      elements.chips.appendChild(chip);
    }
  }

  function currentSpeaker() {
    if (!workerReady || workerFailed || !currentTag) return null;
    return {
      label: names[currentTag] || `Speaker ${currentTag}`,
      color: speakerColor(currentTag),
    };
  }

  function currentLabel() {
    const speaker = currentSpeaker();
    return speaker ? speaker.label : null;
  }

  function init() {
    if (typeof Worker === "undefined") {
      setStatus("Speaker detection not supported in this browser.", true);
      return;
    }
    setStatus("Start listening to detect people in the room.");
    render();
  }

  window.speakers = { init, start, stop, currentLabel, currentSpeaker, color: speakerColor };
})();
