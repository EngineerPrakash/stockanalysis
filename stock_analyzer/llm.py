"""Optional AI commentary using open-source LLMs.

Works with any server exposing the OpenAI-compatible /v1/chat/completions API,
which all the common open-source runtimes do:

  * Ollama      -> LLM_BASE_URL=http://localhost:11434/v1   LLM_MODEL=qwen2.5:7b / llama3.1:8b
  * LM Studio   -> LLM_BASE_URL=http://localhost:1234/v1
  * vLLM        -> LLM_BASE_URL=http://localhost:8000/v1
  * llama.cpp   -> LLM_BASE_URL=http://localhost:8080/v1

If no LLM is reachable the tool still produces a full rule-based report.
"""
from __future__ import annotations

import json
import logging
import os

import requests

from .analysis import Analysis

log = logging.getLogger(__name__)

SYSTEM = (
    "You are a disciplined equity analyst. Given technical data and headlines, write a "
    "concise 3-5 sentence assessment: the key driver, the main risk, and what would change "
    "your view. Do not invent numbers that are not in the data. Never promise returns. "
    "End with one line: 'Action: <Buy/Hold/Reduce/Sell/Wait> - <reason>'."
)


class LLMClient:
    def __init__(self, base_url: str | None = None, model: str | None = None,
                 api_key: str | None = None, timeout: int = 120):
        self.base_url = (base_url or os.getenv("LLM_BASE_URL", "http://localhost:11434/v1")).rstrip("/")
        self.model = model or os.getenv("LLM_MODEL", "qwen2.5:7b")
        self.api_key = api_key or os.getenv("LLM_API_KEY", "ollama")
        self.timeout = timeout

    def available(self) -> bool:
        try:
            r = requests.get(f"{self.base_url}/models", timeout=3,
                             headers={"Authorization": f"Bearer {self.api_key}"})
            return r.ok
        except requests.RequestException:
            return False

    def chat(self, prompt: str) -> str:
        r = requests.post(
            f"{self.base_url}/chat/completions",
            headers={"Authorization": f"Bearer {self.api_key}"},
            json={"model": self.model, "temperature": 0.3,
                  "messages": [{"role": "system", "content": SYSTEM},
                               {"role": "user", "content": prompt}]},
            timeout=self.timeout,
        )
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"].strip()

    def summarize(self, a: Analysis) -> str:
        payload = {k: v for k, v in a.to_dict().items() if k not in ("ai_summary", "checklist")}
        payload["news"] = [n["title"] for n in a.news]
        try:
            return self.chat("Analyze this stock:\n" + json.dumps(payload, default=str, indent=1))
        except Exception as e:
            log.warning("LLM summary failed for %s: %s", a.symbol, e)
            return ""

    def market_overview(self, market_name: str, indices: list[dict], results: list[Analysis]) -> str:
        brief = {
            "market": market_name,
            "indices": indices,
            "watchlist": [{"symbol": r.symbol, "score": r.score, "rating": r.rating,
                           "chg": r.change_pct} for r in results],
        }
        try:
            return self.chat("Write a 3-sentence daily market wrap for this market:\n" + json.dumps(brief))
        except Exception as e:
            log.warning("LLM market overview failed: %s", e)
            return ""
