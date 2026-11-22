from __future__ import annotations

import argparse
import base64
import hashlib
import json
import mimetypes
import os
import queue
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import traceback
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import desktop

APP_NAME = "Storyforge"
OLD_NAMES = ("StoryboardKit",)
APP_VERSION = "0.1.2"
ASSET_PREFIX = "sb/storyforge/"
OUR_PREFIXES = (ASSET_PREFIX, "sb/sbkit/")
MAX_BODY = 512 * 1024 * 1024

if getattr(sys, "frozen", False):
    RES_DIR = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    DATA_DIR = Path(sys.executable).resolve().parent
else:
    RES_DIR = Path(__file__).resolve().parent
    DATA_DIR = RES_DIR

WEB_DIR = RES_DIR / "web"
PROJECTS_DIR = DATA_DIR / "projects"
BACKUP_DIR = DATA_DIR / "backups"
FONTS_DIR = DATA_DIR / "fonts"
SETTINGS_FILE = DATA_DIR / "settings.json"

TIMESTAMP_RE = re.compile(r"^\s*\d+:\d{2}[:.]\d{3}(\s*\([^)]*\))?\s*(-.*)?$", re.S)

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("audio/ogg", ".ogg")
mimetypes.add_type("audio/mpeg", ".mp3")
mimetypes.add_type("font/ttf", ".ttf")
mimetypes.add_type("font/otf", ".otf")
mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("text/plain", ".osu")
mimetypes.add_type("text/plain", ".osb")


def load_settings() -> dict:
    try:
        return json.loads(SETTINGS_FILE.read_text("utf-8"))
    except Exception:
        return {}


def save_settings(s: dict) -> None:
    SETTINGS_FILE.write_text(json.dumps(s, indent=2), "utf-8")


def _registry_installs() -> list[Path]:
    out: list[Path] = []
    try:
        import winreg
    except ImportError:
        return out
    keys = [
        r"osustable.File.osz\shell\open\command", r"osustable.Uri.osu\shell\open\command",
        r"osustable.File.osk\shell\open\command", r"osu\shell\open\command", r"osu!\shell\open\command",
        r"osu.File.osz\shell\open\command",
    ]
    for root in (winreg.HKEY_CLASSES_ROOT, winreg.HKEY_CURRENT_USER):
        for key in keys:
            path = key if root == winreg.HKEY_CLASSES_ROOT else "Software\\Classes\\" + key
            try:
                with winreg.OpenKey(root, path) as k:
                    cmd = winreg.QueryValue(k, None) or ""
            except OSError:
                continue
            m = re.match(r'\s*"([^"]+)"', cmd) or re.match(r"\s*(\S+\.exe)", cmd, re.I)
            if m:
                out.append(Path(m.group(1)).parent)
    return out


def _running_osu() -> list[Path]:
    try:
        d = desktop.running_osu_dir()
    except Exception:
        d = None
    return [Path(d)] if d else []


def _common_installs() -> list[Path]:
    out: list[Path] = []
    if os.name == "nt":
        la = os.environ.get("LOCALAPPDATA")
        if la:
            out.append(Path(la) / "osu!")
        import string

        for letter in string.ascii_uppercase:
            root = Path(f"{letter}:/")
            try:
                if not root.exists():
                    continue
            except OSError:
                continue
            for sub in ("osu!", "osu", "Games/osu!", "Program Files/osu!", "Program Files (x86)/osu!"):
                out.append(root / sub)
    out.append(Path.home() / "osu!")
    out.append(Path.home() / ".local/share/osu-wine/osu!")
    return out


def _songs_for_install(install: Path) -> Path | None:
    try:
        if not install.is_dir() or not ((install / "osu!.exe").exists() or (install / "osu!.db").exists()):
            return None
        songs = install / "Songs"
        cfgs = sorted(install.glob("osu!.*.cfg"), key=lambda c: c.stat().st_mtime)
        user = (os.environ.get("USERNAME") or os.environ.get("USER") or "").lower()
        cfgs.sort(key=lambda c: c.name.lower() == f"osu!.{user}.cfg")
        for cfg in cfgs[-1:]:
            for line in cfg.read_text("utf-8", errors="ignore").splitlines():
                if line.startswith("BeatmapDirectory") and "=" in line:
                    val = line.split("=", 1)[1].strip()
                    if val:
                        p = Path(val)
                        songs = p if p.is_absolute() else install / p
                    break
        return songs if songs.is_dir() else None
    except OSError:
        return None


_detected: dict = {}


def detect_songs_dir() -> str | None:
    for install in _running_osu():
        if str(install).lower() != str(_detected.get("install", "")).lower():
            songs = _songs_for_install(install)
            if songs:
                _detected.update(songs=str(songs), install=str(install))
    if "songs" in _detected:
        return _detected["songs"]
    if time.time() - _detected.get("failed", 0) < 20:
        return None
    seen = set()
    for finder in (_registry_installs, _common_installs):
        for install in finder():
            key = str(install).lower()
            if key in seen:
                continue
            seen.add(key)
            songs = _songs_for_install(install)
            if songs:
                _detected["songs"] = str(songs)
                _detected["install"] = str(install)
                return str(songs)
    _detected["failed"] = time.time()
    return None


def osu_install_dir() -> Path | None:
    detect_songs_dir()
    return Path(_detected["install"]) if _detected.get("install") else None


SETTINGS = load_settings()
SETTINGS_LOCK = threading.Lock()


def songs_dir() -> Path | None:
    s = SETTINGS.get("songsDir")
    if not s or not Path(s).is_dir():
        s = detect_songs_dir()
    return Path(s) if s and Path(s).is_dir() else None


def songs_roots() -> list[Path]:
    out = [songs_dir()]
    d = detect_songs_dir()
    if d and Path(d).is_dir() and (not out[0] or Path(d).resolve() != out[0].resolve()):
        out.append(Path(d))
    return [r for r in out if r]


def resolve_map_folder(folder: str) -> Path:
    if not folder:
        raise ValueError("no folder given")
    p = Path(folder)
    if not p.is_absolute():
        sd = songs_dir()
        if not sd:
            raise ValueError("Songs folder not configured")
        p = sd / folder
    p = p.resolve()
    if not p.is_dir():
        raise ValueError(f"folder not found: {p}")
    if not any(p.glob("*.osu")):
        raise ValueError("folder contains no .osu files")
    return p


def safe_join(base: Path, rel: str) -> Path:
    rel = rel.replace("\\", "/").lstrip("/")
    target = (base / rel).resolve()
    if target != base and base not in target.parents:
        raise ValueError("path escapes folder")
    return target


def project_file(map_dir: Path) -> Path:
    name = re.sub(r"[^\w\-. ()\[\]]+", "_", map_dir.name)[:150]
    return PROJECTS_DIR / f"{name}.json"


# An uploaded map gets its set number in front of the folder name: the project follows.
def adopt_project(map_dir: Path) -> bool:
    m = re.match(r"^\d+\s+(.+)$", map_dir.name)
    new = project_file(map_dir)
    if not m or new.exists() or (map_dir.parent / m.group(1)).exists():
        return False
    old_dir = map_dir.parent / m.group(1)
    old = project_file(old_dir)
    if not old.exists():
        return False
    try:
        os.replace(old, new)
        for a, b in ((old.with_suffix(".versions"), new.with_suffix(".versions")), (old.with_suffix(".written"), new.with_suffix(".written")),
                     (backup_root(old_dir), backup_root(map_dir))):
            if a.exists() and not b.exists():
                os.replace(a, b)
    except OSError:
        return new.exists()
    print(f"  the storyboard of \"{m.group(1)}\" follows the map to \"{map_dir.name}\"")
    return True


def versions_dir(map_dir: Path) -> Path:
    return project_file(map_dir).with_suffix(".versions")


def _version_name(value) -> str:
    name = re.sub(r"[^\w\- ()]+", "_", str(value or "").strip())[:40].strip()
    if not name or name.startswith("_"):
        raise ValueError("give the version a name")
    return name


def list_versions(map_dir: Path) -> dict:
    d = versions_dir(map_dir)
    cur_file = d / "_current.txt"
    cur = cur_file.read_text("utf-8").strip() if cur_file.exists() else "Main"
    names = {f.stem for f in d.glob("*.json")} if d.is_dir() else set()
    return {"current": cur, "versions": sorted(names | {cur}, key=lambda n: (n != "Main", n.lower()))}


