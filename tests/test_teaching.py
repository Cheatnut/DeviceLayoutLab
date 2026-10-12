"""检查教学图形的真实连接关系，防止只画出正确文字而几何发生开路/短路。"""
import itertools
import json
import math
import unittest
from pathlib import Path

from backend.teaching import build_teaching_case


def overlaps(a, b):
    return a[0] <= b[0]+b[2] and b[0] <= a[0]+a[2] and a[1] <= b[1]+b[3] and b[1] <= a[1]+a[3]


class TeachingGeometryTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        catalog = json.loads((Path(__file__).resolve().parents[1] / "backend/data/cases.json").read_text(encoding="utf-8"))
        cls.cases = [build_teaching_case(c, catalog["teachingDefaults"]) for c in catalog["cases"] if "teaching" in c]

    def test_shapes_have_finite_dimensions_and_configured_stack(self):
        for case in self.cases:
            for entity in case["entities"]:
                layer = case["teaching"]["layers"][entity["layer"]]
                self.assertGreater(layer["top"], layer["bottom"])
                for rect in entity.get("modelRects", entity["rects"]):
                    self.assertTrue(all(math.isfinite(v) for v in rect))
                    self.assertTrue(rect[2] > 0 and rect[3] > 0)

    def test_geometric_connectivity_matches_transistor_netlist(self):
        for case in self.cases:
            with self.subTest(case=case["title"]):
                # 分别提取金属、有源掺杂区与多晶硅；只有同层交叠以及接触孔可导通。
                conductors = [(e, r) for e in case["entities"] if e["layer"] in {"M1", "PAA", "NAA", "POLY"}
                              for r in e.get("modelRects", e["rects"])]
                parents = list(range(len(conductors)))
                def root(i):
                    while parents[i] != i:
                        i = parents[i]
                    return i
                def join(a, b):
                    parents[root(a)] = root(b)
                for i, (a, ar) in enumerate(conductors):
                    for j, (b, br) in enumerate(conductors[:i]):
                        if a["layer"] == b["layer"] and overlaps(ar, br):
                            join(i, j)
                for contact in [e for e in case["entities"] if e["layer"] == "CONTACT"]:
                    for rect in contact["rects"]:
                        hits = [i for i,(e,r) in enumerate(conductors) if overlaps(rect,r)]
                        self.assertEqual({conductors[i][0]["layer"] for i in hits} & {"POLY"}, set())
                        self.assertIn("M1", {conductors[i][0]["layer"] for i in hits})
                        self.assertTrue({"PAA", "NAA"} & {conductors[i][0]["layer"] for i in hits})
                        for i in hits[1:]: join(hits[0], i)
                net_roots = {}
                for i, (e, _) in enumerate(conductors):
                    if e["layer"] in {"M1", "POLY"}:
                        previous = net_roots.setdefault(e["net"], root(i))
                        self.assertEqual(previous, root(i), f'{e["net"]} 开路')
                self.assertEqual(len(set(net_roots.values())), len(net_roots), "不同网络短路")
                def diffusion_root(x, y):
                    return next(root(i) for i,(e,r) in enumerate(conductors) if e["layer"] in {"PAA", "NAA"} and overlaps(r,[x,y,0,0]))
                for d in case["teaching"]["devices"]:
                    x,y = d["at"]
                    offset = case["teaching"]["polyWidth"] / 2 + 1
                    actual = {diffusion_root(x-offset,y), diffusion_root(x+offset,y)}
                    self.assertEqual(len(actual), 2, "栅两侧源漏被直接短接")
                    if "X" in (d["source"],d["drain"]):
                        external = net_roots[d["drain"] if d["source"] == "X" else d["source"]]
                        self.assertIn(external, actual)
                        internal = (actual - {external}).pop()
                        self.assertEqual(net_roots.setdefault("X", internal), internal)
                    self.assertEqual(actual, {net_roots[d["source"]], net_roots[d["drain"]]})

    def test_all_input_combinations_have_correct_pullup_and_pulldown(self):
        for case in self.cases:
            spec = case["teaching"]
            inputs = [g["net"] for g in spec["gates"]]
            for values in itertools.product((False, True), repeat=len(inputs)):
                state = dict(zip(inputs, values))
                edges = [(d["source"], d["drain"]) for d in spec["devices"] if state[d["gate"]] == (d["type"] == "nmos")]
                reached = {"Y"}
                while True:
                    expanded = reached | {a for a,b in edges if b in reached} | {b for a,b in edges if a in reached}
                    if expanded == reached: break
                    reached = expanded
                expected = not all(values)
                self.assertEqual("VDD" in reached, expected)
                self.assertEqual("GND" in reached, not expected)

    def test_well_and_body_contacts_are_in_the_correct_region(self):
        for case in self.cases:
            s = case["teaching"]
            well = s["well"]
            paa = next(a["rect"] for a in s["active"] if a["layer"] == "PAA")
            naa = next(a["rect"] for a in s["active"] if a["layer"] == "NAA")
            self.assertTrue(paa[0] > well[0] and paa[1] > well[1] and paa[0]+paa[2] < well[0]+well[2] and paa[1]+paa[3] < well[1]+well[3])
            self.assertFalse(overlaps(naa, well))
            self.assertEqual(s["taps"][0]["net"], "VDD")
            self.assertTrue(overlaps(s["taps"][0]["rect"], well))
            self.assertEqual(s["taps"][1]["net"], "GND")
            self.assertFalse(overlaps(s["taps"][1]["rect"], well))
