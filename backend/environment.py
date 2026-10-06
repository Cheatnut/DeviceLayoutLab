"""对已登记的工具和工艺文件进行只读核验，不启动设计流程。"""

from __future__ import annotations

import os
import platform
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.configuration import PDK_FILE_KEYS, PDK_LIST_KEYS, ServerConfiguration


def inspect_environment(config: ServerConfiguration, probe_tools: bool = False) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []
    for key, expected_kind in (("paths.orfs_root", "directory"), ("paths.flow_home", "directory"),
                               ("orfs.makefile", "file"), ("orfs.scripts_dir", "directory"), ("orfs.utils_dir", "directory")):
        path = config.path(key)
        exists = path.is_dir() if expected_kind == "directory" else path.is_file()
        checks.append({"key": key, "path": str(path), "status": "ok" if exists else "missing", "kind": expected_kind})

    tool_checks: dict[str, Any] = {}
    for name in config.get("tools"):
        executable = config.tool(name)
        item: dict[str, Any] = {"status": "unconfigured", "version": None}
        if config.get(f"tools.{name}.executable"):
            item = {"status": "missing", "path": str(executable) if executable else None, "version": None}
            if executable and executable.is_file():
                item["status"] = "ok" if os.access(executable, os.X_OK) else "not_executable"
                if probe_tools and item["status"] == "ok":
                    try:
                        # 明确参数数组和超时，不接受网页命令、不执行 shell，也不 source env.sh。
                        result = subprocess.run(
                            [str(executable), *config.get(f"tools.{name}.version_args")],
                            capture_output=True, text=True, errors="replace", check=False,
                            timeout=config.get("orfs.probe_timeout_seconds"), env=config.subprocess_environment(),
                        )
                        output = (result.stdout + result.stderr).strip()
                        item.update({"returncode": result.returncode, "version": output.splitlines()[0] if output else None})
                        if result.returncode != 0 or not output:
                            item["status"] = "probe_failed"
                        if result.returncode != 0:
                            item["diagnostic"] = output[:2000]
                    except (OSError, subprocess.TimeoutExpired) as error:
                        item.update({"status": "probe_failed", "diagnostic": str(error)})
        tool_checks[name] = item

    pdk_checks: dict[str, Any] = {}
    for pdk_id, pdk in config.get("pdks").items():
        files: dict[str, Any] = {}
        for field in (*PDK_FILE_KEYS, *PDK_LIST_KEYS):
            paths = pdk[field] if isinstance(pdk[field], list) else [pdk[field]]
            files[field] = [{"path": path, "status": "ok" if Path(path).is_file() else "missing"} for path in paths]
        pdk_checks[pdk_id] = {
            "title": pdk["title"], "files": files,
            "abstract_readable": Path(pdk["cell_lef"]).is_file(),
            "electrical_readable": bool(pdk["liberty"]) and all(Path(path).is_file() for path in pdk["liberty"]),
        }

    required_tools = ("python", "make", "openroad", "yosys", "klayout")
    ready = platform.system() == "Linux" and all(check["status"] == "ok" for check in checks)
    ready = ready and all(tool_checks[name]["status"] == "ok" for name in required_tools)
    ready = ready and all(pdk["abstract_readable"] and pdk["electrical_readable"] for pdk in pdk_checks.values())
    ready = ready and all(item["status"] == "ok" for pdk in pdk_checks.values() for items in pdk["files"].values() for item in items)
    return {
        "checked_at": datetime.now(timezone.utc).isoformat(), "system": platform.system(),
        "config_file": str(config.source), "checks": checks, "tools": tool_checks, "pdks": pdk_checks,
        "version_queries_executed": probe_tools, "input_paths_ready": ready,
        "flow_execution_verified": False,
        "note": "路径与版本检查不等于 ORFS 流程、规则或三维几何验收。",
    }


def public_environment(config: ServerConfiguration) -> dict[str, Any]:
    """网页只接收能力摘要，服务器路径和版本查询错误留在本机检查报告。"""
    report = inspect_environment(config)
    return {
        "system": report["system"],
        "input_paths_ready": report["input_paths_ready"],
        "flow_execution_verified": False,
        "tools": {name: {"status": item["status"]} for name, item in report["tools"].items()},
        "pdks": {name: {"title": item["title"], "abstract_readable": item["abstract_readable"],
                        "electrical_readable": item["electrical_readable"]} for name, item in report["pdks"].items()},
    }
