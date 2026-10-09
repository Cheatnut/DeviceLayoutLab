"""验证 source 导出的配置缺项、路径安全和 systemd 启动参数。"""

import tempfile
import unittest
from pathlib import Path

from backend.configuration import ConfigurationError, load_configuration
from backend.manage import render_service
from helpers import temporary_directory, test_environment


class ConfigurationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = temporary_directory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.environment = test_environment(self.root)

    def test_all_paths_follow_the_exported_roots(self) -> None:
        moved = self.root / "moved orfs"
        self.environment.update({"DLL_ORFS_ROOT": str(moved), "DLL_FLOW_HOME": str(moved / "flow"),
                                 "DLL_PLATFORMS_ROOT": str(moved / "flow" / "platforms"),
                                 "DLL_PDK_ROOT": str(moved / "flow" / "platforms" / "sky130hd"),
                                 "DLL_PDK_CELL_LEF": str(moved / "flow" / "platforms" / "sky130hd" / "cells.lef"),
                                 "DLL_OPENROAD": str(moved / "bin" / "openroad"),
                                 "DLL_RUNTIME_ROOT": str(self.root / "runtime2"),
                                 "DLL_JOBS_ROOT": str(self.root / "runtime2" / "jobs"),
                                 "DLL_REPORTS_ROOT": str(self.root / "runtime2" / "reports"),
                                 "DLL_LOGS_ROOT": str(self.root / "runtime2" / "logs"),
                                 "DLL_EXPORTS_ROOT": str(self.root / "runtime2" / "exports")})
        config = load_configuration(self.environment)
        self.assertEqual(config.path("paths.orfs_root"), moved)
        self.assertEqual(config.tool("openroad"), moved / "bin" / "openroad")
        self.assertEqual(config.path("pdks.sky130hd.root"), moved / "flow" / "platforms" / "sky130hd")

    def test_output_cannot_overlap_protected_sources(self) -> None:
        for bad_path in (str(self.root / "orfs" / "results"),
                         str(Path(self.environment["DLL_FRONTEND_ROOT"]) / "cache"),
                         self.environment["DLL_PROJECT_ROOT"]):
            env = dict(self.environment)
            env.update({"DLL_RUNTIME_ROOT": bad_path, "DLL_JOBS_ROOT": bad_path + "/jobs",
                        "DLL_REPORTS_ROOT": bad_path + "/reports", "DLL_LOGS_ROOT": bad_path + "/logs",
                        "DLL_EXPORTS_ROOT": bad_path + "/exports"})
            with self.assertRaises(ConfigurationError):
                load_configuration(env)

    def test_required_values_and_numeric_ranges_are_checked(self) -> None:
        missing = dict(self.environment)
        missing.pop("DLL_ORFS_ROOT")
        with self.assertRaises(ConfigurationError):
            load_configuration(missing)
        for port in ("-1", "65536", "not-a-number"):
            env = dict(self.environment, DLL_PORT=port)
            with self.assertRaises(ConfigurationError):
                load_configuration(env)

    def test_cell_registry_rejects_malformed_or_duplicate_lines(self) -> None:
        for entries in ("bad line", "demo|one|first\ndemo|two|second"):
            env = dict(self.environment, DLL_PDK_CELLS=entries)
            with self.assertRaises(ConfigurationError):
                load_configuration(env)

    def test_systemd_sources_the_same_local_script(self) -> None:
        env = dict(self.environment, DLL_SERVICE_USER="teaching")
        config = load_configuration(env)
        service = render_service(config)
        self.assertIn("run-with-config.sh", service)
        self.assertIn(json_quote(str(config.source)), service)
        self.assertIn("-m backend.app", service)
        self.assertNotIn("--config", service)
        self.assertNotIn("{{", service)

    def test_tool_entry_preserves_virtual_environment_symlink(self) -> None:
        interpreter = self.root / "venv" / "python"
        interpreter.parent.mkdir()
        try:
            interpreter.symlink_to(self.environment["DLL_PYTHON"])
        except OSError:
            self.skipTest("当前平台不允许创建测试符号链接")
        config = load_configuration(dict(self.environment, DLL_PYTHON=str(interpreter)))
        self.assertEqual(config.tool("python"), interpreter)


def json_quote(value: str) -> str:
    import json
    return json.dumps(value.replace("%", "%%"), ensure_ascii=False)
