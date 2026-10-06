"""用可检查的微型库验证 LEF/Liberty 提取，避免以画面重叠推断连接。"""

import json
import tempfile
import unittest
from pathlib import Path

from backend.configuration import load_configuration
from backend.library import LibraryStore, parse_lef_cell, parse_liberty_cell, parse_liberty_metadata, parse_tech_lef
from helpers import test_document, write_test_configuration


LEF = """MACRO demo_inv
  CLASS CORE ;
  SIZE 1.38 BY 2.72 ;
  SYMMETRY X Y ;
  SITE unit ;
  PIN Y
    DIRECTION OUTPUT ;
    USE SIGNAL ;
    PORT
      LAYER met1 ;
      RECT 0.1 0.2 0.3 0.4 ;
      LAYER met2 ;
      POLYGON 0 0 1 0 1 1 ;
    END
  END Y
END demo_inv
"""

LIBERTY = """library (example) {
    time_unit : "1ns";
    voltage_unit : "1V";
    capacitive_load_unit(1.0, "pf");
    operating_conditions (typical) { voltage : 1.8; temperature : 25; process : 1.0; }
    cell ("demo_inv") {
      area : 3.7536;
      pin ("Y") {
        direction : output;
        function : "(!A)";
        timing () { capacitance : 999; test : "{ braces in a string }"; }
      }
      pin (A) { direction : input; capacitance : 0.002; }
    }
}"""

TECH = """UNITS
 DATABASE MICRONS 1000 ;
END UNITS
SITE unit
 SIZE 0.46 BY 2.72 ;
END unit
LAYER met1
 TYPE ROUTING ;
 DIRECTION HORIZONTAL ;
 WIDTH 0.14 ;
 ANTENNAAREARATIO 400 ;
END met1
"""


class LibraryParsingTest(unittest.TestCase):
    def test_lef_retains_units_layer_pin_identity_and_marks_unsupported_shapes(self) -> None:
        cell = parse_lef_cell(LEF, "demo_inv")
        self.assertEqual(cell["unit"], "µm")
        self.assertEqual(cell["width"], 1.38)
        self.assertEqual(cell["pins"][0]["geometry"], [{"layer": "met1", "rect": [0.1, 0.2, 0.3, 0.4]}])
        self.assertEqual(cell["unsupported_geometry"], ["POLYGON"])
        self.assertIsNone(parse_lef_cell(LEF, "demo"))

    def test_liberty_reads_exact_cell_and_does_not_leak_nested_timing_attributes(self) -> None:
        cell = parse_liberty_cell(LIBERTY, "demo_inv")
        self.assertEqual(cell["area"], "3.7536")
        self.assertEqual(cell["pins"][0]["function"], "(!A)")
        self.assertIsNone(cell["pins"][0]["capacitance"])
        self.assertEqual(cell["pins"][1]["capacitance"], "0.002")
        self.assertIsNone(parse_liberty_cell(LIBERTY, "demo"))

    def test_technology_retains_actual_site_layer_names_and_rule_text(self) -> None:
        technology = parse_tech_lef(TECH)
        self.assertEqual(technology["database_units_per_micron"], 1000)
        self.assertEqual(technology["sites"][0]["name"], "unit")
        self.assertEqual(technology["layers"][0]["antenna_statements"], ["ANTENNAAREARATIO 400 ;"])

    def test_liberty_preserves_units_and_operating_conditions(self) -> None:
        metadata = parse_liberty_metadata(LIBERTY)
        self.assertEqual(metadata["capacitive_load_unit"], {"scale": "1.0", "unit": "pf"})
        self.assertEqual(metadata["units"]["time_unit"], "1ns")
        self.assertEqual(metadata["operating_conditions"][0]["voltage"], "1.8")

    def test_store_reloads_changed_source_and_rejects_unregistered_identity(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            document = test_document(root)
            pdk = document["pdks"]["sky130hd"]
            pdk["cells"] = [{"name": "demo_inv", "role": "反相器", "evidence": "fixture function"}]
            sources = root / "sources"
            sources.mkdir()
            for field, filename, text in (("cell_lef", "cells.lef", LEF), ("tech_lef", "tech.lef", TECH)):
                path = sources / filename
                path.write_text(text, encoding="utf-8")
                pdk[field] = str(path)
            liberty = sources / "corner.lib"
            liberty.write_text(LIBERTY, encoding="utf-8")
            pdk["liberty"] = [str(liberty)]
            config = load_configuration(write_test_configuration(root, document))
            store = LibraryStore(config)
            first = store.cell("sky130hd", "demo_inv")
            self.assertEqual(first["status"], "ready")
            self.assertNotIn(str(sources), json.dumps(first))
            Path(pdk["cell_lef"]).write_text(LEF.replace("1.38", "2.760"), encoding="utf-8")
            second = store.cell("sky130hd", "demo_inv")
            self.assertEqual(second["lef"]["width"], 2.76)
            self.assertNotEqual(first["sources"]["cell_lef"]["sha256"], second["sources"]["cell_lef"]["sha256"])
            with self.assertRaises(KeyError):
                store.cell("sky130hd", "../unknown")
