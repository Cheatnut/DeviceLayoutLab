"""验证路径引用、部署迁移与只读源隔离等具有实际风险的边界。"""

import json
import tempfile
import unittest
from pathlib import Path

from backend.configuration import ConfigurationError, load_configuration
from backend.manage import render_service
from helpers import test_document, write_test_configuration


class ConfigurationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def test_relative_paths_follow_config_file_and_references_follow_parent(self) -> None:
        document = test_document(self.root)
        document["paths"]["project_root"] = ".."
        document["paths"]["orfs_root"] = "${paths.project_root}/../external-orfs"
        document["paths"]["runtime_root"] = "${paths.project_root}/generated"
        config = load_configuration(write_test_configuration(self.root, document))
        self.assertEqual(config.path("paths.project_root"), self.root.resolve())
        self.assertEqual(config.path("paths.orfs_root"), (self.root.parent / "external-orfs").resolve())
        self.assertEqual(config.path("pdks.sky130hd.tech_lef"), config.path("paths.orfs_root") / "flow/platforms/sky130hd/lef/sky130_fd_sc_hd.tlef")

    def test_one_root_change_updates_tool_and_pdk_paths(self) -> None:
        document = test_document(self.root)
        document["paths"]["orfs_root"] = str(self.root / "moved orfs")
        config = load_configuration(write_test_configuration(self.root, document))
        self.assertEqual(config.tool("yosys"), self.root / "moved orfs/tools/install/yosys/bin/yosys")
        self.assertEqual(config.path("pdks.sky130hd.root"), self.root / "moved orfs/flow/platforms/sky130hd")

    def test_cycle_and_missing_reference_fail_before_service_start(self) -> None:
        for reference in ("${paths.flow_home}", "${paths.unknown}"):
            document = test_document(self.root)
            document["paths"]["orfs_root"] = reference
            with self.assertRaises(ConfigurationError):
                load_configuration(write_test_configuration(self.root, document))

    def test_output_cannot_overlap_orfs_pdk_or_source(self) -> None:
        for path in ("${paths.orfs_root}/results", "${pdks.sky130hd.root}/cache", "${paths.frontend_root}/cache", "${paths.project_root}"):
            document = test_document(self.root)
            document["paths"]["runtime_root"] = path
            with self.assertRaises(ConfigurationError):
                load_configuration(write_test_configuration(self.root, document))

    def test_generated_report_cannot_escape_output_root(self) -> None:
        document = test_document(self.root)
        document["paths"]["environment_report"] = "${paths.reports_root}/../../escape.json"
        with self.assertRaises(ConfigurationError):
            load_configuration(write_test_configuration(self.root, document))

    def test_boolean_and_out_of_range_ports_are_rejected(self) -> None:
        for port in (True, -1, 65536, "8080"):
            document = test_document(self.root)
            document["server"]["port"] = port
            with self.assertRaises(ConfigurationError):
                load_configuration(write_test_configuration(self.root, document))

    def test_missing_required_path_does_not_use_implicit_fallback(self) -> None:
        document = test_document(self.root)
        del document["paths"]["orfs_root"]
        with self.assertRaises(ConfigurationError):
            load_configuration(write_test_configuration(self.root, document))

    def test_utf8_bom_configuration_and_explicit_systemd_paths(self) -> None:
        document = test_document(self.root)
        document["deployment"]["service_user"] = "teaching"
        path = write_test_configuration(self.root, document)
        path.write_text(json.dumps(document), encoding="utf-8-sig")
        config = load_configuration(path)
        service = render_service(config)
        self.assertIn(f'--config "{str(path.resolve()).replace(chr(92), chr(92) * 2)}"', service)
        self.assertNotIn("--port", service)
        self.assertNotIn("{{", service)

    def test_tool_entry_preserves_virtual_environment_symlink(self) -> None:
        document = test_document(self.root)
        interpreter = self.root / "venv" / "python"
        interpreter.parent.mkdir()
        try:
            interpreter.symlink_to(Path(document["tools"]["python"]["executable"]))
        except OSError:
            self.skipTest("当前平台不允许创建测试符号链接")
        document["tools"]["python"]["executable"] = str(interpreter)
        config = load_configuration(write_test_configuration(self.root, document))
        self.assertEqual(config.tool("python"), interpreter)
