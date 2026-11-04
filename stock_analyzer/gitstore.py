"""Keep config.yaml (the watchlist) in a GitHub repository.

Free cloud hosts (Render, Koyeb, Hugging Face Spaces...) wipe the container's disk
on every restart. With GITHUB_TOKEN and WATCHLIST_REPO set, the live app loads the
watchlist from the repo at start-up and commits each change back, so edits survive
restarts and the scheduled daily report uses the same list.

The token needs only "Contents: read and write" on that one repository
(a fine-grained personal access token).
"""
from __future__ import annotations

import base64
import logging
from concurrent.futures import ThreadPoolExecutor

import requests

log = logging.getLogger(__name__)
API = "https://api.github.com"


class GitHubStore:
    def __init__(self, repo: str, token: str, path: str = "config.yaml", branch: str = "main",
                 session: requests.Session | None = None):
        self.repo, self.path, self.branch = repo, path, branch
        self.http = session or requests.Session()
        self.http.headers.update({"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
                                  "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "stock-analyzer"})
        self.sha: str | None = None
        self._pool = ThreadPoolExecutor(max_workers=1)  # commits run one at a time, in order

    @property
    def url(self) -> str:
        return f"{API}/repos/{self.repo}/contents/{self.path}"

    def pull(self) -> str | None:
        try:
            r = self.http.get(self.url, params={"ref": self.branch}, timeout=15)
            if r.status_code == 404:
                return None
            r.raise_for_status()
            body = r.json()
            self.sha = body["sha"]
            return base64.b64decode(body["content"]).decode("utf-8")
        except Exception as e:
            log.error("Could not load %s from GitHub (%s): %s", self.path, self.repo, e)
            return None

    def push(self, text: str, message: str) -> bool:
        for attempt in (1, 2):
            payload = {"message": message, "branch": self.branch,
                       "content": base64.b64encode(text.encode("utf-8")).decode("ascii")}
            if self.sha:
                payload["sha"] = self.sha
            try:
                r = self.http.put(self.url, json=payload, timeout=20)
                if r.status_code in (409, 422) and attempt == 1:  # file changed on GitHub: refresh sha, retry
                    self.pull()
                    continue
                r.raise_for_status()
                self.sha = r.json()["content"]["sha"]
                return True
            except Exception as e:
                log.error("Could not save %s to GitHub: %s", self.path, e)
                return False
        return False

    def push_async(self, text: str, message: str):
        return self._pool.submit(self.push, text, message)
