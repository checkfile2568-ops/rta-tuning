import json
import os
import subprocess
from pathlib import Path
from urllib.parse import urlparse

BASE = Path(__file__).resolve().parent
APPS_FILE = BASE / "apps.json"
CONFIG_FILE = BASE / "config.json"


class AppControlError(Exception):
    pass


def _load_json(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise AppControlError(f"invalid JSON: {path.name}: {exc}") from exc


def _apps():
    data = _load_json(APPS_FILE, {"apps": {}})
    apps = data.get("apps") or {}
    if not isinstance(apps, dict):
        raise AppControlError("apps.json must contain an apps object")
    return apps


def list_apps():
    return sorted(_apps().keys())


def open_app(app_id: str):
    app = _apps().get(str(app_id))
    if not app:
        raise AppControlError("application is not in allowlist")
    path = str(app.get("path") or "").strip()
    args = app.get("args") or []
    if not path:
        raise AppControlError("application path is missing")
    if not os.path.exists(path):
        raise AppControlError("application executable not found")
    if not isinstance(args, list) or any(not isinstance(x, str) for x in args):
        raise AppControlError("application args must be a string array")
    subprocess.Popen([path, *args], close_fds=True)
    return {"message": f"application opened: {app_id}", "app_id": app_id}


def close_app(app_id: str):
    app = _apps().get(str(app_id))
    if not app:
        raise AppControlError("application is not in allowlist")
    image_name = str(app.get("image_name") or "").strip()
    if not image_name:
        raise AppControlError("image_name is required for closing an application")
    proc = subprocess.run(
        ["taskkill", "/IM", image_name, "/T"],
        capture_output=True,
        text=True,
        timeout=15,
    )
    if proc.returncode != 0:
        raise AppControlError((proc.stderr or proc.stdout or "taskkill failed").strip())
    return {"message": f"application closed: {app_id}", "app_id": app_id}


def open_url(url: str):
    url = str(url or "").strip()
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise AppControlError("only http/https URLs are allowed")

    cfg = _load_json(CONFIG_FILE, {})
    allowed_hosts = [str(x).lower().strip() for x in (cfg.get("allowed_url_hosts") or []) if str(x).strip()]
    host = parsed.hostname.lower()
    if not allowed_hosts:
        raise AppControlError("allowed_url_hosts is empty; URL opening is disabled")
    if not any(host == h or host.endswith("." + h) for h in allowed_hosts):
        raise AppControlError("URL host is not in allowlist")

    os.startfile(url)  # Windows ShellExecute via Python
    return {"message": "URL opened", "host": host}
