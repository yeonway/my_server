#!/usr/bin/env python3
"""
Lightweight HTTP wrapper around the korcen-kogpt2 classifier.

Run this service separately (e.g. `python ml/korcen_service.py`) and point the
Node.js server at it via the `KORCEN_SERVICE_URL` environment variable.
"""
import json
import logging
import os
import pickle
import threading
from typing import List, Sequence

try:
    import numpy as np
    import tensorflow as tf
    from flask import Flask, jsonify, request
    from tensorflow.keras.preprocessing.sequence import pad_sequences
except ImportError as import_error:
    raise SystemExit(
        "Missing dependencies for korcen service. "
        "Install them with `pip install -r ml/requirements.txt`. "
        f"Original error: {import_error}"
    ) from import_error

LOGGER = logging.getLogger("korcen-service")
logging.basicConfig(level=os.getenv("KORCEN_LOG_LEVEL", "INFO"))

DEFAULT_MODEL_PATH = os.getenv("KORCEN_MODEL_PATH", "ml/models/vdcnn_model.h5")
DEFAULT_TOKENIZER_PATH = os.getenv("KORCEN_TOKENIZER_PATH", "ml/models/tokenizer.pickle")
DEFAULT_THRESHOLD = float(os.getenv("KORCEN_THRESHOLD", "0.5"))
DEFAULT_MAXLEN = int(os.getenv("KORCEN_MAXLEN", "1000"))
DEFAULT_HOST = os.getenv("KORCEN_SERVICE_HOST", "0.0.0.0")
DEFAULT_PORT = int(os.getenv("KORCEN_SERVICE_PORT", "5001"))

MODEL = None
TOKENIZER = None
MODEL_LOCK = threading.Lock()

app = Flask(__name__)


def _ensure_model_loaded() -> None:
    """Load the TensorFlow model and tokenizer once in a thread-safe manner."""
    global MODEL, TOKENIZER
    if MODEL is not None and TOKENIZER is not None:
        return

    with MODEL_LOCK:
        if MODEL is not None and TOKENIZER is not None:
            return

        if not os.path.exists(DEFAULT_MODEL_PATH):
            raise FileNotFoundError(f"Could not find TensorFlow model at {DEFAULT_MODEL_PATH}")
        if not os.path.exists(DEFAULT_TOKENIZER_PATH):
            raise FileNotFoundError(f"Could not find tokenizer pickle at {DEFAULT_TOKENIZER_PATH}")

        LOGGER.info("Loading korcen TensorFlow model from %s", DEFAULT_MODEL_PATH)
        MODEL = tf.keras.models.load_model(DEFAULT_MODEL_PATH)
        LOGGER.info("Loading tokenizer from %s", DEFAULT_TOKENIZER_PATH)
        with open(DEFAULT_TOKENIZER_PATH, "rb") as tokenizer_file:
            TOKENIZER = pickle.load(tokenizer_file)
        LOGGER.info("Model and tokenizer ready")


def _preprocess_text(text: str) -> str:
    if not isinstance(text, str):
        return ""
    return text.strip().lower()


def _predict_batch(texts: Sequence[str], maxlen: int, threshold: float) -> List[dict]:
    _ensure_model_loaded()

    encoded_sequences = []
    for text in texts:
        sentence = _preprocess_text(text)
        encoded = TOKENIZER.encode_plus(
            sentence,
            max_length=maxlen,
            padding="max_length",
            truncation=True
        )["input_ids"]
        encoded_sequences.append(encoded)

    padded = pad_sequences(encoded_sequences, maxlen=maxlen, truncating="post")
    predictions = MODEL.predict(padded, verbose=0)

    # Some TF models may return nested lists; convert to scalar floats.
    flattened = predictions.reshape(-1)
    results = []
    for index, score in enumerate(flattened):
        float_score = float(np.clip(score, 0.0, 1.0))
        results.append(
            {
                "index": index,
                "score": float_score,
                "flagged": bool(float_score >= threshold),
            }
        )
    return results


@app.route("/health", methods=["GET"])
def health():
    try:
        model_ready = MODEL is not None and TOKENIZER is not None
        if not model_ready:
            _ensure_model_loaded()
        return jsonify({"status": "ok"}), 200
    except FileNotFoundError as missing_file_error:
        return jsonify({"status": "error", "message": str(missing_file_error)}), 500
    except Exception as exc:  # pylint: disable=broad-except
        LOGGER.exception("Health check failed: %s", exc)
        return jsonify({"status": "error", "message": str(exc)}), 500


@app.route("/classify", methods=["POST"])
def classify():
    payload = request.get_json(force=True, silent=True) or {}
    raw_texts = payload.get("texts")

    if isinstance(raw_texts, str):
        raw_texts = [raw_texts]
    if not isinstance(raw_texts, list) or not raw_texts:
        return (
            jsonify({"status": "error", "message": "Provide 'texts' as a non-empty list."}),
            400,
        )

    maxlen = int(payload.get("maxlen") or DEFAULT_MAXLEN)
    threshold = float(payload.get("threshold") or DEFAULT_THRESHOLD)

    results = _predict_batch(raw_texts, maxlen=maxlen, threshold=threshold)
    flagged_indices = [item["index"] for item in results if item["flagged"]]

    return (
        jsonify(
            {
                "status": "ok",
                "threshold": threshold,
                "results": results,
                "flagged_indices": flagged_indices,
            }
        ),
        200,
    )


def main():
    try:
        _ensure_model_loaded()
    except Exception as load_error:  # pylint: disable=broad-except
        LOGGER.error("Failed to load korcen model: %s", load_error)
        raise

    LOGGER.info("Starting korcen service on %s:%s", DEFAULT_HOST, DEFAULT_PORT)
    app.run(host=DEFAULT_HOST, port=DEFAULT_PORT)


if __name__ == "__main__":
    main()
