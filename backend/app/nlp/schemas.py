"""Schema constants for NLP predictions (online edition, OpenRouter-only).

Provides the constant names that `app.api.analysis` imports at module level.
No actual model adapters are loaded — this is a compatibility shim for
the online edition which uses OpenRouter `openrouter/free` for sentiment
+ NER, not local NLP adapters.
"""

#: Status constants used throughout analysis.py
STATUS_OK = "ok"
STATUS_INFERENCE_ERROR = "inference_error"
STATUS_WEIGHTS_UNAVAILABLE = "weights_unavailable"

#: Reason constants
REASON_MODEL_ERROR = "model_error"
REASON_WEIGHTS_UNAVAILABLE = "weights_unavailable"

#: Prediction classes — set to None for online edition compatibility.
# The online edition runs sentiment + NER via OpenRouter; local adapter
# instantiation is disabled (see config.py: db_usable() always False).
NerPrediction = None  # type: ignore
SentimentPrediction = None  # type: ignore