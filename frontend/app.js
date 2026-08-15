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
  themeBtn: document.getElementById("theme-btn"),
  toastContainer: document.getElementById("toast-container"),
  sourceLang: document.getElementById("source-lang"),
  targetLang: document.getElementById("target-lang"),
  swapBtn: document.getElementById("swap-btn"),
  micBtn: document.getElementById("mic-btn"),
  micLabel: document.getElementById("mic-label"),
  clearBtn: document.getElementById("clear-btn"),
  transcript: document.getElementById("transcript"),
  transcriptHint: document.getElementById("transcript-hint"),
  translation: document.getElementById("translation"),
  translationMeta: document.getElementById("translation-meta"),
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
  entries: [],
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

function toast(message, kind = "info", ms = 3000) {
  const container = elements.toastContainer;
  if (!container) return;
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.setAttribute("role", kind === "error" ? "alert" : "status");
  el.textContent = message;
  container.appendChild(el);
  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    el.classList.add("hide");
    setTimeout(() => el.remove(), 250);
  };
  el.addEventListener("click", remove);
  setTimeout(remove, ms);
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
  return state.entries.map((e) => e.source).join(" ");
}

function formatTime(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

function autoScrollTranscript() {
  const el = elements.transcript;
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) {
    el.scrollTop = el.scrollHeight;
  }
}

function renderConversation() {
  let html = "";
  for (const entry of state.entries) {
    const color = entry.speakerColor || "var(--accent)";
    const tag = entry.speakerLabel
      ? `<span class="speaker-tag" style="--spk-color:${color}">${escapeHtml(entry.speakerLabel)}</span>`
      : "";
    const trans = entry.translation
      ? `<div class="conv-trans">${escapeHtml(entry.translation)}</div>`
      : `<div class="conv-trans pending" aria-hidden="true">…</div>`;
    html += `<div class="conv-entry" style="--spk-color:${color}">`;
    html += `<div class="conv-source">${tag}<span class="line-text">${escapeHtml(entry.source)}</span><time class="line-time">${entry.ts}</time></div>`;
    html += trans;
    html += `</div>`;
  }
  if (state.interim) {
    html += `<div class="line interim">${escapeHtml(state.interim)}</div>`;
  }
  if (html) {
    elements.transcript.innerHTML = html;
    elements.transcriptHint.hidden = true;
  } else {
    elements.transcript.textContent = "";
    elements.transcriptHint.hidden = false;
  }
  autoScrollTranscript();
}

function providerName(provider) {
  return provider === "libretranslate" ? "LibreTranslate" : "MyMemory";
}

