from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

IS_WIN = os.name == "nt"
if IS_WIN:
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.EnumWindows.argtypes = [WNDENUMPROC, wintypes.LPARAM]
    user32.GetWindowTextLengthW.argtypes = [wintypes.HWND]
    user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user32.IsWindowVisible.argtypes = [wintypes.HWND]
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user32.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.UINT]
    user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
    user32.RegisterHotKey.argtypes = [wintypes.HWND, ctypes.c_int, wintypes.UINT, wintypes.UINT]
    user32.GetMessageW.argtypes = [ctypes.POINTER(wintypes.MSG), wintypes.HWND, wintypes.UINT, wintypes.UINT]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    user32.GetForegroundWindow.restype = wintypes.HWND
    user32.SetForegroundWindow.argtypes = [wintypes.HWND]
    user32.IsIconic.argtypes = [wintypes.HWND]
    user32.AttachThreadInput.argtypes = [wintypes.DWORD, wintypes.DWORD, wintypes.BOOL]

WINDOW_TITLE = "Storyforge"


RUNNING_OSU = {"dir": None}


def _process_name(pid: int) -> str:
    h = kernel32.OpenProcess(0x1000, False, pid)
    if not h:
        return ""
    try:
        buf = ctypes.create_unicode_buffer(1024)
        size = wintypes.DWORD(1024)
        if kernel32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(size)):
            name = os.path.basename(buf.value).lower()
            if name == "osu!.exe":
                RUNNING_OSU["dir"] = os.path.dirname(buf.value)
            return name
        return ""
    finally:
        kernel32.CloseHandle(h)


def running_osu_dir() -> str | None:
    if RUNNING_OSU["dir"] is None and IS_WIN and time.time() - RUNNING_OSU.get("looked", 0) > 5:
        RUNNING_OSU["looked"] = time.time()
        try:
            list_windows()
        except Exception:
            pass
    return RUNNING_OSU["dir"]


def list_windows() -> list[tuple[int, str, str]]:
    if not IS_WIN:
        return []
    out = []

    def cb(hwnd, _):
        if not user32.IsWindowVisible(hwnd):
            return True
        n = user32.GetWindowTextLengthW(hwnd)
        if n <= 0:
            return True
        buf = ctypes.create_unicode_buffer(n + 1)
        user32.GetWindowTextW(hwnd, buf, n + 1)
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        out.append((hwnd, buf.value, _process_name(pid.value)))
        return True

    user32.EnumWindows(WNDENUMPROC(cb), 0)
    return out


def osu_window_title() -> str | None:
    w = _osu_window()
    return w[1] if w else None


def _osu_window() -> tuple[int, str] | None:
    best = None
    for hwnd, title, exe in list_windows():
        if exe == "osu!.exe" and (best is None or len(title) > len(best[1])):
            best = (hwnd, title)
    return best


def file_users(path) -> list[str]:
    if not IS_WIN:
        return []
    try:
        class RM_UNIQUE_PROCESS(ctypes.Structure):
            _fields_ = [("dwProcessId", wintypes.DWORD), ("ProcessStartTime", wintypes.FILETIME)]

        class RM_PROCESS_INFO(ctypes.Structure):
            _fields_ = [("Process", RM_UNIQUE_PROCESS), ("strAppName", wintypes.WCHAR * 256),
                        ("strServiceShortName", wintypes.WCHAR * 64), ("ApplicationType", ctypes.c_int),
                        ("AppStatus", wintypes.ULONG), ("TSSessionId", wintypes.DWORD), ("bRestartable", wintypes.BOOL)]

        rm = ctypes.WinDLL("rstrtmgr")
        session = wintypes.DWORD()
        key = ctypes.create_unicode_buffer(64)
        if rm.RmStartSession(ctypes.byref(session), 0, key):
            return []
        try:
            files = (wintypes.LPCWSTR * 1)(str(path))
            if rm.RmRegisterResources(session, 1, files, 0, None, 0, None):
                return []
            needed, count, reasons = wintypes.UINT(), wintypes.UINT(16), wintypes.DWORD()
            infos = (RM_PROCESS_INFO * 16)()
            if rm.RmGetList(session, ctypes.byref(needed), ctypes.byref(count), infos, ctypes.byref(reasons)):
                return []
            names = []
            for i in range(count.value):
                n = _process_name(infos[i].Process.dwProcessId) or infos[i].strAppName
                if n and n not in names:
                    names.append(n)
            return names
        finally:
            rm.RmEndSession(session)
    except Exception:
        return []


