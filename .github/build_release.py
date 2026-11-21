from __future__ import annotations

import hashlib
import os
import io
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

PY_VERSION = "3.14.10"
PY_ZIP = f"python-{PY_VERSION}-embed-amd64.zip"
PY_URL = f"https://www.python.org/ftp/python/{PY_VERSION}/{PY_ZIP}"
PY_SHA256 = "90905e64a840557d8c1bc4f5b74db3d7ee85e3ffb217611cac1c7813acea4159"

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build" / "release"

LAUNCHER = """@echo off
cd /d "%~dp0"
title Storyforge
"python\\python.exe" "app\\server.py" --data . %*
if errorlevel 1 pause
"""

README = """Storyforge

Start: double-click "Start Storyforge.bat".

app\\      Storyforge (Python and JavaScript source, MIT)
python\\   Python {ver} from python.org, unchanged

Projects, backups, fonts and settings are saved in this folder.
"""

def fetch_python() -> bytes:
    cache = ROOT / "build" / PY_ZIP
    if not cache.exists():
        cache.parent.mkdir(parents=True, exist_ok=True)
        print("downloading", PY_URL)
        with urllib.request.urlopen(PY_URL, timeout=120) as r:
            cache.write_bytes(r.read())
    data = cache.read_bytes()
    got = hashlib.sha256(data).hexdigest()
    if got != PY_SHA256:
        cache.unlink()
        sys.exit(f"{PY_ZIP}: SHA-256 is {got}, expected {PY_SHA256}")
    return data

def check_signature(exe: Path) -> None:
    if sys.platform != "win32":
        return
    out = subprocess.run(
        ["powershell", "-NoProfile", "-Command",
         f"$s = Get-AuthenticodeSignature -LiteralPath '{exe}'; \"$($s.Status)|$($s.SignerCertificate.Subject)\""],
        capture_output=True, text=True, timeout=60, env={k: v for k, v in os.environ.items() if k.upper() != "PSMODULEPATH"}).stdout.strip()
    if out in ("", "|"):
        print("signature not checked (PowerShell gave no answer); the SHA-256 of the download was verified")
        return
    if not out.startswith("Valid|") or "Python Software Foundation" not in out:
        sys.exit(f"{exe.name}: not signed by the Python Software Foundation ({out})")
    print("signature ok:", exe.name)

def main() -> None:
    out = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / "build" / "Storyforge.zip"
    top = BUILD / "Storyforge"
    if BUILD.exists():
        shutil.rmtree(BUILD)
    (top / "app").mkdir(parents=True)

    zipfile.ZipFile(io.BytesIO(fetch_python())).extractall(top / "python")
    for name in ("python.exe", "pythonw.exe"):
        check_signature(top / "python" / name)
    pth = next((top / "python").glob("python*._pth"))
    pth.write_text(pth.read_text(encoding="utf-8").rstrip("\n") + "\n..\\app\n", encoding="utf-8")

    for name in ("server.py", "desktop.py", "LICENSE"):
        shutil.copy2(ROOT / name, top / "app" / name)
    shutil.copytree(ROOT / "web", top / "app" / "web")
    (top / "Start Storyforge.bat").write_text(LAUNCHER, encoding="ascii", newline="\r\n")
    (top / "READ ME.txt").write_text(README.format(ver=PY_VERSION), encoding="utf-8", newline="\r\n")

    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for f in sorted(BUILD.rglob("*")):
            if f.is_file():
                z.write(f, f.relative_to(BUILD).as_posix())
    print(f"built {out} ({out.stat().st_size:,} bytes)")

if __name__ == "__main__":
    main()