def switch_version(map_dir: Path, to, copy: bool = False) -> dict:
    to = _version_name(to)
    d = versions_dir(map_dir)
    d.mkdir(parents=True, exist_ok=True)
    cur = list_versions(map_dir)["current"]
    pf = project_file(map_dir)
    target = d / f"{to}.json"
    if copy and (target.exists() or to == cur):
        raise ValueError("there is already a version with that name")
    if not copy and not target.exists():
        raise ValueError("there is no version with that name")
    if pf.exists():
        shutil.copyfile(pf, d / f"{cur}.json")
    if not copy and to != cur:
        tmp = pf.with_suffix(".tmp")
        shutil.copyfile(target, tmp)
        os.replace(tmp, pf)
    elif copy and pf.exists():
        shutil.copyfile(pf, target)
    (d / "_current.txt").write_text(to, "utf-8")
    return list_versions(map_dir)


def delete_version(map_dir: Path, name) -> dict:
    name = _version_name(name)
    d = versions_dir(map_dir)
    if name == list_versions(map_dir)["current"]:
        raise ValueError("that version is open: open another one first")
    f = d / f"{name}.json"
    if not f.exists():
        raise ValueError("there is no version with that name")
    gone = d / "removed"
    gone.mkdir(parents=True, exist_ok=True)
    os.replace(f, gone / f"{name} {time.strftime('%Y-%m-%d %H%M%S')}.json")
    return list_versions(map_dir)


class FileBusy(Exception):
    pass


def busy_retry(path: Path, fn, seconds: float = 6.0):
    deadline = time.time() + seconds
    delay = 0.1
    while True:
        try:
            return fn()
        except PermissionError as e:
            try:
                readonly = bool(path.stat().st_file_attributes & 1)
            except (OSError, AttributeError):
                readonly = False
            if readonly:
                raise FileBusy(f"{path.name} is read-only (right-click it → Properties → untick Read-only)") from e
            if time.time() >= deadline:
                who = desktop.file_users(path)
                raise FileBusy(f"{path.name} is in use{' by ' + ', '.join(who) if who else ''}") from e
            time.sleep(delay)
            delay = min(delay * 1.5, 0.8)


def read_bytes(path: Path) -> bytes:
    return busy_retry(path, path.read_bytes)


def write_bytes(path: Path, data: bytes) -> None:
    busy_retry(path, lambda: path.write_bytes(data))


_backed_up: set[str] = set()


def backup_root(map_dir: Path) -> Path:
    return BACKUP_DIR / re.sub(r"[^\w\-. ()\[\]]+", "_", map_dir.name)[:150]


# Every file is copied once before it is first changed.
def backup(path: Path, map_dir: Path, force: bool = False) -> None:
    key = str(path)
    if (key in _backed_up and not force) or not path.exists():
        return
    stamp = time.strftime("%Y%m%d-%H%M%S")
    dest = backup_root(map_dir) / stamp
    while (dest / path.name).exists():
        time.sleep(0.25)
        stamp = time.strftime("%Y%m%d-%H%M%S")
        dest = backup_root(map_dir) / stamp
    dest.mkdir(parents=True, exist_ok=True)
    (dest / path.name).write_bytes(read_bytes(path))
    try:
        shutil.copystat(path, dest / path.name)
    except OSError:
        pass
    _backed_up.add(key)


FILE_LOCK = threading.Lock()
LAST_EXPORT: dict[str, dict] = {}


def written_file(map_dir: Path) -> Path:
    return project_file(map_dir).with_suffix(".written")


WRITTEN_MAX = 60000


def block_key(lines) -> str:
    norm = "\n".join((" " * (len(l) - len(l.lstrip("_ "))) + l.lstrip("_ ")).rstrip() for l in lines)
    return hashlib.sha1(norm.encode("utf-8")).hexdigest()[:20]


_CMD_VALUES = {"F": 1, "S": 1, "R": 1, "MX": 1, "MY": 1, "M": 2, "V": 2, "C": 3}


def _num(s: str) -> str:
    s = s.strip()
    if s.isdigit() or (s[:1] == "-" and s[1:].isdigit()):
        return str(int(s))
    try:
        v = round(float(s), 3)
    except ValueError:
        return s.strip()
    return str(int(v)) if v == int(v) else repr(v)


def block_sig(lines) -> str:
    memo_key = "\n".join(lines)
    hit = _SIG_MEMO.get(memo_key)
    if hit is not None:
        return hit
    if len(_SIG_MEMO) > 400000:
        _SIG_MEMO.clear()
    sig = _SIG_MEMO[memo_key] = _block_sig(lines)
    return sig


_SIG_MEMO: dict[str, str] = {}


def _block_sig(lines) -> str:
    head = lines[0].split(",")
    if len(head) >= 6:
        head = head[:3] + [head[3].strip().strip('"').replace("\\", "/").lower(), _num(head[4]), _num(head[5])] + [h.strip() for h in head[6:]]
    cmds: list[list] = []
    loop = None
    for raw in lines[1:]:
        depth = len(raw) - len(raw.lstrip("_ "))
        p = raw.strip().split(",")
        t = p[0]
        if t == "L" and len(p) >= 3:
            text = f"L,{_num(p[1])},{_num(p[2])}"
        elif t == "T" or len(p) < 4:
            text = ",".join(x.strip() for x in p)
        else:
            s = _num(p[2])
            e = s if p[3].strip() == "" else _num(p[3])
            vals = p[4:]
            if t == "P":
                text = f"P,{s},{','.join(v.strip() for v in vals)}"
            else:
                if len(vals) == _CMD_VALUES.get(t):
                    vals = vals + vals
                text = f"{t},{_num(p[1])},{s},{e},{','.join(_num(v) for v in vals)}"
        if depth > 1 and loop is not None:
            loop[1].append(text)
        else:
            item = [text, []]
            cmds.append(item)
            loop = item if t in ("L", "T") else None
    body = sorted(c[0] + ("{" + ";".join(sorted(c[1])) + "}" if c[1] else "") for c in cmds)
    return "s" + hashlib.sha1(("\n".join([",".join(head)] + body)).encode("utf-8")).hexdigest()[:19]


def split_blocks(lines) -> list[list[str]]:
    out, i = [], 0
    while i < len(lines):
        if _is_cmd(lines[i]) or _sprite_path(lines[i]) is None:
            i += 1
            continue
        j = i + 1
        while j < len(lines) and _is_cmd(lines[j]):
            j += 1
        out.append(lines[i:j])
        i = j
    return out