def find_browser() -> str | None:
    cands = []
    if IS_WIN:
        for base in (os.environ.get("ProgramFiles(x86)"), os.environ.get("ProgramFiles"), os.environ.get("LOCALAPPDATA")):
            if base:
                cands += [Path(base) / "Microsoft/Edge/Application/msedge.exe", Path(base) / "Google/Chrome/Application/chrome.exe",
                          Path(base) / "BraveSoftware/Brave-Browser/Application/brave.exe"]
    for c in cands:
        if c.exists():
            return str(c)
    for name in ("microsoft-edge", "google-chrome", "chromium", "chromium-browser"):
        p = shutil.which(name)
        if p:
            return p
    return None


def work_area() -> tuple[int, int, int, int]:
    if IS_WIN:
        r = wintypes.RECT()
        if user32.SystemParametersInfoW(0x30, 0, ctypes.byref(r), 0):
            return r.left, r.top, r.right, r.bottom
    return 0, 0, 1920, 1080


def maximize_app_window(title: str = WINDOW_TITLE) -> int:
    if not IS_WIN:
        return 0
    n = 0
    for hwnd, t, exe in list_windows():
        if t == title and exe in ("msedge.exe", "chrome.exe", "brave.exe"):
            user32.SetWindowPos(hwnd, -2, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010)
            user32.ShowWindow(hwnd, 3)
            n += 1
    return n


def open_app_window(url: str, profile_dir: Path) -> bool:
    exe = find_browser()
    if not exe:
        return False
    args = [exe, f"--app={url}", f"--user-data-dir={profile_dir}", "--no-first-run", "--no-default-browser-check",
            "--start-maximized", "--disable-features=Translate,msEdgeSidebarV2,msHubApps"]
    subprocess.Popen(args, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0) if IS_WIN else 0)
    if IS_WIN:
        def grow():
            for _ in range(60):
                time.sleep(0.25)
                if maximize_app_window():
                    return
        threading.Thread(target=grow, daemon=True).start()
    return True


INVALID = re.compile(r'[\\/:*?"<>|]')


def parse_osu_title(title: str | None) -> dict:
    if not title:
        return {"running": False}
    m = re.match(r"^osu!\S*\s*-\s*(.+)$", title.strip()) or re.match(r"^osu!.*?\s+-\s+(.+)$", title.strip())
    if not m:
        return {"running": True, "title": title}
    rest = m.group(1).strip()
    if rest.lower().endswith(".osu"):
        return {"running": True, "title": title, "filename": rest}
    m2 = re.match(r"^(.*)\s\[(.+)\]$", rest)
    if m2:
        return {"running": True, "title": title, "song": m2.group(1).strip(), "diff": m2.group(2).strip()}
    return {"running": True, "title": title, "song": rest}


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", INVALID.sub("", s)).strip().lower()


def _alnum(s: str) -> str:
    return re.sub(r"[^0-9a-z]+", "", s.lower())


