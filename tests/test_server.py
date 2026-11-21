import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import server

OSU = "\r\n".join([
    "osu file format v14", "", "[General]", "AudioFilename: audio.mp3", "Mode: 0", "",
    "[Events]", "//Background and Video events", '0,0,"bg.jpg",0,0', "//Break Periods",
    "//Storyboard Layer 0 (Background)",
    'Sprite,Background,Centre,"sb/theirs.png",320,240',
    " F,0,1000,2000,0,1",
    "//Storyboard Layer 1 (Fail)", "//Storyboard Layer 2 (Pass)", "//Storyboard Layer 3 (Foreground)",
    "//Storyboard Layer 4 (Overlay)", "//Storyboard Sound Samples", "",
    "[TimingPoints]", "0,500,4,2,0,100,1,0", "", "[HitObjects]", "256,192,1000,1,0,0:0:0:0:", "",
])


def ours(n, layer="Foreground"):
    return [f'Sprite,{layer},Centre,"sb/storyforge/glow.png",{n},240', f" F,0,{n},{n + 100},1,0"]


class PatchTests(unittest.TestCase):
    def test_insert_and_replace(self):
        out = server.patch_events(OSU, {"Foreground": ours(1), "Background": ours(2, "Background")})
        self.assertIn("\r\n", out)
        self.assertNotIn("\r\r\n", out)
        self.assertIn('"sb/theirs.png"', out)
        self.assertEqual(out.count('"sb/storyforge/glow.png"'), 2)
        lines = out.split("\r\n")
        bg = lines.index("//Storyboard Layer 0 (Background)")
        fail = lines.index("//Storyboard Layer 1 (Fail)")
        self.assertTrue(any('"sb/storyforge/glow.png",2,' in l for l in lines[bg:fail]))
        fg = lines.index("//Storyboard Layer 3 (Foreground)")
        ov = lines.index("//Storyboard Layer 4 (Overlay)")
        self.assertTrue(any('"sb/storyforge/glow.png",1,' in l for l in lines[fg:ov]))
        out2 = server.patch_events(out, {"Foreground": ours(3)})
        self.assertEqual(out2.count('"sb/storyforge/'), 1)
        self.assertIn('",3,240', out2)
        self.assertIn('"sb/theirs.png"', out2)
        self.assertIn(" F,0,1000,2000,0,1", out2)
        self.assertTrue(out2.endswith(OSU[OSU.index("[TimingPoints]"):]))
        self.assertEqual(server.patch_events(out2, {}), OSU)

    def test_purge_removes_everything_else(self):
        out = server.patch_events(OSU, {"Foreground": ours(1)})
        self.assertIn('"sb/theirs.png"', out)
        out = server.patch_events(out, {"Foreground": ours(2)}, purge=True)
        self.assertNotIn('"sb/theirs.png"', out)
        self.assertNotIn(" F,0,1000,2000,0,1", out)
        self.assertEqual(out.count('"sb/storyforge/'), 1)
        self.assertIn('0,0,"bg.jpg",0,0', out)
        self.assertTrue(out.endswith(OSU[OSU.index("[TimingPoints]"):]))

    def test_own_sprites_on_map_pictures(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            old = server.PROJECTS_DIR, server.BACKUP_DIR
            server.PROJECTS_DIR, server.BACKUP_DIR = root / "projects", root / "backups"
            try:
                m = root / "1 Artist - Song"
                m.mkdir()
                osb = m / "song.osb"
                theirs = ['Sprite,Background,Centre,"bg.jpg",320,240', " F,0,0,5000,1"]
                osb.write_bytes("\r\n".join(["[Events]", "//Background and Video events",
                                             "//Storyboard Layer 0 (Background)", *theirs,
                                             "//Storyboard Layer 1 (Fail)", "//Storyboard Layer 2 (Pass)",
                                             "//Storyboard Layer 3 (Foreground)", "//Storyboard Layer 4 (Overlay)",
                                             "//Storyboard Sound Samples", ""]).encode())

                def bg(t):
                    return ['Sprite,Background,Centre,"bg.jpg",320,240', f" F,0,{t},{t + 900},0,1", " S,0,0,,0.5"]

                self.assertTrue(server.patch_file(osb, {"Background": bg(100) + ours(1, "Background")}, m))
                self.assertTrue(server.patch_file(osb, {"Background": bg(200) + ours(2, "Background")}, m))
                text = osb.read_text("utf-8")
                self.assertEqual(text.count('"bg.jpg"'), 2)
                self.assertIn(" F,0,0,5000,1", text)
                self.assertIn(" F,0,200,1100,0,1", text)
                self.assertNotIn(" F,0,100,1000,0,1", text)
                self.assertFalse(server.patch_file(osb, {"Background": bg(200) + ours(2, "Background")}, m))
                with_ours = osb.read_bytes()
                self.assertTrue(server.patch_file(osb, {}, m))
                text = osb.read_text("utf-8")
                self.assertEqual(text.count("Sprite,"), 1)
                self.assertIn(" F,0,0,5000,1", text)
                osb.write_bytes(with_ours.replace(b"\r\n F,0,200", b"\r\n_F,0,200").replace(b"\r\n S,0,0", b"\r\n_S,0,0"))
                self.assertTrue(server.patch_file(osb, {}, m))
                text = osb.read_text("utf-8")
                self.assertEqual(text.count("Sprite,"), 1)
                self.assertIn(" F,0,0,5000,1", text)
            finally:
                server.PROJECTS_DIR, server.BACKUP_DIR = old

    def test_restore_backup(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            old = server.PROJECTS_DIR, server.BACKUP_DIR
            server.PROJECTS_DIR, server.BACKUP_DIR = root / "projects", root / "backups"
            try:
                m = root / "2 Artist - Song"
                m.mkdir()
                osb, osu = m / "song.osb", m / "song [Hard].osu"
                clean = "\r\n".join(server.EMPTY_OSB).encode()
                osb.write_bytes(clean)
                osu.write_bytes(OSU.encode())
                stray = ['Sprite,Background,Centre,"bg.jpg",320,240', " F,1,100,900,1,0"]
                self.assertTrue(server.patch_file(osb, {"Background": ours(1, "Background")}, m))
                self.assertTrue(server.patch_file(osu, {"Foreground": ours(4)}, m))
                stamp = server.list_backups(m)[-1]["stamp"]
                broken = server.patch_events(osb.read_text("utf-8"), {"Background": stray})
                osb.write_bytes(broken.encode())
                osu.write_bytes(osu.read_bytes() + b"300,200,2000,1,0,0:0:0:0:\r\n")
                done = server.restore_backup(m, {"song.osb": stamp, "song [Hard].osu": stamp})
                self.assertEqual(sorted(done), ["song [Hard].osu", "song.osb"])
                self.assertEqual(osb.read_bytes(), clean)
                text = osu.read_text("utf-8")
                self.assertNotIn("storyforge", text)
                self.assertIn("300,200,2000,1,0,0:0:0:0:", text)
                self.assertIn('"sb/theirs.png"', text)
                self.assertGreaterEqual(len(server.list_backups(m)), 2)
                self.assertEqual((server.backup_root(m) / stamp / "song.osb").read_bytes(), clean)
                osb.write_bytes(broken.encode())
                self.assertTrue(server.patch_file(osb, {}, m))
                self.assertNotIn("bg.jpg", osb.read_text("utf-8"))
                with self.assertRaises(ValueError):
                    server.restore_backup(m, {"song.osb": "../x"})
            finally:
                server.PROJECTS_DIR, server.BACKUP_DIR = old

    def test_emptying_clears_backslash_paths(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            old = server.PROJECTS_DIR, server.BACKUP_DIR
            server.PROJECTS_DIR, server.BACKUP_DIR = root / "projects", root / "backups"
            try:
                m = root / "3 Artist - Song"
                m.mkdir()
                osb = m / "song.osb"
                osb.write_bytes("\r\n".join(server.EMPTY_OSB).encode())
                block = ['Sprite,Foreground,Centre,"sb\\storyforge\\t\\abc.png",320,240', " F,0,100,900,1,0"]
                self.assertTrue(server.patch_file(osb, {"Foreground": block}, m))
                self.assertIn("storyforge", osb.read_text("utf-8"))
                self.assertTrue(server.patch_file(osb, {}, m))
                self.assertNotIn("storyforge", osb.read_text("utf-8"))
            finally:
                server.PROJECTS_DIR, server.BACKUP_DIR = old

    def test_bom_and_empty_osb(self):
        src = "﻿" + "\r\n".join(server.EMPTY_OSB)
        out = server.patch_events(src, {"Overlay": ours(5, "Overlay")})
        self.assertTrue(out.startswith("﻿[Events]"))
        lines = out.split("\r\n")
        self.assertLess(lines.index("//Storyboard Layer 4 (Overlay)"), [i for i, l in enumerate(lines) if "storyforge" in l][0])
        self.assertLess([i for i, l in enumerate(lines) if "storyforge" in l][0], lines.index("//Storyboard Sound Samples"))

    def test_missing_layer_comments(self):
        src = "[Events]\n//Background and Video events\n0,0,\"bg.jpg\",0,0\n\n[TimingPoints]\n0,500,4,2,0,100,1,0\n"
        out = server.patch_events(src, {"Foreground": ours(7)})
        self.assertIn("//Storyboard Layer 3 (Foreground)", out)
        self.assertIn("[TimingPoints]\n0,500,4,2,0,100,1,0", out)
        self.assertNotIn("\r", out)

    def test_osb_filename(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            name = server.osb_filename(Path(d), {"Artist": "A/B", "Title": 'Why?', "Creator": "me"})
            self.assertEqual(name, "AB - Why (me).osb")

    def test_widescreen(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "x.osu"
            p.write_bytes(OSU.encode())
            self.assertTrue(server.set_widescreen(p))
            t = p.read_bytes().decode()
            self.assertIn("WidescreenStoryboard: 1\r\n", t)
            self.assertFalse(server.set_widescreen(p))
            self.assertEqual(t.count("WidescreenStoryboard"), 1)


@unittest.skipUnless(sys.platform == "win32", "Windows file locking")
class BusyFileTests(unittest.TestCase):

    def _lock(self, path):
        import ctypes
        from ctypes import wintypes
        k32 = ctypes.WinDLL("kernel32", use_last_error=True)
        k32.CreateFileW.restype = wintypes.HANDLE
        k32.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, wintypes.LPVOID,
                                    wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
        h = k32.CreateFileW(str(path), 0x80000000, 0, None, 3, 0x80, None)
        self.assertNotEqual(h, wintypes.HANDLE(-1).value)
        return lambda: k32.CloseHandle(wintypes.HANDLE(h))

    def test_waits_for_short_lock(self):
        import tempfile, threading
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "map.osu"
            p.write_bytes(b"old")
            release = self._lock(p)
            threading.Timer(0.7, release).start()
            server.write_bytes(p, b"new")
            self.assertEqual(p.read_bytes(), b"new")

    def test_long_lock_says_who(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "map.osu"
            p.write_bytes(b"old")
            release = self._lock(p)
            try:
                with self.assertRaises(server.FileBusy) as cm:
                    server.busy_retry(p, lambda: p.write_bytes(b"new"), seconds=0.3)
                self.assertIn("in use by python", str(cm.exception))
            finally:
                release()
            self.assertEqual(p.read_bytes(), b"old")


if __name__ == "__main__":
    unittest.main()
