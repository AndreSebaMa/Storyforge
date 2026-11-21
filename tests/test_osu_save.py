import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import server

OSB = "\r\n".join(server.EMPTY_OSB)


def glow(t, layer="Foreground"):
    return [f'Sprite,{layer},Centre,"sb/storyforge/glow.png",320,240', f" F,0,{t},{t + 400},1,0", f" S,0,{t},{t + 400},1,1.5",
            f" C,0,{t},{t},255,128,0", f" P,0,{t},{t},A"]


def picture(t):
    return ['Sprite,Background,Centre,"bg.jpg",320,240', f" S,0,{t},{t},0.6", f" C,0,{t},{t},153,153,153", f" F,4,{t},{t + 900},0,1"]


def osu_style(text: str) -> str:
    out, block = [], None

    def flush():
        nonlocal block
        if block:
            first = [c for c in block[1:] if c.startswith(" P,")]
            out.extend([block[0]] + first + [c for c in block[1:] if c not in first])
        block = None

    for line in text.split("\r\n"):
        if line.startswith(("Sprite,", "Animation,")):
            flush()
            block = [line.replace('"sb/storyforge/', '"sb\\storyforge\\')]
        elif line[:1] in (" ", "_") and block:
            p = line.split(",")
            if len(p) > 4 and p[2] == p[3]:
                p[3] = ""
            block.append(",".join(p))
        else:
            flush()
            out.append(line)
    flush()
    return "\r\n".join(out)


class Signature(unittest.TestCase):
    def test_same_sprite_in_both_styles(self):
        ours = glow(1000)
        theirs = osu_style("\r\n".join(ours)).split("\r\n")
        self.assertNotEqual(ours, theirs)
        self.assertEqual(server.block_sig(ours), server.block_sig(theirs))

    def test_shorthand_values(self):
        a = ['Sprite,Foreground,Centre,"sb/storyforge/a.png",320,240', " F,0,100,200,1", " M,0,100,200,10,20"]
        b = ['Sprite,Foreground,Centre,"sb\\storyforge\\a.png",320.000,240', " M,0,100,200,10,20,10,20", " F,0,100,200,1,1"]
        self.assertEqual(server.block_sig(a), server.block_sig(b))

    def test_differences_are_seen(self):
        base = server.block_sig(glow(1000))
        self.assertNotEqual(base, server.block_sig(glow(1001)))
        self.assertNotEqual(base, server.block_sig(glow(1000, "Background")))
        moved = glow(1000)
        moved[0] = moved[0].replace("320,240", "321,240")
        self.assertNotEqual(base, server.block_sig(moved))

    def test_loops_keep_their_commands(self):
        a = ['Sprite,Foreground,Centre,"sb/storyforge/a.png",0,0', " L,0,4", "  F,0,0,100,0,1", " L,500,2", "  F,0,0,50,1,0"]
        b = ['Sprite,Foreground,Centre,"sb/storyforge/a.png",0,0', " L,0,4", "  F,0,0,50,1,0", " L,500,2", "  F,0,0,100,0,1"]
        self.assertNotEqual(server.block_sig(a), server.block_sig(b))


class AfterOsuSaved(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name) / "123 Artist - Title"
        self.dir.mkdir()
        (self.dir / "map.osu").write_text("osu file format v14\r\n\r\n[Events]\r\n", "utf-8")
        self.osb = self.dir / "Artist - Title (me).osb"
        self._projects, self._backups = server.PROJECTS_DIR, server.BACKUP_DIR
        server.PROJECTS_DIR, server.BACKUP_DIR = Path(self.tmp.name) / "projects", Path(self.tmp.name) / "backups"
        server.LAST_EXPORT.clear()

    def tearDown(self):
        server.PROJECTS_DIR, server.BACKUP_DIR = self._projects, self._backups
        server.LAST_EXPORT.clear()
        self.tmp.cleanup()

    def write(self, blocks):
        server.patch_file(self.osb, blocks, self.dir, create=True)
        server.LAST_EXPORT[str(self.dir)] = {"osb": (self.osb.name, blocks), "diffs": {}}

    def text(self) -> str:
        return self.osb.read_bytes().decode("utf-8")

    def osu_saves(self, memory: str):
        self.osb.write_bytes(memory.encode("utf-8"))

    def sprites(self):
        return [l for l in self.text().split("\r\n") if l.startswith("Sprite,")]

    def test_osu_holds_the_current_storyboard(self):
        blocks = {"Foreground": glow(1000) + glow(2000), "Background": picture(0)}
        self.write(blocks)
        saved = osu_style(self.text())
        self.osu_saves(saved)
        self.assertTrue(server.holds_storyboard(self.osb, blocks, self.dir))
        fixed, behind = server.reapply(self.dir, [self.osb.name])
        self.assertEqual((fixed, behind), ([], False))
        self.assertEqual(self.text(), saved, "a file that holds our storyboard must be left alone")

    def test_osu_holds_an_older_storyboard(self):
        self.write({"Foreground": glow(1000)})
        older = osu_style(self.text())
        now = {"Foreground": glow(1000) + glow(2000)}
        self.write(now)
        self.osu_saves(older)
        fixed, behind = server.reapply(self.dir, [self.osb.name])
        self.assertEqual((fixed, behind), ([self.osb.name], True))
        self.assertTrue(server.holds_storyboard(self.osb, now, self.dir))
        self.assertEqual(len(self.sprites()), 2)

    def test_order_within_a_layer_counts(self):
        self.write({"Foreground": glow(1000) + glow(2000)})
        self.assertFalse(server.holds_storyboard(self.osb, {"Foreground": glow(2000) + glow(1000)}, self.dir))

    def test_own_pictures_do_not_pile_up(self):
        self.write({"Background": picture(0)})
        self.osu_saves(osu_style(self.text()))
        self.write({"Background": picture(500)})
        lines = self.sprites()
        self.assertEqual(len(lines), 1, lines)
        self.assertTrue(server.holds_storyboard(self.osb, {"Background": picture(500)}, self.dir))

    def test_someone_elses_sprites_stay(self):
        theirs = ['Sprite,Foreground,Centre,"sb/theirs.png",320,240', " F,0,0,1000,0,1"]
        self.osb.write_bytes(server.patch_events(OSB, {}).replace("//Storyboard Layer 3 (Foreground)", "//Storyboard Layer 3 (Foreground)\r\n" + "\r\n".join(theirs)).encode("utf-8"))
        self.write({"Foreground": glow(1000)})
        self.osu_saves(osu_style(self.text()))
        self.write({"Foreground": glow(3000)})
        self.assertEqual(sum("theirs.png" in l for l in self.sprites()), 1)
        self.assertEqual(sum("storyforge" in l for l in self.sprites()), 1)

    def test_check_only_does_not_write(self):
        blocks = {"Foreground": glow(1000)}
        self.write(blocks)
        saved = osu_style(self.text())
        self.osu_saves(saved)
        self.assertFalse(server.patch_file(self.osb, blocks, self.dir, dry=True), "same storyboard: the map does not differ")
        self.assertTrue(server.patch_file(self.osb, {"Foreground": glow(1500)}, self.dir, dry=True))
        self.assertEqual(self.text(), saved)


if __name__ == "__main__":
    unittest.main()
