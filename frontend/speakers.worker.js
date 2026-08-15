"use strict";

const ONNX_VERSION = "1.20.1";
const ONNX_URL = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ONNX_VERSION}/dist/ort.wasm.min.mjs`;
const ONNX_WASM_PATH = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ONNX_VERSION}/dist/`;
const DIARIZATION_URL = "https://cdn.jsdelivr.net/npm/diarization-js@0.1.0/dist/index.js";

let pipeline = null;

async function init() {
  const ort = await import(ONNX_URL);
  if (ort.env) {
    ort.env.wasm.wasmPaths = ONNX_WASM_PATH;
  }
  const lib = await import(DIARIZATION_URL);
  const { ensureArtifacts, DiarizationPipeline } = lib;
  const artifacts = await ensureArtifacts({
    onProgress: (p) =>
      postMessage({
        type: "artifact-progress",
        file: p.file,
        loaded: p.loaded,
        total: p.total,
      }),
  });
  pipeline = await DiarizationPipeline.create({
    ort,
    segmentationModel: artifacts.segmentationModel,
    embeddingModel: artifacts.embeddingModel,
    pldaParamsJson: artifacts.pldaParamsJson,
    executionProviders: ["wasm"],
  });
  postMessage({ type: "ready" });
}

self.onmessage = async (event) => {
  const msg = event.data;
  switch (msg.type) {
    case "init":
      try {
        await init();
      } catch (err) {
        postMessage({ type: "error", message: String((err && err.message) || err) });
      }
      break;
    case "process":
      if (!pipeline) return;
      try {
        const { result, metrics } = await pipeline.run(msg.audio, msg.sampleRate);
        postMessage({
          type: "segments",
          id: msg.id,
          segments: result.segments,
          numSpeakers: result.numSpeakers,
          metrics,
        });
      } catch (err) {
        postMessage({ type: "process-error", id: msg.id, message: String((err && err.message) || err) });
      }
      break;
    case "terminate":
      self.close();
      break;
  }
};
