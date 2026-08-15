"use strict";

const API_BASE = window.VOICE_TRANSLATOR_API || "http://localhost:3000";

const LANGUAGES = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  ru: "Russian",
  ar: "Arabic",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese (Simplified)",
  id: "Indonesian",
  hi: "Hindi",
  nl: "Dutch",
  tr: "Turkish",
  vi: "Vietnamese",
  pl: "Polish",
  sv: "Swedish",
  th: "Thai",
};

const elements = {
  banner: document.getElementById("banner"),
  supportBadge: document.getElementById("support-badge"),
  sourceLang: document.getElementById("source-lang"),
  targetLang: document.getElementById("target-lang"),
  swapBtn: document.getElementById("swap-btn"),
  micBtn: document.getElementById("mic-btn"),
  micLabel: document.getElementById("mic-label"),
  clearBtn: document.getElementById("clear-btn"),
  transcript: document.getElementById("transcript"),
  transcriptHint: document.getElementById("transcript-hint"),
  translation: document.getElementById("translation"),
  translationHint: document.getElementById("translation-hint"),
  statusLine: document.getElementById("status-line"),
  copyTranscriptBtn: document.getElementById("copy-transcript-btn"),
  copyTranslationBtn: document.getElementById("copy-translation-btn"),
  speakTranslationBtn: document.getElementById("speak-translation-btn"),
};

const state = {
  recording: false,
  recognition: null,
  mediaStream: null,
  supported: false,
  finals: [],
  finalSpeakers: [],
  interim: "",
  lastTranslatedKey: "",
  lastTranslatedFinals: "",
  translateSeq: 0,
  abortController: null,
  streamFailures: 0,
  streamingEnabled: true,
  interimTimer: null,
  lastInterimSent: "",
};

const tts = {
  supported: "speechSynthesis" in window,
  speaking: false,
  timer: null,
};

const SpeechRecognitionCtor =
  window.SpeechRecognition || window.webkitSpeechRecognition;

function showBanner(kind, message) {
  elements.banner.hidden = false;
  elements.banner.className = `banner ${kind}`;
  elements.banner.textContent = message;
}

function clearBanner() {
  elements.banner.hidden = true;
  elements.banner.textContent = "";
}

function setStatus(message, isError = false) {
  elements.statusLine.textContent = message;
  elements.statusLine.classList.toggle("error", isError);
}

function currentSource() {
  return elements.sourceLang.value;
}

function currentTarget() {
  return elements.targetLang.value;
}

function populateLanguages() {
  for (const [code, name] of Object.entries(LANGUAGES)) {
    for (const select of [elements.sourceLang, elements.targetLang]) {
      const option = document.createElement("option");
      option.value = code;
      option.textContent = `${name} (${code})`;
      select.appendChild(option);
    }
  }
  elements.sourceLang.value = "id";
  elements.targetLang.value = "en";
}

function getFinalText() {
  return state.finals.join(" ");
}

function renderTranscript() {
  let html = "";
  for (let i = 0; i < state.finals.length; i++) {
    const label = state.finalSpeakers[i];
    const tag = label ? `<span class="speaker-tag">${escapeHtml(label)}</span>` : "";
    html += `<div class="line">${tag}${escapeHtml(state.finals[i])}</div>`;
  }
  if (state.interim) {
    html += `<div class="line"><span class="interim">${escapeHtml(state.interim)}</span></div>`;
  }
  if (html) {
    elements.transcript.innerHTML = html;
    elements.transcriptHint.hidden = true;
  } else {
    elements.transcript.textContent = "";
    elements.transcriptHint.hidden = false;
  }
}

