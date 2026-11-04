"""Push the daily report. Each channel is enabled by its environment variables.

  Telegram : TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
  Discord  : DISCORD_WEBHOOK_URL
  Slack    : SLACK_WEBHOOK_URL
  ntfy     : NTFY_TOPIC (optional NTFY_SERVER, default https://ntfy.sh - open source, self-hostable)
  Email    : SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, EMAIL_TO (comma separated)
"""
from __future__ import annotations

import logging
import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import requests

log = logging.getLogger(__name__)


def _chunks(text: str, size: int) -> list[str]:
    parts, cur = [], ""
    for line in text.splitlines(keepends=True):
        if len(cur) + len(line) > size:
            parts.append(cur)
            cur = ""
        cur += line
    if cur:
        parts.append(cur)
    return parts


def telegram(text: str) -> bool:
    token, chat = os.getenv("TELEGRAM_BOT_TOKEN"), os.getenv("TELEGRAM_CHAT_ID")
    if not (token and chat):
        return False
    for part in _chunks(text, 3900):
        requests.post(f"https://api.telegram.org/bot{token}/sendMessage",
                      json={"chat_id": chat, "text": part, "disable_web_page_preview": True},
                      timeout=20).raise_for_status()
    return True


def discord(text: str) -> bool:
    url = os.getenv("DISCORD_WEBHOOK_URL")
    if not url:
        return False
    for part in _chunks(text, 1900):
        requests.post(url, json={"content": part}, timeout=20).raise_for_status()
    return True


def slack(text: str) -> bool:
    url = os.getenv("SLACK_WEBHOOK_URL")
    if not url:
        return False
    for part in _chunks(text, 3500):
        requests.post(url, json={"text": part}, timeout=20).raise_for_status()
    return True


def ntfy(text: str) -> bool:
    topic = os.getenv("NTFY_TOPIC")
    if not topic:
        return False
    server = os.getenv("NTFY_SERVER", "https://ntfy.sh").rstrip("/")
    requests.post(f"{server}/{topic}", data=text[:4000].encode("utf-8"),
                  headers={"Title": "Daily Stock Analysis", "Markdown": "yes"},
                  timeout=20).raise_for_status()
    return True


def email(subject: str, text: str, html: str) -> bool:
    host, to = os.getenv("SMTP_HOST"), os.getenv("EMAIL_TO")
    if not (host and to):
        return False
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = os.getenv("SMTP_USER", "stock-bot@localhost")
    msg["To"] = to
    msg.attach(MIMEText(text, "plain", "utf-8"))
    msg.attach(MIMEText(html, "html", "utf-8"))
    with smtplib.SMTP(host, int(os.getenv("SMTP_PORT", "587")), timeout=30) as s:
        s.starttls()
        if os.getenv("SMTP_USER"):
            s.login(os.getenv("SMTP_USER"), os.getenv("SMTP_PASSWORD", ""))
        s.sendmail(msg["From"], [a.strip() for a in to.split(",")], msg.as_string())
    return True


def send_all(subject: str, text: str, html: str) -> list[str]:
    sent = []
    for name, fn in (("telegram", lambda: telegram(text)), ("discord", lambda: discord(text)),
                     ("slack", lambda: slack(text)), ("ntfy", lambda: ntfy(text)),
                     ("email", lambda: email(subject, text, html))):
        try:
            if fn():
                sent.append(name)
        except Exception as e:
            log.error("Notification via %s failed: %s", name, e)
    return sent
