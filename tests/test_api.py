"""无需 ORFS 环境即可运行的服务与案例契约测试。"""

import json
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from backend import app as APP
from backend.configuration import load_configuration
from helpers import temporary_directory, test_environment


PROJECT_ROOT = Path(__file__).resolve().parents[1]


class CaseCatalogTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = temporary_directory()
        self.addCleanup(self.directory.cleanup)
        self.config = load_configuration(test_environment(Path(self.directory.name)))

    def test_catalog_has_unique_stable_ids(self) -> None:
        catalog = APP.load_case_catalog(self.config)
        case_ids = [case["id"] for case in catalog["cases"]]
        self.assertEqual(len(case_ids), len(set(case_ids)))

    def test_ready_teaching_case_has_selectable_entities(self) -> None:
        teaching_case = APP.find_case(self.config, "sky130-teaching-cells")
        self.assertIsNotNone(teaching_case)
        self.assertEqual(teaching_case["availability"], "ready")
        self.assertGreater(len(teaching_case["entities"]), 0)
        entity_ids = [entity["id"] for entity in teaching_case["entities"]]
        self.assertEqual(len(entity_ids), len(set(entity_ids)))

    def test_catalog_is_valid_json(self) -> None:
        with self.config.path("paths.case_catalog").open(encoding="utf-8") as case_file:
            self.assertIsInstance(json.load(case_file), dict)


class HttpContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        """在随机本地端口启动服务，避免依赖开发者手动启动的进程。"""
        cls.directory = temporary_directory()
        cls.config = load_configuration(test_environment(Path(cls.directory.name)))
        cls.server = APP.create_server(cls.config)
        cls.base_url = f"http://127.0.0.1:{cls.server.server_port}"
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)
        cls.directory.cleanup()

    def test_health_endpoint_reports_service_identity(self) -> None:
        with urlopen(f"{self.base_url}/api/health") as response:  # noqa: S310 - 固定本地测试服务
            payload = json.load(response)
        self.assertEqual(payload, {"status": "ok", "service": "device-layout-lab"})

    def test_run_endpoint_refuses_execution_until_orfs_is_connected(self) -> None:
        request = Request(f"{self.base_url}/api/runs", method="POST")
        with self.assertRaises(HTTPError) as captured_error:
            urlopen(request)  # noqa: S310 - 固定本地测试服务
        self.assertEqual(captured_error.exception.code, 501)
        payload = json.load(captured_error.exception)
        self.assertEqual(payload["code"], "ORFS_NOT_CONNECTED")

    def test_static_source_and_configuration_are_not_exposed(self) -> None:
        for resource in ("/%2e%2e/config/server.example.sh", "/api/config", "/api/library/unknown/cells/unknown"):
            with self.assertRaises(HTTPError) as captured_error:
                urlopen(f"{self.base_url}{resource}")
            self.assertIn(captured_error.exception.code, (400, 404))

    def test_environment_summary_does_not_expose_server_paths(self) -> None:
        with urlopen(f"{self.base_url}/api/environment") as response:
            serialized = response.read().decode("utf-8")
        self.assertNotIn(str(self.config.source), serialized)
        self.assertNotIn(str(self.config.path("paths.orfs_root")), serialized)
        self.assertFalse(json.loads(serialized)["flow_execution_verified"])

    def test_missing_asset_returns_503_without_disclosing_file_paths(self) -> None:
        cell = self.config.get("pdks.sky130hd.cells")[0]["name"]
        with self.assertRaises(HTTPError) as captured_error:
            urlopen(f"{self.base_url}/api/library/sky130hd/cells/{cell}")
        self.assertEqual(captured_error.exception.code, 503)
        self.assertNotIn(str(self.config.path("pdks.sky130hd.cell_lef")), captured_error.exception.read().decode("utf-8"))


if __name__ == "__main__":
    unittest.main()
