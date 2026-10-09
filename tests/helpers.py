"""使用隔离环境变量构建服务配置，不访问开发者机器上的 ORFS。"""

import sys
import tempfile
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def temporary_directory() -> tempfile.TemporaryDirectory[str]:
    """将测试临时文件放在工作区内，兼容受限 Windows 沙箱。"""
    return tempfile.TemporaryDirectory(dir=PROJECT_ROOT)


def test_environment(root: Path) -> dict[str, str]:
    orfs = root / "orfs"
    flow = orfs / "flow"
    pdk = flow / "platforms" / "sky130hd"
    runtime = root / "output"
    source = root / "config" / "server.local.sh"
    return {
        "DLL_CONFIG_SCRIPT": str(source), "DLL_PROJECT_ROOT": str(PROJECT_ROOT),
        "DLL_ORFS_ROOT": str(orfs), "DLL_FLOW_HOME": str(flow), "DLL_PLATFORMS_ROOT": str(flow / "platforms"),
        "DLL_PDK_ID": "sky130hd", "DLL_PDK_TITLE": "SKY130 HD", "DLL_PDK_DEVICE_FAMILY": "planar",
        "DLL_PDK_PLATFORM_NAME": "sky130hd", "DLL_PDK_ROOT": str(pdk),
        "DLL_PDK_PLATFORM_CONFIG": str(pdk / "config.mk"),
        "DLL_PDK_TECH_LEF": str(pdk / "lef" / "tech.lef"),
        "DLL_PDK_CELL_LEF": str(pdk / "lef" / "cells.lef"),
        "DLL_PDK_LIBERTY": str(pdk / "lib" / "cells.lib"), "DLL_PDK_GDS": str(pdk / "gds" / "cells.gds"),
        "DLL_PDK_CDL": str(pdk / "cdl" / "cells.cdl"), "DLL_PDK_KLAYOUT_TECH": str(pdk / "tech.lyt"),
        "DLL_PDK_LAYER_PROPERTIES": str(pdk / "layers.lyp"), "DLL_PDK_TAPCELL_SCRIPT": str(pdk / "tapcell.tcl"),
        "DLL_PDK_CELLS": "demo_inv|反相器|fixture function",
        "DLL_PYTHON": sys.executable, "DLL_PYTHON_VERSION_ARGS": "--version",
        "DLL_MAKE": "make", "DLL_MAKE_VERSION_ARGS": "--version",
        "DLL_OPENROAD": str(orfs / "bin" / "openroad"), "DLL_OPENROAD_VERSION_ARGS": "-version",
        "DLL_YOSYS": str(orfs / "bin" / "yosys"), "DLL_YOSYS_VERSION_ARGS": "-V",
        "DLL_KLAYOUT": "klayout", "DLL_KLAYOUT_VERSION_ARGS": "-v",
        "DLL_BLENDER": "", "DLL_BLENDER_VERSION_ARGS": "--version",
        "DLL_BASH": "/bin/bash",
        "DLL_HOST": "127.0.0.1", "DLL_PORT": "0", "DLL_RUNTIME_ROOT": str(runtime),
        "DLL_JOBS_ROOT": str(runtime / "jobs"), "DLL_REPORTS_ROOT": str(runtime / "reports"),
        "DLL_LOGS_ROOT": str(runtime / "logs"), "DLL_EXPORTS_ROOT": str(runtime / "exports"),
        "DLL_FRONTEND_ROOT": str(PROJECT_ROOT / "frontend"),
        "DLL_CASE_CATALOG": str(PROJECT_ROOT / "backend" / "data" / "cases.json"),
        "DLL_SERVICE_TEMPLATE": str(PROJECT_ROOT / "deploy" / "device-layout-lab.service.example"),
        "DLL_PROBE_TIMEOUT_SECONDS": "15", "DLL_WORKER_COUNT": "1", "DLL_THREADS_PER_RUN": "2",
        "DLL_JOB_TIMEOUT_SECONDS": "3600", "DLL_QT_QPA_PLATFORM": "offscreen",
        "DLL_EXECUTABLE_PATHS": "", "DLL_LIBRARY_PATHS": "", "DLL_SERVICE_USER": "",
    }
