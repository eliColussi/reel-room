// Third-party code and models, loaded on demand from public CDNs (pinned versions).
// Browsers cache them after the first load.
const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1';

export const CDN = {
  mediabunny: 'https://cdn.jsdelivr.net/npm/mediabunny@1.61.1/dist/bundles/mediabunny.min.mjs',
  transformers: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/dist/transformers.min.js',
  mediapipe: `${MP}/vision_bundle.mjs`,
  mediapipeWasm: `${MP}/wasm`,
  selfieModel: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
  faceModelFull: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_full_range/float16/latest/blaze_face_full_range.tflite',
  faceModelShort: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
  whisper: {
    base: 'onnx-community/whisper-base_timestamped',
    small: 'onnx-community/whisper-small_timestamped',
  },
};

let mb = null;
export const loadMediabunny = () => (mb ||= import(CDN.mediabunny));