function renderTranslation(text, provisional = false) {
  elements.translation.classList.toggle("provisional", provisional);
  if (text) {
    elements.translation.textContent = text;
    elements.translationHint.hidden = true;
  } else {
    elements.translation.textContent = "";
    elements.translationHint.hidden = false;
  }
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

let translateTimer = null;

function cancelPendingTranslation() {
  clearTimeout(translateTimer);
  translateTimer = null;
  clearTimeout(state.interimTimer);
  state.interimTimer = null;
  state.translateSeq += 1;
  if (state.abortController) {
    state.abortController.abort();
    state.abortController = null;
  }
}

function scheduleTranslation(force = false) {
  const text = getFinalText().trim();
  if (!text) {
    cancelPendingTranslation();
    renderTranslation("");
    state.lastTranslatedKey = "";
    state.lastTranslatedFinals = "";
    return;
  }
  cancelPendingTranslation();
  translateTimer = setTimeout(() => translateText(text, { interim: false }), force ? 0 : 800);
}

function scheduleInterimTranslation() {
  if (!state.recording || !state.streamingEnabled) return;
  if (state.interimTimer) return;
  const finals = getFinalText();
  const tail = state.interim.trim();
  if (tail.length < 4) return;
  const full = (finals + " " + tail).trim();
  const payload = finals === state.lastTranslatedFinals ? tail : full;
  if (payload === state.lastInterimSent) return;
  state.interimTimer = setTimeout(() => {
    state.interimTimer = null;
    if (!state.recording || !state.streamingEnabled) return;
    state.lastInterimSent = payload;
    translateText(payload, { interim: true });
  }, 1100);
}

async function translateText(text, { interim = false } = {}) {
  const key = `${currentSource()}:${currentTarget()}:${interim ? "~" : ":"}:${text}`;
  if (key === state.lastTranslatedKey) return;
  const source = currentSource();
  const target = currentTarget();
  const mySeq = ++state.translateSeq;
  if (state.abortController) state.abortController.abort();
  const controller = new AbortController();
  state.abortController = controller;

  if (!interim) setStatus(state.recording ? "Listening…" : "Translating…");
  try {
    const res = await fetch(`${API_BASE}/api/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: text, source, target }),
      signal: controller.signal,
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    if (mySeq !== state.translateSeq) return;
    if (state.abortController === controller) state.abortController = null;
    renderTranslation(data.translatedText, interim);
    state.streamFailures = 0;
    state.lastTranslatedKey = key;
    if (!interim) {
      state.lastTranslatedFinals = getFinalText();
      state.lastInterimSent = "";
      stopSpeaking();
      setStatus(state.recording ? "Listening…" : "Ready");
    }
  } catch (err) {
    if (err.name === "AbortError") return;
    if (mySeq !== state.translateSeq) return;
    if (state.abortController === controller) state.abortController = null;
    if (interim) {
      state.streamFailures += 1;
      if (state.streamFailures >= 3) {
        state.streamingEnabled = false;
        showBanner("warn", "Live translation is having trouble — switching to translate-on-pause only.");
        setStatus("Listening…");
      }
    } else {
      renderTranslation("");
      showBanner("error", `Translation failed: ${err.message}. Check that the backend is running.`);
      setStatus("Translation unavailable", true);
    }
  }
}

function stopStreamTracks() {
  navigator.mediaDevices
    .getUserMedia({ audio: true })
    .then((stream) => stream.getTracks().forEach((track) => track.stop()))
    .catch(() => {});
}

function pickVoice(langCode) {
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return null;
  const code = langCode.toLowerCase();
  const base = code.split("-")[0];
  return (
    voices.find((v) => v.lang.toLowerCase() === code) ||
    voices.find((v) => v.lang.toLowerCase().startsWith(code + "-")) ||
    voices.find((v) => v.lang.toLowerCase().startsWith(base + "-")) ||
    voices.find((v) => v.lang.toLowerCase().startsWith(base)) ||
    null
  );
}

function updateSpeakButton() {
  const btn = elements.speakTranslationBtn;
  btn.classList.toggle("speaking", tts.speaking);
  btn.setAttribute("aria-pressed", String(tts.speaking));
  btn.title = tts.speaking ? "Stop speaking" : "Speak translation";
  btn.textContent = tts.speaking ? "⏹" : "🔊";
}

function stopSpeaking() {
  if (!tts.supported) return;
  if (tts.timer) {
    clearInterval(tts.timer);
    tts.timer = null;
  }
  if (tts.speaking || speechSynthesis.speaking) {
    speechSynthesis.cancel();
  }
  tts.speaking = false;
  updateSpeakButton();
}

function speakTranslation() {
  if (!tts.supported) return;
  const text = elements.translation.textContent.trim();
  if (!text) return;
  if (tts.speaking) {
    stopSpeaking();
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = currentTarget();
  utterance.rate = 1;
  utterance.pitch = 1;
  const voice = pickVoice(currentTarget());
  if (voice) utterance.voice = voice;
  utterance.onend = () => {
    if (tts.timer) clearInterval(tts.timer);
    tts.timer = null;
    tts.speaking = false;
    updateSpeakButton();
  };
  utterance.onerror = () => {
    if (tts.timer) clearInterval(tts.timer);
    tts.timer = null;
    tts.speaking = false;
    updateSpeakButton();
  };
  tts.speaking = true;
  updateSpeakButton();
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
  tts.timer = setInterval(() => {
    if (!tts.speaking) {
      if (tts.timer) clearInterval(tts.timer);
      tts.timer = null;
      return;
    }
    if (speechSynthesis.speaking && speechSynthesis.paused) {
      speechSynthesis.resume();
    }
  }, 5000);
}

function initTts() {
  if (!tts.supported) {
    elements.speakTranslationBtn.disabled = true;
    elements.speakTranslationBtn.title = "Speech synthesis not supported in this browser";
    return;
  }
  speechSynthesis.onvoiceschanged = () => {};
  speechSynthesis.getVoices();
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => {
      console.warn("Service worker registration failed:", err);
    });
  });
}

function initConnectivity() {
  const update = () => {
    if (navigator.onLine) {
      clearBanner();
      setStatus(state.recording ? "Listening…" : "Ready");
    } else {
      showBanner(
        "warn",
        "You're offline. The app shell is cached, but translation needs a network connection."
      );
      setStatus("Offline", true);
    }
  };
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
}

function createRecognition() {
  const recognition = new SpeechRecognitionCtor();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.lang = currentSource();
  return recognition;
}

function startRecognition() {
  const recognition = createRecognition();
  state.recognition = recognition;

  recognition.onstart = () => {
    setStatus("Listening…");
    showBanner("info", "Listening. Speak now — interim text updates live.");
  };

  recognition.onresult = (event) => {
    state.interim = "";
    let finalText = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        finalText += result[0].transcript;
      } else {
        state.interim += result[0].transcript;
      }
    }
    if (finalText) {
      state.finals.push(finalText.trim());
      state.finalSpeakers.push(speakers.currentLabel());
      state.interim = "";
      scheduleTranslation();
    }
    renderTranscript();
    scheduleInterimTranslation();
  };

  recognition.onerror = (event) => {
    switch (event.error) {
      case "not-allowed":
      case "service-not-allowed":
        stopRecording();
        showBanner("error", "Microphone permission was denied. Allow mic access in your browser and try again.");
        setStatus("Microphone blocked", true);
        break;
      case "no-speech":
        break;
      case "audio-capture":
        stopRecording();
        showBanner("error", "No microphone found. Connect a microphone and try again.");
        setStatus("No microphone detected", true);
        break;
      case "network":
        stopRecording();
        showBanner("error", "Speech service network error. Check your connection and try again.");
        setStatus("Network error", true);
        break;
      case "aborted":
        break;
      default:
        showBanner("warn", `Speech recognition error: ${event.error}`);
    }
  };

  recognition.onend = () => {
    if (state.recording) {
      try {
        recognition.start();
      } catch {
        state.recording = false;
      }
    } else {
      setStatus("Ready");
    }
  };

  recognition.start();
  state.recording = true;
  elements.micBtn.classList.add("listening");
  elements.micLabel.textContent = "Stop listening";
  clearBanner();
}

function stopRecording() {
  state.recording = false;
  if (state.recognition) {
    state.recognition.onend = null;
    try {
      state.recognition.stop();
    } catch {}
    state.recognition = null;
  }
  speakers.stop();
  if (state.mediaStream) {
    state.mediaStream.getTracks().forEach((track) => track.stop());
    state.mediaStream = null;
  }
  elements.micBtn.classList.remove("listening");
  elements.micLabel.textContent = "Start listening";
  renderTranscript();
  state.lastInterimSent = "";
  scheduleTranslation(true);
  if (!state.finals.length) setStatus("Ready");
}

async function toggleRecording() {
  if (state.recording) {
    stopRecording();
    return;
  }
  if (!state.supported) return;

  stopSpeaking();

  setStatus("Requesting microphone…");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.mediaStream = stream;
    speakers.start(stream);
    startRecognition();
  } catch (err) {
    showBanner("error", "Microphone permission was denied or unavailable. Allow mic access in your browser and try again.");
    setStatus("Microphone blocked", true);
  }
}

function clearAll() {
  stopRecording();
  stopSpeaking();
  cancelPendingTranslation();
  state.finals = [];
  state.finalSpeakers = [];
  state.interim = "";
  state.lastTranslatedKey = "";
  state.lastTranslatedFinals = "";
  state.lastInterimSent = "";
  state.streamFailures = 0;
  state.streamingEnabled = true;
  renderTranscript();
  renderTranslation("");
  clearBanner();
  setStatus("Cleared");
}

function resetTranslationState() {
  cancelPendingTranslation();
  state.lastTranslatedKey = "";
  state.lastTranslatedFinals = "";
  state.lastInterimSent = "";
  renderTranslation("");
}

function swapLanguages() {
  const source = currentSource();
  elements.sourceLang.value = currentTarget();
  elements.targetLang.value = source;
  if (state.recognition) {
    try {
      state.recognition.lang = currentSource();
    } catch {}
  }
  resetTranslationState();
  scheduleTranslation(true);
}

async function copyText(text, button) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    const original = button.textContent;
    button.textContent = "✓";
    setTimeout(() => (button.textContent = original), 1200);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand("copy");
    } catch {}
    textarea.remove();
  }
}

function initSupport() {
  if (!SpeechRecognitionCtor) {
    elements.supportBadge.hidden = false;
    elements.supportBadge.className = "badge warn";
    elements.supportBadge.textContent = "Not supported in this browser";
    showBanner(
      "warn",
      "Your browser doesn't support the Web Speech API. Use Chrome, Edge, or Safari (desktop Firefox isn't supported)."
    );
    setStatus("Unsupported browser", true);
    elements.micBtn.disabled = true;
    return;
  }
  elements.supportBadge.hidden = false;
  elements.supportBadge.className = "badge ok";
  elements.supportBadge.textContent = "Supported browser ✓";
  state.supported = true;
}

function bindEvents() {
  elements.micBtn.addEventListener("click", toggleRecording);
  elements.clearBtn.addEventListener("click", clearAll);
  elements.swapBtn.addEventListener("click", swapLanguages);
  elements.sourceLang.addEventListener("change", () => {
    if (state.recognition) {
      try {
        state.recognition.lang = currentSource();
      } catch {}
    }
    resetTranslationState();
    scheduleTranslation(true);
  });
  elements.targetLang.addEventListener("change", () => {
    resetTranslationState();
    scheduleTranslation(true);
  });
  elements.copyTranscriptBtn.addEventListener("click", () =>
    copyText(getFinalText(), elements.copyTranscriptBtn)
  );
  elements.copyTranslationBtn.addEventListener("click", () =>
    copyText(elements.translation.textContent, elements.copyTranslationBtn)
  );
  elements.speakTranslationBtn.addEventListener("click", speakTranslation);
}

function init() {
  populateLanguages();
  bindEvents();
  initSupport();
  initTts();
  speakers.init();
  initConnectivity();
  registerServiceWorker();
  setStatus("Idle");
}

init();