def load_written(map_dir: Path) -> dict:
    try:
        data = json.loads(written_file(map_dir).read_text("utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    out = {}
    for name, items in data.items():
        if isinstance(items, list):
            out[name] = [block_key(x.split("\n")) if "," in x else x for x in items if isinstance(x, str)]
    return out


def save_written(map_dir: Path, name: str, keys: list[str]) -> None:
    data = load_written(map_dir)
    old = data.get(name, [])
    have = set(old)
    new = [k for k in keys if k not in have]
    if not new:
        return
    data[name] = (old + new)[-WRITTEN_MAX:]
    f = written_file(map_dir)
    f.parent.mkdir(parents=True, exist_ok=True)
    tmp = f.with_suffix(".written.tmp")
    tmp.write_text(json.dumps(data), "utf-8")
    os.replace(tmp, f)


def patch_file(path: Path, blocks: dict, map_dir: Path, create: bool = False, dry: bool = False, purge: bool = False,
               differs: bool = False) -> bool:
    has_content = any(blocks.get(l) for l in LAYER_ORDER)
    owned = frozenset(load_written(map_dir).get(path.name, []))
    if path.exists():
        raw = read_bytes(path)
        text = raw.decode("utf-8-sig", errors="replace")
        if not any(p in text.lower().replace("\\", "/") for p in OUR_PREFIXES) and not has_content and not owned:
            return False
        src = ("\ufeff" if raw.startswith(b"\xef\xbb\xbf") else "") + text
    elif create and has_content:
        raw, src = None, "\r\n".join(EMPTY_OSB)
    else:
        return False
    mine = foreign_blocks(blocks)
    if raw is not None and not purge and not differs and holds_storyboard(path, blocks, map_dir):
        if not dry:
            save_written(map_dir, path.name, mine)
        return False
    out = patch_events(src, blocks, owned, purge).encode("utf-8")
    if dry:
        return out != raw
    if out == raw:
        save_written(map_dir, path.name, mine)
        return False
    backup(path, map_dir)
    write_bytes(path, out)
    save_written(map_dir, path.name, mine)
    OUR_WRITES[str(path)] = path.stat().st_mtime
    return True


def foreign_count(path: Path, map_dir: Path, blocks: dict | None = None) -> int:
    if not path.exists():
        return 0
    owned = set(load_written(map_dir).get(path.name, []))
    if blocks:
        owned |= set(foreign_blocks(blocks))
    rest = patch_events(read_bytes(path).decode("utf-8-sig", errors="replace"), {}, frozenset(owned))
    return sum(1 for line in rest.splitlines() if line.startswith(("Sprite,", "Animation,")))


def holds_storyboard(path: Path, blocks: dict, map_dir: Path) -> bool:
    want = {layer: [block_sig(b) for b in split_blocks(blocks.get(layer) or [])] for layer in LAYER_ORDER}
    have: dict[str, list[str]] = {layer: [] for layer in LAYER_ORDER}
    if path.exists():
        owned = set(load_written(map_dir).get(path.name, [])) | set(foreign_blocks(blocks))
        lines = read_bytes(path).decode("utf-8-sig", errors="replace").replace("\r\n", "\n").split("\n")
        bounds = _events_bounds(lines)
        for b in split_blocks(lines[bounds[0]:bounds[1]]) if bounds else []:
            sig = block_sig(b)
            if (_sprite_path(b[0]) or "").lower().startswith(OUR_PREFIXES) or sig in owned or block_key(b) in owned:
                layer = b[0].split(",")[1].strip()
                layer = LAYER_ORDER[int(layer)] if layer.isdigit() and int(layer) < len(LAYER_ORDER) else layer
                have.setdefault(layer, []).append(sig)
    return all(have.get(layer, []) == want[layer] for layer in set(have) | set(want))


# osu! saved over the files: put our sprites back.
def reapply(folder: Path, names) -> tuple[list[str], bool | None]:
    last = LAST_EXPORT.get(str(folder))
    if not last:
        return [], None
    fixed = []
    behind = None
    osb_name, osb_blocks = last["osb"]
    with FILE_LOCK:
        for n in names:
            if last.get("wide") and n.lower().endswith(".osu"):
                try:
                    if set_widescreen(folder / n) and n not in fixed:
                        fixed.append(n)
                except Exception as e:
                    print(f"  [re-apply] widescreen {n}: {e}")
            blocks = last["diffs"].get(n) if n.lower().endswith(".osu") else osb_blocks if n == osb_name else None
            if blocks is None:
                continue
            try:
                if holds_storyboard(folder / n, blocks, folder):
                    if n == osb_name:
                        behind = False
                    continue
                if n == osb_name:
                    behind = True
                if patch_file(folder / n, blocks, folder, differs=True) and n not in fixed:
                    fixed.append(n)
            except Exception as e:
                print(f"  [re-apply] {n}: {e}")
    return fixed, behind


def list_backups(map_dir: Path) -> list[dict]:
    root, out = backup_root(map_dir), []
    if root.is_dir():
        for d in sorted((d for d in root.iterdir() if d.is_dir()), key=lambda d: d.name, reverse=True):
            files = [{"name": f.name, "size": f.stat().st_size} for f in sorted(d.iterdir())
                     if f.is_file() and f.suffix.lower() in (".osb", ".osu")]
            if files:
                out.append({"stamp": d.name, "files": files})
    return out


def _events_bounds(lines: list[str]):
    try:
        a = next(i for i, l in enumerate(lines) if l.strip() == "[Events]")
    except StopIteration:
        return None
    b = len(lines)
    for i in range(a + 1, len(lines)):
        if lines[i].startswith("[") and lines[i].strip().endswith("]"):
            b = i
            break
    return a + 1, b


def _foreign_keys(text: str) -> set:
    lines = text.lstrip("\ufeff").replace("\r\n", "\n").split("\n")
    bounds = _events_bounds(lines)
    if not bounds:
        return set()
    sec, out, i = lines[bounds[0]:bounds[1]], set(), 0
    while i < len(sec):
        sp = None if _is_cmd(sec[i]) else _sprite_path(sec[i])
        j = i + 1
        if sp is not None:
            while j < len(sec) and _is_cmd(sec[j]):
                j += 1
            if not sp.lower().startswith(OUR_PREFIXES):
                out.add(block_key(sec[i:j]))
        i = j
    return out


def restore_backup(map_dir: Path, stamps: dict) -> list:
    done = []
    with FILE_LOCK:
        for name, stamp in stamps.items():
            if not re.fullmatch(r"\d{8}-\d{6}", stamp):
                raise ValueError("bad backup name")
            src = backup_root(map_dir) / stamp / Path(name).name
            target = map_dir / Path(name).name
            if not src.is_file() or target.suffix.lower() not in (".osb", ".osu"):
                continue
            old_raw = read_bytes(target) if target.exists() else None
            new_raw = src.read_bytes()
            if target.suffix.lower() == ".osu":
                if old_raw is None:
                    continue
                cur = old_raw.decode("utf-8-sig", errors="replace")
                eol = "\r\n" if "\r\n" in cur else "\n"
                cl = cur.split(eol)
                bl = new_raw.decode("utf-8-sig", errors="replace").replace("\r\n", "\n").split("\n")
                cb, bb = _events_bounds(cl), _events_bounds(bl)
                if not cb or not bb:
                    continue
                text = eol.join(cl[:cb[0]] + bl[bb[0]:bb[1]] + cl[cb[1]:])
                new_raw = (b"\xef\xbb\xbf" if old_raw.startswith(b"\xef\xbb\xbf") else b"") + text.encode("utf-8")
            if new_raw == old_raw:
                continue
            if old_raw is not None:
                backup(target, map_dir, force=True)
                gone = _foreign_keys(old_raw.decode("utf-8-sig", errors="replace")) - _foreign_keys(new_raw.decode("utf-8-sig", errors="replace"))
                save_written(map_dir, target.name, sorted(gone))
            write_bytes(target, new_raw)
            OUR_WRITES[str(target)] = target.stat().st_mtime
            done.append(target.name)
        LAST_EXPORT.pop(str(map_dir), None)
    return done


def import_image(map_dir: Path, name: str, data: bytes) -> str:
    name = re.sub(r"[^\w\-. ()]+", "_", Path(name).name)
    if not re.search(r"\.(png|jpe?g|gif|webp)$", name, re.I):
        raise ValueError("only .png, .jpg and (for characters) .gif / .webp pictures can be used")
    if len(data) > 40 * 1024 * 1024:
        raise ValueError("that picture is too large")
    stem, ext = name.rsplit(".", 1)
    for n in range(1, 200):
        rel = f"sb/{stem}{'' if n == 1 else f'-{n}'}.{ext}"
        target = safe_join(map_dir, rel)
        if target.exists():
            if read_bytes(target) == data:
                return rel
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        write_bytes(target, data)
        return rel
    raise ValueError("too many pictures with that name")


def creations_dir() -> Path:
    return DATA_DIR / "creations"


def _creation_id(value) -> str:
    cid = str(value or "")
    if not re.fullmatch(r"[a-z0-9]{6,20}", cid):
        raise ValueError("bad creation id")
    return cid


def list_creations() -> list:
    out = []
    d = creations_dir()
    if d.is_dir():
        for f in sorted(d.glob("*.json")):
            try:
                c = json.loads(f.read_text("utf-8"))
            except (OSError, ValueError):
                continue
            if isinstance(c, dict) and c.get("id") == f.stem:
                out.append(c)
    return out


def save_creation(c: dict) -> None:
    cid = _creation_id(c.get("id"))
    d = creations_dir()
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / f"{cid}.json.tmp"
    tmp.write_text(json.dumps(c, ensure_ascii=False, indent=1), "utf-8")
    os.replace(tmp, d / f"{cid}.json")


def remove_creation(cid: str) -> None:
    cid = _creation_id(cid)
    d = creations_dir()
    gone = d / "removed" / time.strftime("%Y%m%d-%H%M%S")
    gone.mkdir(parents=True, exist_ok=True)
    for p in (d / f"{cid}.json", d / cid):
        if p.exists():
            os.replace(p, gone / p.name)


def save_creation_asset(cid: str, name: str, data: bytes) -> str:
    cid = _creation_id(cid)
    name = re.sub(r"[^\w\-. ()]+", "_", Path(name).name)
    if not re.search(r"\.(png|jpe?g|gif|webp|mp4|webm|mov|m4v)$", name, re.I):
        raise ValueError("only pictures (.png, .jpg, .gif, .webp) and short videos (.mp4, .webm) can be used")
    if len(data) > 25 * 1024 * 1024:
        raise ValueError("that file is too large (25 MB at most)")
    d = creations_dir() / cid
    d.mkdir(parents=True, exist_ok=True)
    stem, ext = name.rsplit(".", 1)
    for n in range(1, 200):
        target = d / f"{stem}{'' if n == 1 else f'-{n}'}.{ext}"
        if target.exists():
            if target.read_bytes() == data:
                return target.name
            continue
        target.write_bytes(data)
        return target.name
    raise ValueError("too many pictures with that name")


LAYER_COMMENTS = {
    "Background": "//Storyboard Layer 0 (Background)",
    "Fail": "//Storyboard Layer 1 (Fail)",
    "Pass": "//Storyboard Layer 2 (Pass)",
    "Foreground": "//Storyboard Layer 3 (Foreground)",
    "Overlay": "//Storyboard Layer 4 (Overlay)",
}
LAYER_ORDER = list(LAYER_COMMENTS)
EMPTY_OSB = [
    "[Events]",
    "//Background and Video events",
    *LAYER_COMMENTS.values(),
    "//Storyboard Sound Samples",
    "",
]


def _sprite_path(line: str) -> str | None:
    if not (line.startswith("Sprite,") or line.startswith("Animation,")):
        return None
    parts = line.split(",")
    if len(parts) < 4:
        return None
    return parts[3].strip().strip('"').replace("\\", "/")


def _is_cmd(line: str) -> bool:
    return line[:1] in (" ", "_")


def foreign_blocks(blocks: dict[str, list[str]]) -> list[str]:
    out = []
    for layer in LAYER_ORDER:
        lines = blocks.get(layer) or []
        i = 0
        while i < len(lines):
            j = i + 1
            while j < len(lines) and _is_cmd(lines[j]):
                j += 1
            sp = _sprite_path(lines[i])
            if sp is not None and not sp.lower().startswith(OUR_PREFIXES):
                out.append(block_key(lines[i:j]))
                out.append(block_sig(lines[i:j]))
            i = j
    return sorted(set(out))


# Replace our sprites in [Events]; everything else in the file stays untouched.
def patch_events(text: str, blocks: dict[str, list[str]], owned=frozenset(), purge: bool = False) -> str:
    bom = text.startswith("\ufeff")
    if bom:
        text = text[1:]
    eol = "\r\n" if "\r\n" in text else "\n"
    lines = text.split("\r\n" if eol == "\r\n" else "\n")

    try:
        ev_start = next(i for i, l in enumerate(lines) if l.strip() == "[Events]")
    except StopIteration:
        lines += [""] + EMPTY_OSB
        ev_start = len(lines) - len(EMPTY_OSB)
    ev_end = len(lines)
    for i in range(ev_start + 1, len(lines)):
        if lines[i].startswith("[") and lines[i].strip().endswith("]"):
            ev_end = i
            break

    section = lines[ev_start + 1:ev_end]
    cleaned: list[str] = []
    i = 0
    while i < len(section):
        sp = None if _is_cmd(section[i]) else _sprite_path(section[i])
        if sp is None:
            cleaned.append(section[i])
            i += 1
            continue
        j = i + 1
        while j < len(section) and _is_cmd(section[j]):
            j += 1
        ours = purge or sp.lower().startswith(OUR_PREFIXES) or (
            owned and (block_key(section[i:j]) in owned or block_sig(section[i:j]) in owned))
        if not ours:
            cleaned.extend(section[i:j])
        i = j

    for layer in LAYER_ORDER:
        c = LAYER_COMMENTS[layer]
        if c not in cleaned:
            idx = None
            later = LAYER_ORDER[LAYER_ORDER.index(layer) + 1:]
            for nxt in later:
                if LAYER_COMMENTS[nxt] in cleaned:
                    idx = cleaned.index(LAYER_COMMENTS[nxt])
                    break
            if idx is None and "//Storyboard Sound Samples" in cleaned:
                idx = cleaned.index("//Storyboard Sound Samples")
            if idx is None:
                idx = len(cleaned)
                while idx > 0 and cleaned[idx - 1].strip() == "":
                    idx -= 1
            cleaned.insert(idx, c)

    for layer in LAYER_ORDER:
        new = blocks.get(layer) or []
        if not new:
            continue
        ci = cleaned.index(LAYER_COMMENTS[layer])
        j = ci + 1
        while j < len(cleaned) and not cleaned[j].startswith("//") and not (
            cleaned[j].strip() == "" and all(x.strip() == "" for x in cleaned[j:])
        ):
            j += 1
        cleaned[j:j] = new

    out = lines[:ev_start + 1] + cleaned + lines[ev_end:]
    result = eol.join(out)
    return ("\ufeff" if bom else "") + result


def osb_filename(map_dir: Path, metadata: dict) -> str:
    existing = list(map_dir.glob("*.osb"))
    if len(existing) == 1:
        return existing[0].name
    name = f"{metadata.get('Artist', '')} - {metadata.get('Title', '')} ({metadata.get('Creator', '')}).osb"
    return re.sub(r'[\\/:*?"<>|]', "", name)


def set_widescreen(path: Path) -> bool:
    raw = read_bytes(path)
    text = raw.decode("utf-8-sig", errors="replace")
    eol = "\r\n" if "\r\n" in text else "\n"
    lines = text.split(eol)
    try:
        g = next(i for i, l in enumerate(lines) if l.strip() == "[General]")
    except StopIteration:
        return False
    end = len(lines)
    for i in range(g + 1, len(lines)):
        if lines[i].startswith("["):
            end = i
            break
    for i in range(g + 1, end):
        if lines[i].replace(" ", "").startswith("WidescreenStoryboard:"):
            if lines[i].replace(" ", "") == "WidescreenStoryboard:1":
                return False
            lines[i] = "WidescreenStoryboard: 1"
            break
    else:
        ins = end
        while ins > g + 1 and lines[ins - 1].strip() == "":
            ins -= 1
        lines.insert(ins, "WidescreenStoryboard: 1")
    out = eol.join(lines)
    write_bytes(path, ("\ufeff" if raw.startswith(b"\xef\xbb\xbf") else "").encode() + out.encode("utf-8"))
    return True


class Bus:
    def __init__(self):
        self.clients: list[queue.Queue] = []
        self.lock = threading.Lock()
        self.last: dict[str, dict] = {}

    def subscribe(self) -> queue.Queue:
        q: queue.Queue = queue.Queue(maxsize=200)
        with self.lock:
            self.clients.append(q)
            for ev in self.last.values():
                q.put_nowait(ev)
        return q

    def unsubscribe(self, q):
        with self.lock:
            if q in self.clients:
                self.clients.remove(q)

    def publish(self, kind: str, data: dict, sticky=False):
        ev = {"type": kind, **data}
        if sticky:
            self.last[kind] = ev
        with self.lock:
            for q in list(self.clients):
                try:
                    q.put_nowait(ev)
                except queue.Full:
                    pass

    @property
    def has_clients(self):
        return bool(self.clients)


BUS = Bus()


def _win_clipboard():
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    user32.GetClipboardSequenceNumber.restype = wintypes.DWORD
    user32.OpenClipboard.argtypes = [wintypes.HWND]
    user32.OpenClipboard.restype = wintypes.BOOL
    user32.GetClipboardData.argtypes = [wintypes.UINT]
    user32.GetClipboardData.restype = wintypes.HANDLE
    user32.CloseClipboard.restype = wintypes.BOOL
    kernel32.GlobalLock.argtypes = [wintypes.HGLOBAL]
    kernel32.GlobalLock.restype = wintypes.LPVOID
    kernel32.GlobalUnlock.argtypes = [wintypes.HGLOBAL]

    def seq():
        return user32.GetClipboardSequenceNumber()

    def read():
        for _ in range(5):
            if user32.OpenClipboard(None):
                break
            time.sleep(0.03)
        else:
            return None
        try:
            h = user32.GetClipboardData(13)
            if not h:
                return None
            p = kernel32.GlobalLock(h)
            if not p:
                return None
            try:
                return ctypes.wstring_at(p)
            finally:
                kernel32.GlobalUnlock(h)
        finally:
            user32.CloseClipboard()

    return seq, read


def _cmd_clipboard():
    cmds = []
    if sys.platform == "darwin":
        cmds = [["pbpaste"]]
    else:
        cmds = [["wl-paste", "--no-newline"], ["xclip", "-selection", "clipboard", "-o"], ["xsel", "-b", "-o"]]
    for c in cmds:
        if shutil.which(c[0]):
            def read(c=c):
                try:
                    return subprocess.run(c, capture_output=True, timeout=1).stdout.decode("utf-8", "replace")
                except Exception:
                    return None
            return None, read
    return None, None


def clipboard_loop():
    try:
        seq, read = _win_clipboard() if os.name == "nt" else _cmd_clipboard()
    except Exception:
        seq, read = None, None
    if not read:
        print("  clipboard: not available on this system (timestamps can still be pasted manually)")
        return
    last_seq = seq() if seq else None
    last_text = read() if not seq else None
    while True:
        time.sleep(0.15 if seq else 0.5)
        try:
            if not SETTINGS.get("clipboard", True) or not BUS.has_clients:
                if seq:
                    last_seq = seq()
                continue
            if seq:
                s = seq()
                if s == last_seq:
                    continue
                last_seq = s
                text = read()
            else:
                text = read()
                if text == last_text:
                    continue
                last_text = text
            if text and len(text) < 20000 and TIMESTAMP_RE.match(text.strip()):
                BUS.publish("clipboard", {"text": text.strip(), "at": time.time()})
        except Exception:
            time.sleep(1)


def _dig(d, *path, default=None):
    for p in path:
        if isinstance(d, dict) and p in d:
            d = d[p]
        else:
            return default
    return d


def tosu_base() -> str:
    if SETTINGS.get("tosuUrl"):
        return str(SETTINGS["tosuUrl"]).rstrip("/")
    ip, port = "127.0.0.1", "24050"
    inst = osu_install_dir()
    try:
        env = inst / "tosu.env" if inst else None
        if env and env.exists():
            for line in env.read_text("utf-8", errors="ignore").splitlines():
                k, _, v = line.partition("=")
                if k.strip() == "SERVER_PORT" and v.strip().isdigit():
                    port = v.strip()
                if k.strip() == "SERVER_IP" and v.strip() and v.strip() != "0.0.0.0":
                    ip = v.strip()
    except OSError:
        pass
    return f"http://{ip}:{port}"


TOSU_NOW: dict = {}


def tosu_map() -> tuple[str, str] | None:
    t = dict(TOSU_NOW)
    if not t.get("connected") or time.time() - t.get("at", 0) > 3 or not t.get("folder") or not t.get("file"):
        return None
    main = songs_dir()
    for root in [Path(t["songs"])] if t.get("songs") else songs_roots():
        try:
            if (root / t["folder"] / t["file"]).is_file():
                same = main and root.resolve() == main.resolve()
                return (t["folder"] if same else str(root / t["folder"])), t["file"]
        except OSError:
            pass
    return None


def tosu_loop():
    base = tosu_base()
    connected = None
    last_sent = None
    while True:
        if not SETTINGS.get("tosu", True) or not BUS.has_clients:
            time.sleep(1)
            continue
        data = None
        for ep in ("/json/v2", "/json"):
            try:
                with urllib.request.urlopen(base + ep, timeout=0.6) as r:
                    data = json.loads(r.read().decode("utf-8", "replace"))
                    data["_ep"] = ep
                    break
            except Exception:
                data = None
        if not data:
            if connected is not False:
                connected = False
                BUS.publish("tosu", {"connected": False}, sticky=True)
            time.sleep(3)
            continue
        connected = True
        TOSU_NOW.clear()
        if data["_ep"] == "/json/v2":
            info = {
                "state": _dig(data, "state", "name", default=""),
                "time": _dig(data, "beatmap", "time", "live", default=None),
                "songs": _dig(data, "folders", "songs", default=""),
                "folder": _dig(data, "folders", "beatmap", default=""),
                "file": _dig(data, "files", "beatmap", default=""),
            }
        else:
            st = _dig(data, "menu", "state", default=-1)
            info = {
                "state": "edit" if st == 1 else str(st),
                "time": _dig(data, "menu", "bm", "time", "current", default=None),
                "songs": _dig(data, "settings", "folders", "songs", default=""),
                "folder": _dig(data, "menu", "bm", "path", "folder", default=""),
                "file": _dig(data, "menu", "bm", "path", "file", default=""),
            }
        info["connected"] = True
        TOSU_NOW.update(info, at=time.time())
        key = json.dumps(info, sort_keys=True)
        if key != last_sent:
            last_sent = key
            BUS.publish("tosu", info, sticky=True)
        time.sleep(0.2)


SONGS_INDEX = desktop.SongsIndex()

# The mapper of each map, read from its .osu file names.
MAP_INFO: dict[str, tuple[float, str, str]] = {}
MAP_INFO_ROOT = {"root": None}
OSU_NAME = re.compile(r"^(.*) \(([^()]*)\) \[.*\]\.osu$", re.I)


def _map_info(folder: Path) -> tuple[str, str]:
    try:
        for f in os.scandir(folder):
            if f.name.lower().endswith(".osu"):
                m = OSU_NAME.match(f.name)
                return (m.group(2), m.group(1)) if m else ("", f.name[:-4])
    except OSError:
        pass
    return "", ""


def _save_map_info(cache: Path, sd: Path) -> None:
    try:
        tmp = cache.with_suffix(".tmp")
        tmp.write_text(json.dumps({"root": str(sd), "maps": dict(MAP_INFO)}), "utf-8")
        os.replace(tmp, cache)
    except OSError:
        pass


def map_info_loop():
    while True:
        try:
            sd = songs_dir()
            if not sd:
                time.sleep(5)
                continue
            cache = DATA_DIR / "songs-index.json"
            if MAP_INFO_ROOT["root"] != str(sd):
                MAP_INFO.clear()
                MAP_INFO_ROOT["root"] = str(sd)
                try:
                    saved = json.loads(cache.read_text("utf-8"))
                    if saved.get("root") == str(sd):
                        MAP_INFO.update({k: tuple(v) for k, v in saved.get("maps", {}).items()})
                except (OSError, ValueError, AttributeError):
                    pass
            folders = []
            with os.scandir(sd) as it:
                for e in it:
                    try:
                        if e.is_dir():
                            folders.append((e.stat().st_mtime, e.name))
                    except OSError:
                        pass
            folders.sort(reverse=True)
            changed = 0
            for mtime, name in folders:
                have = MAP_INFO.get(name)
                if have and have[0] == mtime:
                    continue
                MAP_INFO[name] = (mtime, *_map_info(sd / name))
                changed += 1
                if changed % 100 == 0:
                    time.sleep(0.01)
                if changed % 500 == 0:
                    _save_map_info(cache, sd)
            names = {n for _, n in folders}
            gone = [k for k in list(MAP_INFO) if k not in names]
            for k in gone:
                MAP_INFO.pop(k, None)
            if changed or gone:
                _save_map_info(cache, sd)
        except Exception:
            traceback.print_exc()
        time.sleep(30)
HOTKEY_STATUS: dict = {}
OUR_WRITES: dict[str, float] = {}
WATCH = {"folder": None, "mtimes": {}}
WATCH_LOCK = threading.Lock()


def osu_window_loop():
    last = None
    while True:
        time.sleep(1.0)
        if not BUS.has_clients:
            continue
        try:
            info = desktop.parse_osu_title(desktop.osu_window_title())
            hit = None
            if info.get("filename") or info.get("song"):
                with WATCH_LOCK:
                    open_here = WATCH["folder"].name if WATCH["folder"] else None
                hit = tosu_map() or SONGS_INDEX.resolve(songs_roots(), info, open_here)
            ev = {"running": info.get("running", False), "title": info.get("title"),
                  "folder": hit[0] if hit else None, "file": hit[1] if hit else None}
            key = json.dumps(ev, sort_keys=True)
            if key != last:
                last = key
                BUS.publish("osu", ev, sticky=True)
        except Exception:
            traceback.print_exc()
            time.sleep(5)


def _snapshot(folder: Path) -> dict[str, float]:
    out = {}
    try:
        for f in folder.iterdir():
            if f.suffix.lower() in (".osu", ".osb"):
                out[f.name] = f.stat().st_mtime
    except OSError:
        pass
    return out


def file_watch_loop():
    pending: set[str] = set()
    pending_folder = None
    while True:
        time.sleep(0.08)
        with WATCH_LOCK:
            folder = WATCH["folder"]
        if folder != pending_folder:
            pending, pending_folder = set(), folder
        if not folder or not BUS.has_clients:
            continue
        with FILE_LOCK:
            now = _snapshot(folder)
        with WATCH_LOCK:
            if WATCH["folder"] != folder:
                continue
            before = WATCH["mtimes"]
            WATCH["mtimes"] = now
        changed = [n for n, m in now.items() if before.get(n) != m and OUR_WRITES.get(str(folder / n)) != m]
        if changed and before:
            pending.update(changed)
        elif pending:
            t0 = time.time()
            fixed, behind = reapply(folder, pending)
            BUS.publish("files", {"folder": folder.name, "changed": sorted(pending), "reapplied": fixed,
                                  "osuBehind": behind, "ms": round((time.time() - t0) * 1000)})
            pending = set()


LRCLIB = "https://lrclib.net/api"
EDIT_TAGS = re.compile(r"\s*[\(\[][^)\]]*(tv|size|cut|ver\.?|version|edit|short|sped|nightcore|remix|mix|extended|full)[^)\]]*[\)\]]", re.I)


FEAT_TAG = re.compile(r"\s*[\(\[]?\s*\b(feat|ft|featuring)\b\.?\s+.*$", re.I)


def _norm_words(s: str) -> str:
    return re.sub(r"[^\w]+", " ", (s or "").lower()).strip()


def _similar(a: str, b: str) -> float:
    a, b = _norm_words(a), _norm_words(b)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    if a in b or b in a:
        return 0.8
    wa, wb = set(a.split()), set(b.split())
    return len(wa & wb) / max(len(wa | wb), 1)


def lrclib_search(params: dict) -> list:
    url = f"{LRCLIB}/search?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": f"{APP_NAME}/{APP_VERSION} (osu! storyboard tool)"})
    with urllib.request.urlopen(req, timeout=10) as r:
        data = json.loads(r.read().decode("utf-8"))
    return data if isinstance(data, list) else []


