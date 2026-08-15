"use strict";

// On-device speech-to-text (Vosk/WASM) for the "screen audio" capture mode.
// Transcribes a captured MediaStream (e.g. a Zoom meeting) locally in the
// browser — audio never leaves the device.
(function () {
  const VOSK_SCRIPT =
    "https://cdn.jsdelivr.net/npm/vosk-browser@0.0.8/dist/vosk.js";
  const SAMPLE_RATE = 16000;
  const MODEL_TIMEOUT_MS = 120000;

  // Models are .tar.gz archives that vosk-browser untars in a Web Worker
  // (spawned from a blob: URL, so model URLs below must be absolute).
  // - en/fr are hosted on GitHub Pages (CORS *). fr is CC-BY-NC-SA 4.0.
  // - id is the bookbot-kids Indonesian model (Apache-2.0), repackaged into
  //   frontend/models/vosk-model-small-id.tar.gz by scripts/setup-vosk-models.ps1
  const localModelUrl = new URL("./models/vosk-model-small-id.tar.gz", document.baseURI).href;
  const MODELS = {
    en: {
      name: "English",
      url: "https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-en-us-0.15.tar.gz",
      sizeMB: 39,
      local: false,
    },
    fr: {
      name: "French",
      url: "https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-fr-pguyot-0.3.tar.gz",
      sizeMB: 44,
      local: false,
    },
    id: {
      name: "Indonesian",
      url: localModelUrl,
      sizeMB: 42,
      local: true,
    },
  };

  let Vosk = null;
  let voskLoading = null;
  let voskLoadError = false;

  let streamRef = null;
  let ctx = null;
  let sourceNode = null;
  let processor = null;
  let resampler = null;
  let model = null;
  let modelLang = null;
  let recognizer = null;
  let capturing = false;

  let onFinalCb = null;
  let onPartialCb = null;
  let onStatusCb = null;

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

  function setStatus(message) {
    if (onStatusCb) onStatusCb(message);
  }

  function supportedLangs() {
    return Object.keys(MODELS);
  }

  function modelInfo(lang) {
    return MODELS[lang] || null;
  }

  function ensureVosk() {
    if (Vosk) return Promise.resolve(Vosk);
    if (voskLoading) return voskLoading;
    if (voskLoadError) {
      return Promise.reject(
        new Error("The on-device speech engine failed to load. Check your connection and reload.")
      );
    }
    setStatus("Loading on-device speech engine…");
    voskLoading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = VOSK_SCRIPT;
      script.onload = () => {
        if (window.Vosk) {
          Vosk = window.Vosk;
          voskLoading = null;
          resolve(Vosk);
        } else {
          voskLoadError = true;
          voskLoading = null;
          reject(new Error("The on-device speech engine failed to initialize."));
        }
      };
      script.onerror = () => {
        voskLoadError = true;
        voskLoading = null;
        reject(
          new Error("Could not download the on-device speech engine. Check your connection.")
        );
      };
      document.head.appendChild(script);
    });
    return voskLoading;
  }

  async function warm(info) {
    let res;
    try {
      res = await fetch(info.url, { method: "GET", credentials: "omit" });
    } catch (err) {
      throw new Error(`Could not fetch the ${info.name} speech model: ${err.message}`);
    }
    if (!res.ok) {
      if (info.local) {
        throw new Error(
          `The ${info.name} speech model is missing. Run scripts\\setup-vosk-models.ps1 once, then reload.`
        );
      }
      throw new Error(`The ${info.name} speech model is unavailable (${res.status}).`);
    }
    if (!res.body) return;
    // Drain the response: it reports download progress and primes the HTTP/SW
    // cache so the worker's own fetch of the same URL is served locally. The
    // worker is intentionally given the stable URL — vosk-browser persists the
    // extracted model in IndexedDB keyed on that URL, so it is loaded only once.
    const total = Number(res.headers.get("content-length")) || 0;
    const reader = res.body.getReader();
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      loaded += value ? value.length : 0;
      if (total) {
        setStatus(
          `Downloading ${info.name} speech model… (${Math.round((loaded / total) * 100)}%)`
        );
      }
    }
    setStatus(`${info.name} speech model ready.`);
  }

  async function loadModel(lang) {
    const info = modelInfo(lang);
    if (!info) {
      const list = Object.values(MODELS)
        .map((m) => m.name)
        .join(", ");
      throw new Error(`No on-device speech model for that language. Screen-audio STT supports ${list}.`);
    }
    await ensureVosk();
    setStatus(`Preparing ${info.name} speech model…`);
    await warm(info);
    let m;
    try {
      m = await Vosk.createModel(info.url, 0);
    } catch {
      throw new Error(`Failed to load the ${info.name} speech model. Check your connection.`);
    }
    m.on("error", (message) => {
      const detail = message && message.error ? ` (${message.error})` : "";
      setStatus(`Speech model error${detail}`);
    });
    return m;
  }

  function loadModelWithTimeout(lang) {
    return Promise.race([
      loadModel(lang),
      new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error("Speech model download timed out. Check your connection and try again.")
            ),
          MODEL_TIMEOUT_MS
        )
      ),
    ]);
  }

  function teardownAudio() {
    capturing = false;
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
  }

  let onResultHandler = null;
  let onPartialHandler = null;

  function wireRecognizer(rec) {
    onResultHandler = (event) => {
      const message = event.detail;
      const text = message && message.result && message.result.text;
      if (typeof text === "string" && text.trim() && onFinalCb) {
        onFinalCb(text.trim());
      }
    };
    onPartialHandler = (event) => {
      const message = event.detail;
      const partial = message && message.result && message.result.partial;
      if (typeof partial === "string" && onPartialCb) {
        onPartialCb(partial);
      }
    };
    rec.addEventListener("result", onResultHandler);
    rec.addEventListener("partialresult", onPartialHandler);
  }

  function unwireRecognizer(rec) {
    if (onResultHandler) {
      rec.removeEventListener("result", onResultHandler);
      onResultHandler = null;
    }
    if (onPartialHandler) {
      rec.removeEventListener("partialresult", onPartialHandler);
      onPartialHandler = null;
    }
  }

  function flushRecognizer(rec) {
    unwireRecognizer(rec);
    let done = false;
    const safeRemove = () => {
      try {
        rec.remove();
      } catch {}
    };
    const listener = (event) => {
      if (done) return;
      done = true;
      const message = event.detail;
      const text = message && message.result && message.result.text;
      if (typeof text === "string" && text.trim() && onFinalCb) {
        onFinalCb(text.trim());
      }
      safeRemove();
    };
    rec.addEventListener("result", listener, { once: true });
    try {
      rec.retrieveFinalResult();
    } catch {
      safeRemove();
    }
    setTimeout(() => {
      if (!done) safeRemove();
    }, 1500);
  }

  function teardown(flush) {
    teardownAudio();
    const rec = recognizer;
    recognizer = null;
    if (rec) {
      if (flush) {
        flushRecognizer(rec);
      } else {
        unwireRecognizer(rec);
        try {
          rec.remove();
        } catch {}
      }
    }
  }

  function releaseModel() {
    if (model) {
      try {
        model.terminate();
      } catch {}
      model = null;
      modelLang = null;
    }
  }

  async function start(stream, lang) {
    if (!stream || !stream.getAudioTracks || !stream.getAudioTracks().length) {
      throw new Error("No audio was captured. Share a tab or screen with audio and try again.");
    }
    teardown(false);
    streamRef = stream;

    if (!(model && modelLang === lang)) {
      if (model) releaseModel();
      model = await loadModelWithTimeout(lang);
      modelLang = lang;
    }

    const rec = new model.KaldiRecognizer(SAMPLE_RATE);
    recognizer = rec;
    wireRecognizer(rec);

    ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
    sourceNode = ctx.createMediaStreamSource(stream);
    processor = ctx.createScriptProcessor(4096, 1, 1);
    const actualRate = ctx.sampleRate || SAMPLE_RATE;
    processor.onaudioprocess = (event) => {
      if (!capturing) return;
      const recNow = recognizer;
      if (!recNow) return;
      const input = event.inputBuffer;
      if (actualRate !== SAMPLE_RATE) {
        if (!resampler) resampler = new Resampler(actualRate, SAMPLE_RATE);
        const data = resampler.process(input.getChannelData(0));
        if (!data.length) return;
        const out = ctx.createBuffer(1, data.length, SAMPLE_RATE);
        out.getChannelData(0).set(data);
        try {
          recNow.acceptWaveform(out);
        } catch {}
        return;
      }
      try {
        recNow.acceptWaveform(input);
      } catch {}
    };
    sourceNode.connect(processor);
    processor.connect(ctx.destination);

    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    capturing = true;
    setStatus("Listening to meeting audio…");
  }

  async function setLang(lang) {
    if (!streamRef) {
      throw new Error("No captured audio. Start a screen-audio session first.");
    }
    await start(streamRef, lang);
  }

  function stop() {
    teardown(true);
    streamRef = null;
  }

  function setCallbacks(callbacks) {
    onFinalCb = callbacks && callbacks.onFinal;
    onPartialCb = callbacks && callbacks.onPartial;
    onStatusCb = callbacks && callbacks.onStatus;
  }

  window.asr = {
    start,
    stop,
    setLang,
    supportedLangs,
    setCallbacks,
  };
})();
