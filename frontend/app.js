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
};

const state = {
  recording: false,
  recognition: null,
  supported: false,
  finals: [],
  interim: "",
  lastTranslatedKey: "",
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
  elements.sourceLang.value = "en";
  elements.targetLang.value = "es";
}

function getFinalText() {
  return state.finals.join(" ");
}

function renderTranscript() {
  const final = getFinalText();
  let html = "";
  if (final) {
    html += escapeHtml(final) + " ";
  }
  if (state.interim) {
    html += `<span class="interim">${escapeHtml(state.interim)}</span>`;
  }
  if (html) {
    elements.transcript.innerHTML = html;
    elements.transcriptHint.hidden = true;
  } else {
    elements.transcript.textContent = "";
    elements.transcriptHint.hidden = false;
  }
}

function renderTranslation(text) {
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

function scheduleTranslation(force = false) {
  const text = getFinalText().trim();
  if (!text) {
    renderTranslation("");
    state.lastTranslatedKey = "";
    return;
  }
  clearTimeout(translateTimer);
  translateTimer = setTimeout(() => translateText(text), force ? 0 : 800);
}

async function translateText(text) {
  const key = `${currentSource()}:${currentTarget()}:${text}`;
  if (key === state.lastTranslatedKey) return;
  const source = currentSource();
  const target = currentTarget();

  setStatus(state.recording ? "Listening…" : "Translating…");
  try {
    const res = await fetch(`${API_BASE}/api/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: text, source, target }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    renderTranslation(data.translatedText);
    state.lastTranslatedKey = key;
    setStatus(state.recording ? "Listening…" : "Ready");
  } catch (err) {
    renderTranslation("");
    showBanner("error", `Translation failed: ${err.message}. Check that the backend is running.`);
    setStatus("Translation unavailable", true);
  }
}

function stopStreamTracks() {
  navigator.mediaDevices
    .getUserMedia({ audio: true })
    .then((stream) => stream.getTracks().forEach((track) => track.stop()))
    .catch(() => {});
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
      state.interim = "";
      scheduleTranslation();
    }
    renderTranscript();
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
  elements.micBtn.classList.remove("listening");
  elements.micLabel.textContent = "Start listening";
  renderTranscript();
  scheduleTranslation(true);
  if (!state.finals.length) setStatus("Ready");
}

async function toggleRecording() {
  if (state.recording) {
    stopRecording();
    return;
  }
  if (!state.supported) return;

  setStatus("Requesting microphone…");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    startRecognition();
  } catch (err) {
    showBanner("error", "Microphone permission was denied or unavailable. Allow mic access in your browser and try again.");
    setStatus("Microphone blocked", true);
  }
}

function clearAll() {
  stopRecording();
  state.finals = [];
  state.interim = "";
  state.lastTranslatedKey = "";
  renderTranscript();
  renderTranslation("");
  clearBanner();
  setStatus("Cleared");
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
    scheduleTranslation(true);
  });
  elements.targetLang.addEventListener("change", () => scheduleTranslation(true));
  elements.copyTranscriptBtn.addEventListener("click", () =>
    copyText(getFinalText(), elements.copyTranscriptBtn)
  );
  elements.copyTranslationBtn.addEventListener("click", () =>
    copyText(elements.translation.textContent, elements.copyTranslationBtn)
  );
}

function init() {
  populateLanguages();
  bindEvents();
  initSupport();
  setStatus("Idle");
}

init();