def find_lyrics(artist: str, title: str, artist_u: str = "", title_u: str = "", duration: float = 0) -> list[dict]:
    tries = []
    for a, t in ((artist, title), (artist_u, title_u)):
        t = EDIT_TAGS.sub("", t or "").strip()
        if t:
            tries.append({"track_name": t, "artist_name": a} if a else {"track_name": t})
            tries.append({"q": f"{a} {t}".strip()})
            plain = FEAT_TAG.sub("", t).strip()
            if plain and plain != t:
                tries.append({"track_name": plain, "artist_name": a} if a else {"track_name": plain})
    found: dict = {}
    errors = []
    seen = set()
    for q in tries:
        key = json.dumps(q, sort_keys=True)
        if key in seen:
            continue
        seen.add(key)
        try:
            for r in lrclib_search(q):
                if r.get("syncedLyrics") and not r.get("instrumental"):
                    found[r["id"]] = r
        except Exception as e:
            errors.append(str(e))
        if len(found) >= 8:
            break
    if not found:
        for t in {EDIT_TAGS.sub("", x or "").strip() for x in (title, title_u)} - {""}:
            try:
                for r in lrclib_search({"track_name": t}):
                    if r.get("syncedLyrics") and not r.get("instrumental"):
                        found[r["id"]] = r
            except Exception as e:
                errors.append(str(e))
    if not found and errors:
        raise ValueError(f"lyrics service not reachable ({errors[0]})")

    def score(r):
        t = max(_similar(r.get("trackName"), EDIT_TAGS.sub("", title or "")), _similar(r.get("trackName"), EDIT_TAGS.sub("", title_u or "")))
        a = max(_similar(r.get("artistName"), artist), _similar(r.get("artistName"), artist_u))
        d = r.get("duration") or 0
        dur = 0 if not duration or not d else -min(1.0, max(0.0, duration - d) / 30)
        return 2 * t + a + dur

    ranked, same = [], set()
    for r in sorted(found.values(), key=score, reverse=True):
        key = (_norm_words(r.get("artistName")), _norm_words(r.get("trackName")), (r.get("syncedLyrics") or "")[:300])
        if key not in same:
            same.add(key)
            ranked.append(r)
    ranked = ranked[:6]
    artist_ok = lambda r: max(_similar(r.get("artistName"), artist), _similar(r.get("artistName"), artist_u)) >= 0.5
    return [{"id": r["id"], "artist": r.get("artistName"), "title": r.get("trackName"), "artistMatch": artist_ok(r), "album": r.get("albumName") if r.get("albumName") not in (None, "", "null") else None,
             "duration": r.get("duration") or 0, "synced": r.get("syncedLyrics")} for r in ranked]


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        if isinstance(sys.exc_info()[1], (ConnectionResetError, ConnectionAbortedError, BrokenPipeError)):
            return
        super().handle_error(request, client_address)


