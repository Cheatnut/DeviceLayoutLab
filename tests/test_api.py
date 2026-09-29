"""无需 ORFS 环境即可运行的服务与案例契约测试。"""

import importlib.util
import json
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


PROJECT_ROOT = Path(__file__).resolve().parents[1]
APP_PATH = PROJECT_ROOT / "backend" / "app.py"
SPEC = importlib.util.spec_from_file_location("device_layout_lab_app", APP_PATH)
APP = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(APP)


class CaseCatalogTest(unittest.TestCase):
    def test_catalog_has_unique_stable_ids(self) -> None:
        catalog = APP.load_case_catalog()
        case_ids = [case["id"] for case in catalog["cases"]]
        self.assertEqual(len(case_ids), len(set(case_ids)))

    def test_ready_teaching_case_has_selectable_entities(self) -> None:
        teaching_case = APP.find_case("sky130-teaching-cells")
        self.assertIsNotNone(teaching_case)
        self.assertEqual(teaching_case["availability"], "ready")
        self.assertGreater(len(teaching_case["entities"]), 0)
        entity_ids = [entity["id"] for entity in teaching_case["entities"]]
        self.assertEqual(len(entity_ids), len(set(entity_ids)))

    def test_catalog_is_valid_json(self) -> None:
        with APP.CASES_PATH.open(encoding="utf-8") as case_file:
            self.assertIsInstance(json.load(case_file), dict)


class HttpContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        """在随机本地端口启动服务，避免依赖开发者手动启动的进程。"""
        cls.server = APP.create_server("127.0.0.1", 0)
        cls.base_url = f"http://127.0.0.1:{cls.server.server_port}"
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

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


if __name__ == "__main__":
    unittest.main()