# Finds the folder of the map osu! has open, from its window title.
class SongsIndex:

    KEEP, KEEP_MISS = 8.0, 25.0
    LOOK_FOLDERS, LOOK_SECONDS = 800, 2.0

    def __init__(self):
        self.lists: dict[str, tuple[list[tuple[str, str, float]], float]] = {}
        self.cache: dict[tuple, tuple[float, tuple[str, str] | None]] = {}
        self.scanned: dict[tuple, tuple[tuple, float]] = {}

    def _list(self, root: Path) -> list[tuple[str, str, float]]:
        have = self.lists.get(str(root))
        if have and time.time() - have[1] < 30:
            return have[0]
        out = []
        try:
            for e in os.scandir(root):
                if e.is_dir():
                    try:
                        mt = e.stat().st_mtime
                    except OSError:
                        mt = 0
                    out.append((e.name, _alnum(re.sub(r"^\d+\s+", "", e.name)), mt))
        except OSError:
            return have[0] if have else []
        out.sort(key=lambda x: -x[2])
        self.lists[str(root)] = (out, time.time())
        return out

    def resolve(self, roots, info: dict, prefer: str | None = None) -> tuple[str, str] | None:
        roots = [r for r in (roots if isinstance(roots, (list, tuple)) else [roots]) if r]
        if not roots or not info.get("running"):
            return None
        key = (info.get("filename") or f"{info.get('song')}|{info.get('diff')}", prefer, tuple(str(r) for r in roots))
        hit = self.cache.get(key)
        if hit and time.time() - hit[0] < (self.KEEP if hit[1] else self.KEEP_MISS):
            return hit[1]
        out = None
        for i, root in enumerate(roots):
            found = self._resolve_in(root, info, prefer)
            if found:
                out = found if i == 0 else (str(root / found[0]), found[1])
                break
        if len(self.cache) > 200:
            self.cache.clear()
        self.cache[key] = (time.time(), out)
        return out

    def _resolve_in(self, root: Path, info: dict, prefer: str | None) -> tuple[str, str] | None:
        folders = self._list(root)
        if info.get("filename"):
            fn = info["filename"]
            m = re.match(r"^(.*) \([^()]*\) \[.*\]\.osu$", fn, re.I)
            song, want = (m.group(1) if m else fn[:-4]), _norm(fn)
            match = lambda name: _norm(name) == want
        elif info.get("song"):
            song, nd = info["song"], _norm(info.get("diff") or "")
            ns = _norm(info["song"])
            match = lambda name: _norm(name).startswith(ns + " (") and (not nd or _norm(name).endswith(f"[{nd}].osu"))
        else:
            return None
        k = _alnum(song)

        def look(name):
            try:
                for f in os.scandir(root / name):
                    if f.name.lower().endswith(".osu") and match(f.name):
                        try:
                            return name, f.name, f.stat().st_mtime
                        except OSError:
                            return name, f.name, 0
            except OSError:
                pass
            return None

        likely = [name for name, akey, _ in folders if k and (k in akey or (len(akey) >= 4 and akey in k))]
        hits = [h for h in map(look, likely) if h]
        state, was = (len(folders), folders[0][2] if folders else 0), self.scanned.get((str(root), k, song))
        if not hits and not (was and was[0] == state and time.time() - was[1] < 120):
            self.scanned[(str(root), k, song)] = (state, time.time())
            seen, until = set(likely), time.time() + self.LOOK_SECONDS
            for name, _, _ in folders[:self.LOOK_FOLDERS]:
                if time.time() > until:
                    break
                if name not in seen:
                    h = look(name)
                    if h:
                        hits = [h]
                        break
        if not hits:
            return None
        mine = [h for h in hits if prefer and h[0].lower() == prefer.lower()]
        best = mine[0] if mine else max(hits, key=lambda h: h[2])
        return best[0], best[1]


HOTKEYS = {
    1: ("repeat", 0x0001 | 0x0002 | 0x4000, ord("R")),
    2: ("undo", 0x0001 | 0x0002 | 0x4000, ord("Z")),
}


def start_hotkeys(callback) -> dict:
    status: dict = {}
    if not IS_WIN:
        return status
    ready = threading.Event()

    def loop():
        for hid, (name, mods, vk) in HOTKEYS.items():
            status[name] = bool(user32.RegisterHotKey(None, hid, mods, vk))
        ready.set()
        msg = wintypes.MSG()
        while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
            if msg.message == 0x0312 and msg.wParam in HOTKEYS:
                try:
                    callback(HOTKEYS[msg.wParam][0])
                except Exception:
                    pass

    threading.Thread(target=loop, daemon=True).start()
    ready.wait(2)
    return status


if __name__ == "__main__":
    print("osu! title:", osu_window_title())
    print("parsed:", parse_osu_title(osu_window_title()))
    print("browser:", find_browser())
    print("work area:", work_area())
    sys.exit(0)