class Handler(BaseHTTPRequestHandler):
    server_version = f"{APP_NAME}/{APP_VERSION}"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        if getattr(self.server, "verbose", False):
            super().log_message(fmt, *args)

    def _host_ok(self) -> bool:
        host = (self.headers.get("Host") or "").split(":")[0].lower()
        return host in ("127.0.0.1", "localhost", "[::1]")

    def _send(self, code: int, body: bytes, ctype: str, extra: dict | None = None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj).encode("utf-8"), "application/json; charset=utf-8")

    def _err(self, msg, code=400):
        self._json({"error": str(msg)}, code)

    def _body(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            raise ValueError("request too large")
        raw = self.rfile.read(n) if n else b"{}"
        return json.loads(raw.decode("utf-8") or "{}")

    def _query(self) -> dict:
        q = urllib.parse.urlparse(self.path).query
        return {k: v[0] for k, v in urllib.parse.parse_qs(q).items()}

    def _serve_file(self, path: Path):
        if not path.is_file():
            return self._err("not found", 404)
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        size = path.stat().st_size
        rng = self.headers.get("Range")
        if rng and rng.startswith("bytes="):
            a, _, b = rng[6:].partition("-")
            start = int(a) if a else 0
            end = int(b) if b else size - 1
            end = min(end, size - 1)
            if start > end:
                return self._send(416, b"", "text/plain", {"Content-Range": f"bytes */{size}"})
            def read_range():
                with open(path, "rb") as f:
                    f.seek(start)
                    return f.read(end - start + 1)
            data = busy_retry(path, read_range)
            return self._send(206, data, ctype, {"Content-Range": f"bytes {start}-{end}/{size}", "Accept-Ranges": "bytes"})
        self._send(200, read_bytes(path), ctype, {"Accept-Ranges": "bytes"})

    def _serve_index(self):
        self._send(200, read_bytes(WEB_DIR / "index.html"), "text/html; charset=utf-8")

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        if not self._host_ok():
            return self._err("bad host", 403)
        route = urllib.parse.urlparse(self.path).path
        try:
            if route == "/" or route == "/index.html":
                return self._serve_index()
            if route.startswith("/web/"):
                return self._serve_file(safe_join(WEB_DIR, urllib.parse.unquote(route[5:])))
            if route.startswith("/fonts/"):
                return self._serve_file(safe_join(FONTS_DIR, urllib.parse.unquote(route[7:])))
            if route == "/api/state":
                return self.api_state()
            if route == "/api/maps":
                return self.api_maps()
            if route == "/api/mapset":
                return self.api_mapset()
            if route == "/api/file":
                q = self._query()
                return self._serve_file(safe_join(resolve_map_folder(q.get("folder", "")), q.get("path", "")))
            if route == "/api/project":
                return self.api_project_get()
            if route == "/api/fonts":
                FONTS_DIR.mkdir(exist_ok=True)
                fonts = [f.name for f in FONTS_DIR.iterdir() if f.suffix.lower() in (".ttf", ".otf", ".woff", ".woff2")]
                return self._json({"fonts": sorted(fonts)})
            if route == "/api/events":
                return self.api_events()
            if route == "/api/versions":
                return self._json(list_versions(resolve_map_folder(self._query().get("folder", ""))))
            if route == "/api/creations":
                return self._json({"creations": list_creations()})
            if route == "/api/creation/file":
                q = self._query()
                return self._serve_file(safe_join(creations_dir() / _creation_id(q.get("id")), q.get("name", "")))
            if route == "/api/backups":
                return self._json({"backups": list_backups(resolve_map_folder(self._query().get("folder", "")))})
            return self._err("not found", 404)
        except FileBusy as e:
            return self._json({"error": str(e), "busy": True}, 409)
        except ValueError as e:
            return self._err(e, 400)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        except Exception as e:
            traceback.print_exc()
            return self._err(e, 500)

    def do_POST(self):
        if not self._host_ok():
            return self._err("bad host", 403)
        if self.headers.get("X-SBKit") != "1":
            return self._err("missing header", 403)
        route = urllib.parse.urlparse(self.path).path
        try:
            body = self._body()
            if route == "/api/settings":
                return self.api_settings(body)
            if route == "/api/project":
                return self.api_project_post(body)
            if route == "/api/export":
                return self.api_export(body)
            if route == "/api/widescreen":
                return self.api_widescreen(body)
            if route == "/api/fonts":
                return self.api_font_upload(body)
            if route == "/api/restore":
                stamps = {str(k): str(v) for k, v in (body.get("files") or {}).items()}
                return self._json({"ok": True, "restored": restore_backup(resolve_map_folder(body.get("folder", "")), stamps)})
            if route == "/api/image":
                rel = import_image(resolve_map_folder(body.get("folder", "")), str(body.get("name", "")), base64.b64decode(body.get("data", "")))
                return self._json({"ok": True, "path": rel})
            if route == "/api/version" and body.get("remove"):
                return self._json({"ok": True, **delete_version(resolve_map_folder(body.get("folder", "")), body.get("remove"))})
            if route == "/api/version":
                out = switch_version(resolve_map_folder(body.get("folder", "")), body.get("to"), bool(body.get("copy")))
                if not body.get("copy"):
                    BUS.publish("project", {"folder": body.get("folder"), "by": body.get("client")})
                return self._json({"ok": True, **out})
            if route == "/api/creation":
                if body.get("remove"):
                    remove_creation(body.get("id"))
                else:
                    save_creation(body.get("creation") or {})
                return self._json({"ok": True})
            if route == "/api/creation/asset":
                name = save_creation_asset(body.get("id"), str(body.get("name", "")), base64.b64decode(body.get("data", "")))
                return self._json({"ok": True, "name": name})
            if route == "/api/open-folder":
                p = resolve_map_folder(body.get("folder", ""))
                if os.name == "nt":
                    os.startfile(p)
                elif sys.platform == "darwin":
                    subprocess.Popen(["open", str(p)])
                else:
                    subprocess.Popen(["xdg-open", str(p)])
                return self._json({"ok": True})
            if route == "/api/quit":
                self._json({"ok": True})
                threading.Timer(0.3, lambda: os._exit(0)).start()
                return None
            if route == "/api/log":
                print("  [browser]", str(body.get("msg", ""))[:2000])
                return self._json({"ok": True})
            if route == "/api/lyrics/find":
                return self._json({"results": find_lyrics(body.get("artist", ""), body.get("title", ""),
                                                          body.get("artistUnicode", ""), body.get("titleUnicode", ""),
                                                          float(body.get("duration") or 0))})
            if route == "/api/watch":
                p = resolve_map_folder(body.get("folder", "")) if body.get("folder") else None
                with WATCH_LOCK:
                    WATCH["folder"], WATCH["mtimes"] = p, (_snapshot(p) if p else {})
                return self._json({"ok": True})
            return self._err("not found", 404)
        except FileBusy as e:
            print(f"  [busy] {e}")
            return self._json({"error": str(e), "busy": True}, 409)
        except ValueError as e:
            return self._err(e, 400)
        except Exception as e:
            traceback.print_exc()
            return self._err(e, 500)

    def api_state(self):
        sd = songs_dir()
        self._json({
            "app": APP_NAME,
            "version": APP_VERSION,
            "build": BUILD_ID,
            "songsDir": str(sd) if sd else None,
            "detectedSongsDir": detect_songs_dir(),
            "clipboard": SETTINGS.get("clipboard", True),
            "tosu": SETTINGS.get("tosu", True),
            "assetPrefix": ASSET_PREFIX,
            "lastFolder": SETTINGS.get("lastFolder"),
            "prefs": SETTINGS.get("prefs", {}),
            "pinned": SETTINGS.get("pinned", True),
            "hotkeys": HOTKEY_STATUS,
            "windows": os.name == "nt",
        })

    def api_settings(self, body):
        with SETTINGS_LOCK:
            for k in ("songsDir", "clipboard", "tosu", "lastFolder", "prefs"):
                if k in body:
                    SETTINGS[k] = body[k]
            if body.get("songsDir") and not Path(body["songsDir"]).is_dir():
                raise ValueError("That folder does not exist")
            save_settings(SETTINGS)
        self._json({"ok": True})

    def api_maps(self):
        q = self._query()
        sd = songs_dir()
        if not sd:
            return self._json({"maps": [], "error": "Songs folder not found - set it in Settings"})
        needle = q.get("q", "").lower().strip()
        limit = int(q.get("limit", "60"))
        out = []
        saved = {f.name: f for f in PROJECTS_DIR.glob("*.json")} if PROJECTS_DIR.is_dir() else {}
        mine = []
        folders = 0
        with os.scandir(sd) as it:
            for e in it:
                if not e.is_dir():
                    continue
                folders += 1
                info = MAP_INFO.get(e.name)
                hay = f"{e.name} {info[1]} {info[2]}".lower() if info else e.name.lower()
                if needle and not all(w in hay for w in needle.split()):
                    continue
                try:
                    out.append((e.stat().st_mtime, e.name))
                    pf = saved.get(project_file(Path(e.path)).name)
                    if pf:
                        mine.append((pf.stat().st_mtime, e.name, pf))
                except OSError:
                    pass
        out.sort(reverse=True)
        mine.sort(key=lambda x: x[0], reverse=True)
        recent = []
        for mtime, name, pf in mine:
            if len(recent) >= 8:
                break
            try:
                n = len(json.loads(pf.read_text("utf-8")).get("instances") or [])
            except (OSError, ValueError, AttributeError):
                continue
            if n:
                recent.append({"folder": name, "mtime": mtime, "effects": n, "mapper": (MAP_INFO.get(name) or ("", ""))[1]})
        self._json({"maps": [{"folder": n, "mtime": m, "mapper": (MAP_INFO.get(n) or ("", ""))[1]} for m, n in out[:limit]],
                    "total": len(out), "recent": recent, "folders": folders, "read": min(folders, len(MAP_INFO))})

    def api_mapset(self):
        q = self._query()
        p = resolve_map_folder(q.get("folder", ""))
        adopt_project(p)
        files = sorted(p.glob("*.osu"), key=lambda f: f.name.lower())
        images = []
        for ext in ("*.png", "*.jpg", "*.jpeg", "*.gif", "*.webp"):
            for f in p.rglob(ext):
                rel = f.relative_to(p).as_posix()
                if not rel.lower().startswith(OUR_PREFIXES):
                    images.append(rel)
                if len(images) > 400:
                    break
        osbs = [f.name for f in p.glob("*.osb")]
        self._json({
            "folder": q.get("folder"),
            "path": str(p),
            "diffs": [{"file": f.name, "mtime": f.stat().st_mtime} for f in files],
            "osb": osbs,
            "images": sorted(images, key=str.lower),
            "hasProject": project_file(p).exists(),
            "touched": backup_root(p).exists(),
        })
        with SETTINGS_LOCK:
            if SETTINGS.get("lastFolder") != q.get("folder"):
                SETTINGS["lastFolder"] = q.get("folder")
                save_settings(SETTINGS)

    def api_project_get(self):
        q = self._query()
        p = resolve_map_folder(q.get("folder", ""))
        f = project_file(p)
        if q.get("version"):
            name = _version_name(q.get("version"))
            if name != list_versions(p)["current"]:
                f = versions_dir(p) / f"{name}.json"
        if f.exists():
            return self._send(200, f.read_bytes(), "application/json; charset=utf-8")
        self._json({})

    def api_project_post(self, body):
        p = resolve_map_folder(body.get("folder", ""))
        PROJECTS_DIR.mkdir(exist_ok=True)
        f = project_file(p)
        proj = body.get("project") or {}
        if not f.exists() and not proj.get("instances") and not proj.get("patterns") and not proj.get("bookmarks"):
            return self._json({"ok": True, "file": None})
        tmp = f.with_suffix(".tmp")
        tmp.write_text(json.dumps(body.get("project", {}), indent=1), "utf-8")
        os.replace(tmp, f)
        BUS.publish("project", {"folder": body.get("folder"), "by": body.get("client")})
        self._json({"ok": True, "file": str(f)})

    def api_export(self, body):
        map_dir = resolve_map_folder(body.get("folder", ""))
        written = deleted = unchanged = 0

        if body.get("check"):
            differs, extra = [], 0
            with FILE_LOCK:
                name = osb_filename(map_dir, body.get("metadata", {}))
                if patch_file(map_dir / name, body.get("osb", {}), map_dir, create=True, dry=True):
                    differs.append(name)
                extra += foreign_count(map_dir / name, map_dir, body.get("osb", {}))
                for fname, blocks in (body.get("diffs") or {}).items():
                    f = safe_join(map_dir, fname)
                    if f.suffix.lower() != ".osu":
                        continue
                    if patch_file(f, blocks, map_dir, dry=True):
                        differs.append(f.name)
                    extra += foreign_count(f, map_dir, blocks)
            return self._json({"ok": True, "differs": differs, "extra": extra})

        keep: set[str] = set()
        for a in body.get("assets", []):
            rel = a["path"].replace("\\", "/")
            if not rel.lower().startswith(ASSET_PREFIX):
                raise ValueError(f"asset outside {ASSET_PREFIX}: {rel}")
            target = safe_join(map_dir, rel)
            data = base64.b64decode(a["data"])
            keep.add(str(target).lower())
            if target.exists() and read_bytes(target) == data:
                unchanged += 1
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            write_bytes(target, data)
            written += 1
        for prefix in OUR_PREFIXES:
            asset_root = safe_join(map_dir, prefix)
            if not asset_root.is_dir():
                continue
            for f in list(asset_root.rglob("*")):
                if f.is_file() and str(f).lower() not in keep:
                    try:
                        busy_retry(f, f.unlink, seconds=1.0)
                        deleted += 1
                    except (FileBusy, OSError):
                        pass
            for d in sorted([d for d in asset_root.rglob("*") if d.is_dir()], key=lambda d: -len(str(d))):
                if not any(d.iterdir()):
                    d.rmdir()
            if not any(asset_root.iterdir()):
                asset_root.rmdir()

        osb_name = osb_filename(map_dir, body.get("metadata", {}))
        osb_path = map_dir / osb_name
        diffs = {}
        for fname, blocks in (body.get("diffs") or {}).items():
            f = safe_join(map_dir, fname)
            if f.suffix.lower() == ".osu":
                diffs[f.name] = blocks
        diffs_touched = []
        purge = bool(body.get("purge"))
        with FILE_LOCK:
            patch_file(osb_path, body.get("osb", {}), map_dir, create=True, purge=purge)
            for fname, blocks in diffs.items():
                if patch_file(map_dir / fname, blocks, map_dir, purge=purge):
                    diffs_touched.append(fname)
            wide = []
            if body.get("osb") or any(diffs.values()):
                for f in map_dir.glob("*.osu"):
                    try:
                        if "WidescreenStoryboard:1" not in read_bytes(f).decode("utf-8-sig", errors="replace").replace(" ", ""):
                            backup(f, map_dir)
                            if set_widescreen(f):
                                wide.append(f.name)
                    except (OSError, FileBusy) as e:
                        print(f"  [widescreen] {f.name}: {e}")
            LAST_EXPORT[str(map_dir)] = {"osb": (osb_name, body.get("osb", {})), "diffs": diffs, "wide": bool(body.get("osb") or any(diffs.values()))}
            extra = foreign_count(osb_path, map_dir) + sum(foreign_count(map_dir / n, map_dir) for n in diffs)

        self._json({
            "ok": True,
            "osb": osb_name if osb_path.exists() else None,
            "osbSize": osb_path.stat().st_size if osb_path.exists() else 0,
            "assetsWritten": written,
            "assetsUnchanged": unchanged,
            "assetsDeleted": deleted,
            "diffs": diffs_touched,
            "extra": extra,
            "widescreen": wide,
        })

    def api_widescreen(self, body):
        map_dir = resolve_map_folder(body.get("folder", ""))
        changed = []
        for f in map_dir.glob("*.osu"):
            backup(f, map_dir)
            if set_widescreen(f):
                changed.append(f.name)
        self._json({"ok": True, "changed": changed})

    def api_font_upload(self, body):
        name = Path(body.get("name", "")).name
        if not re.match(r"^[\w\-. ]+\.(ttf|otf|woff2?)$", name, re.I):
            raise ValueError("unsupported font file")
        FONTS_DIR.mkdir(exist_ok=True)
        (FONTS_DIR / name).write_bytes(base64.b64decode(body["data"]))
        self._json({"ok": True, "name": name})

    def api_events(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        q = BUS.subscribe()
        try:
            self.wfile.write(b": hello\n\n")
            self.wfile.flush()
            while True:
                try:
                    ev = q.get(timeout=15)
                    payload = f"data: {json.dumps(ev)}\n\n".encode("utf-8")
                except queue.Empty:
                    payload = b": ping\n\n"
                self.wfile.write(payload)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
            pass
        finally:
            BUS.unsubscribe(q)
            self.close_connection = True


def find_port(preferred: int) -> int:
    for port in [preferred] + list(range(preferred + 1, preferred + 30)):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise SystemExit("No free port found")


def set_data_dir(path: Path) -> None:
    global DATA_DIR, PROJECTS_DIR, BACKUP_DIR, FONTS_DIR, SETTINGS_FILE
    DATA_DIR = path.resolve()
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    PROJECTS_DIR, BACKUP_DIR, FONTS_DIR = DATA_DIR / "projects", DATA_DIR / "backups", DATA_DIR / "fonts"
    SETTINGS_FILE = DATA_DIR / "settings.json"
    SETTINGS.clear()
    SETTINGS.update(load_settings())


def _build_id() -> str:
    try:
        src = Path(sys.executable) if getattr(sys, "frozen", False) else Path(__file__)
        return f"{APP_VERSION}-{int(src.stat().st_mtime)}"
    except OSError:
        return APP_VERSION


BUILD_ID = _build_id()


def running_instance(port: int) -> dict | None:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/state", timeout=0.7) as r:
            st = json.loads(r.read().decode("utf-8"))
            return st if st.get("app") in (APP_NAME, *OLD_NAMES) else None
    except Exception:
        return None


def replace_instance(port: int) -> bool:
    try:
        req = urllib.request.Request(f"http://127.0.0.1:{port}/api/quit", data=b"{}", method="POST",
                                     headers={"X-SBKit": "1", "Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=2).close()
    except Exception:
        return False
    for _ in range(40):
        time.sleep(0.1)
        if not running_instance(port):
            return True
    return False


def open_ui(base: str, full: bool) -> None:
    if full or not desktop.open_app_window(base, DATA_DIR / "window-profile"):
        webbrowser.open(base)


def main():
    ap = argparse.ArgumentParser(description=f"{APP_NAME} - osu! storyboard toolkit")
    ap.add_argument("--port", type=int, default=7272)
    ap.add_argument("--no-browser", action="store_true", help="don't open any window")
    ap.add_argument("--full", action="store_true", help="open in a tab of your normal browser instead of the app window")
    ap.add_argument("--songs", help="path to your osu! Songs folder")
    ap.add_argument("--data", help="folder for projects/backups/settings (default: next to the app)")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    if args.data:
        set_data_dir(Path(args.data))
    if args.songs:
        SETTINGS["songsDir"] = str(Path(args.songs).resolve())

    other = running_instance(args.port)
    replaced = bool(other) and other.get("build") != BUILD_ID and replace_instance(args.port)
    if other and not replaced:
        print(f"  {APP_NAME} is already running - opening its window.")
        if not args.no_browser:
            open_ui(f"http://127.0.0.1:{args.port}/", args.full)
        return
    if replaced:
        print(f"  Replaced an older {APP_NAME} that was still running.")

    for d in (PROJECTS_DIR, BACKUP_DIR, FONTS_DIR):
        d.mkdir(exist_ok=True)

    port = find_port(args.port)
    httpd = Server(("127.0.0.1", port), Handler)
    httpd.daemon_threads = True
    httpd.verbose = args.verbose
    threading.Thread(target=clipboard_loop, daemon=True).start()
    threading.Thread(target=tosu_loop, daemon=True).start()
    threading.Thread(target=osu_window_loop, daemon=True).start()
    threading.Thread(target=file_watch_loop, daemon=True).start()
    threading.Thread(target=map_info_loop, daemon=True).start()
    HOTKEY_STATUS.update(desktop.start_hotkeys(lambda name: BUS.publish("hotkey", {"name": name, "at": time.time()})))

    url = f"http://127.0.0.1:{port}/"
    sd = songs_dir()
    print(f"\n  {APP_NAME} {APP_VERSION}")
    print(f"  UI:     {url}")
    print(f"  Songs:  {sd if sd else 'not found - set it in the app (Settings)'}")
    if HOTKEY_STATUS:
        print("  Hotkeys: " + ", ".join(f"{k}={'ok' if v else 'taken'}" for k, v in HOTKEY_STATUS.items()))
    print("  Close this window to stop.\n")
    if not args.no_browser:
        if replaced:
            threading.Timer(4.0, lambda: None if BUS.has_clients else open_ui(url, args.full)).start()
        else:
            threading.Timer(0.4, lambda: open_ui(url, args.full)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