function renderLive(text, provisional = false, provider = null, ms = 0) {
  elements.translation.classList.toggle("provisional", provisional);
  if (text) {
    elements.translation.textContent = text;
    elements.translationHint.hidden = true;
  } else {
    elements.translation.textContent = "";
    elements.translationHint.hidden = false;
  }
  if (elements.translationMeta) {
    if (text && provider) {
      elements.translationMeta.hidden = false;
      elements.translationMeta.textContent = `${providerName(provider)} · ${ms} ms`;
    } else {
      elements.translationMeta.hidden = true;
    }
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

function abortEntryFetches() {
  for (const entry of state.entries) {
    if (entry.ctrl) {
      try {
        entry.ctrl.abort();
      } catch {}
      entry.ctrl = null;
    }
    entry.translating = false;
  }
}

function scheduleTranslation(force = false) {
  const lastPending = [...state.entries]
    .reverse()
    .find((e) => e.pending && !e.translating);
  if (!lastPending) {
    if (!state.entries.length) {
      cancelPendingTranslation();
      renderLive("");
    }
    return;
  }
  cancelPendingTranslation();
  translateTimer = setTimeout(() => translateEntry(lastPending), force ? 0 : 400);
}

async function translateEntry(entry) {
  if (!entry.pending || entry.translating) return;
  entry.translating = true;
  const source = currentSource();
  const target = currentTarget();
  const mySeq = ++state.translateSeq;
  const controller = new AbortController();
  entry.ctrl = controller;
  try {
    const res = await fetch(`${API_BASE}/api/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: entry.source, source, target }),
      signal: controller.signal,
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    entry.translation = data.translatedText;
    entry.pending = false;
    state.streamFailures = 0;
    state.lastTranslatedKey = `${source}:${target}::${entry.source}`;
    if (
      mySeq === state.translateSeq &&
      state.entries[state.entries.length - 1] === entry
    ) {
      state.lastTranslatedFinals = getFinalText();
      state.lastInterimSent = "";
      stopSpeaking();
      renderLive(data.translatedText, false, data.provider, data.ms || 0);
      setStatus(state.recording ? "Listening…" : "Ready");
    }
    renderConversation();
  } catch (err) {
    if (err.name === "AbortError") return;
    if (mySeq !== state.translateSeq) {
      entry.translating = false;
      return;
    }
    entry.translating = false;
    entry.pending = false;
    entry.translation = "";
    toast(`Translation failed: ${err.message}. Check that the backend is running.`, "error", 6000);
    setStatus("Translation unavailable", true);
    renderConversation();
  } finally {
    if (entry.ctrl === controller) entry.ctrl = null;
  }
}

async function retranslateAll() {
  abortEntryFetches();
  for (const entry of state.entries) {
    entry.pending = true;
    entry.translation = "";
  }
  renderConversation();
  for (const entry of state.entries) {
    await translateEntry(entry);
  }
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
    translateInterim(payload);
  }, 1100);
}

async function translateInterim(text) {
  const source = currentSource();
  const target = currentTarget();
  const key = `${source}:${target}:~:${text}`;
  if (key === state.lastTranslatedKey) return;
  const mySeq = ++state.translateSeq;
  if (state.abortController) state.abortController.abort();
  const controller = new AbortController();
  state.abortController = controller;
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
    state.streamFailures = 0;
    state.lastTranslatedKey = key;
    renderLive(data.translatedText, true, data.provider, data.ms || 0);
  } catch (err) {
    if (err.name === "AbortError") return;
    if (mySeq !== state.translateSeq) return;
    if (state.abortController === controller) state.abortController = null;
    state.streamFailures += 1;
    if (state.streamFailures >= 3) {
      state.streamingEnabled = false;
      toast("Live translation is having trouble — switching to translate-on-pause only.", "warn", 6000);
      setStatus("Listening…");
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

const THEMES = ["system", "light", "dark"];

function applyTheme(theme) {
  const root = document.documentElement;
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (theme === "system") {
    root.removeAttribute("data-theme");
    if (meta) meta.content = "light dark";
  } else {
    root.dataset.theme = theme;
    if (meta) meta.content = theme;
  }
}

function cycleTheme() {
  let current = "system";
  try {
    current = localStorage.getItem("vt.theme") || "system";
  } catch {}
  const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
  try {
    localStorage.setItem("vt.theme", next);
  } catch {}
  applyTheme(next);
  toast(`Theme: ${next}`, "info", 1200);
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
    toast("Listening — speak now.", "info", 2000);
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
      const speaker = speakers.currentSpeaker();
      state.entries.push({
        source: finalText.trim(),
        translation: "",
        speakerLabel: speaker ? speaker.label : "",
        speakerColor: speaker ? speaker.color : "",
        ts: formatTime(new Date()),
        pending: true,
        translating: false,
        ctrl: null,
      });
      state.interim = "";
      scheduleTranslation();
    }
    renderConversation();
    scheduleInterimTranslation();
  };

  recognition.onerror = (event) => {
    switch (event.error) {
      case "not-allowed":
      case "service-not-allowed":
        stopRecording();
        toast("Microphone permission was denied. Allow mic access and try again.", "error", 5000);
        setStatus("Microphone blocked", true);
        break;
      case "no-speech":
        break;
      case "audio-capture":
        stopRecording();
        toast("No microphone found. Connect a microphone and try again.", "error", 5000);
        setStatus("No microphone detected", true);
        break;
      case "network":
        stopRecording();
        toast("Speech service network error. Check your connection and try again.", "error", 5000);
        setStatus("Network error", true);
        break;
      case "aborted":
        break;
      default:
        toast(`Speech recognition error: ${event.error}`, "warn", 4000);
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
  state.interim = "";
  renderConversation();
  state.lastInterimSent = "";
  scheduleTranslation(true);
  if (!state.entries.length) setStatus("Ready");
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
    toast("Microphone permission was denied or unavailable. Allow mic access and try again.", "error", 5000);
    setStatus("Microphone blocked", true);
  }
}

function clearAll() {
  stopRecording();
  stopSpeaking();
  cancelPendingTranslation();
  abortEntryFetches();
  state.entries = [];
  state.interim = "";
  state.lastTranslatedKey = "";
  state.lastTranslatedFinals = "";
  state.lastInterimSent = "";
  state.streamFailures = 0;
  state.streamingEnabled = true;
  renderConversation();
  renderLive("");
  clearBanner();
  setStatus("Cleared");
}

function resetTranslationState() {
  cancelPendingTranslation();
  state.lastTranslatedKey = "";
  state.lastTranslatedFinals = "";
  state.lastInterimSent = "";
  renderLive("");
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
  retranslateAll();
}

async function copyText(text, button) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied to clipboard.", "info", 1500);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand("copy");
      toast("Copied to clipboard.", "info", 1500);
    } catch {
      toast("Copy failed.", "error", 3000);
    }
    textarea.remove();
  }
  const original = button.textContent;
  button.textContent = "✓";
  setTimeout(() => (button.textContent = original), 1200);
}

function bindShortcuts() {
  window.addEventListener("keydown", (e) => {
    const t = e.target;
    const typing =
      t &&
      (t.tagName === "INPUT" ||
        t.tagName === "SELECT" ||
        t.tagName === "TEXTAREA" ||
        t.isContentEditable);
    if (typing) return;
    if (e.code === "Space" && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      if (state.supported) toggleRecording();
    } else if (e.key === "Escape") {
      stopSpeaking();
    } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      clearAll();
    }
  });
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
  elements.themeBtn.addEventListener("click", cycleTheme);
  elements.sourceLang.addEventListener("change", () => {
    if (state.recognition) {
      try {
        state.recognition.lang = currentSource();
      } catch {}
    }
    resetTranslationState();
    retranslateAll();
  });
  elements.targetLang.addEventListener("change", () => {
    resetTranslationState();
    retranslateAll();
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
  let theme = "system";
  try {
    theme = localStorage.getItem("vt.theme") || "system";
  } catch {}
  applyTheme(theme);
  populateLanguages();
  bindEvents();
  initSupport();
  initTts();
  speakers.init();
  initConnectivity();
  bindShortcuts();
  registerServiceWorker();
  setStatus("Idle");
}

init();
