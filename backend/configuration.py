"""读取唯一 shell 配置导出的环境变量并检查路径隔离。"""

from __future__ import annotations

import os
import re
import shlex
import shutil
from pathlib import Path
from typing import Any, Mapping


class ConfigurationError(ValueError):
    """配置缺项或不满足安全约束时，在启动前给出清晰错误。"""


GENERATED_ROOTS = ("runtime_root", "jobs_root", "reports_root", "logs_root", "exports_root")
PDK_FILE_KEYS = ("platform_config", "tech_lef", "cell_lef", "klayout_tech", "layer_properties", "tapcell_script")
PDK_LIST_KEYS = ("liberty", "gds", "cdl")


def _required(env: Mapping[str, str], name: str) -> str:
    value = env.get(name, "").strip()
    if not value:
        raise ConfigurationError(f"缺少环境变量 {name}；请先 source config/server.local.sh")
    return value


def _lines(value: str) -> list[str]:
    return [item.strip() for item in value.splitlines() if item.strip()]


def _cells(value: str) -> list[dict[str, str]]:
    result = []
    for line in _lines(value):
        parts = [part.strip() for part in line.split("|", 2)]
        if len(parts) != 3 or not all(parts):
            raise ConfigurationError("DLL_PDK_CELLS 每行必须是 name|role|evidence")
        result.append(dict(zip(("name", "role", "evidence"), parts)))
    return result


class ServerConfiguration:
    """以 source 脚本导出的 DLL_* 变量构造运行期配置。"""

    def __init__(self, env: Mapping[str, str] | None = None):
        environment = os.environ if env is None else env
        project_root = Path(_required(environment, "DLL_PROJECT_ROOT")).expanduser().resolve()
        orfs_root = Path(_required(environment, "DLL_ORFS_ROOT")).expanduser().resolve()
        flow_home = Path(_required(environment, "DLL_FLOW_HOME")).expanduser().resolve()
        platforms_root = Path(_required(environment, "DLL_PLATFORMS_ROOT")).expanduser().resolve()
        pdk_root = Path(_required(environment, "DLL_PDK_ROOT")).expanduser().resolve()
        runtime_root = Path(_required(environment, "DLL_RUNTIME_ROOT")).expanduser().resolve()
        jobs_root = Path(_required(environment, "DLL_JOBS_ROOT")).expanduser().resolve()
        reports_root = Path(_required(environment, "DLL_REPORTS_ROOT")).expanduser().resolve()
        logs_root = Path(_required(environment, "DLL_LOGS_ROOT")).expanduser().resolve()
        exports_root = Path(_required(environment, "DLL_EXPORTS_ROOT")).expanduser().resolve()

        pdk_id = _required(environment, "DLL_PDK_ID")
        if not re.fullmatch(r"[A-Za-z0-9_-]+", pdk_id):
            raise ConfigurationError("DLL_PDK_ID 只能包含英文字母、数字、下划线和连字符")

        def pdk_path(name: str) -> str:
            return str(Path(_required(environment, name)).expanduser().resolve())

        def tool(name: str, default_args: str = "--version") -> dict[str, Any]:
            executable = environment.get(f"DLL_{name.upper()}", "").strip()
            try:
                args = shlex.split(environment.get(f"DLL_{name.upper()}_VERSION_ARGS", default_args))
            except ValueError as error:
                raise ConfigurationError(f"DLL_{name.upper()}_VERSION_ARGS 格式错误：{error}") from error
            return {"executable": executable, "version_args": args}

        source = Path(_required(environment, "DLL_CONFIG_SCRIPT")).expanduser().resolve()
        pdk = {
            "title": _required(environment, "DLL_PDK_TITLE"),
            "device_family": _required(environment, "DLL_PDK_DEVICE_FAMILY"),
            "platform_name": _required(environment, "DLL_PDK_PLATFORM_NAME"),
            "root": str(pdk_root),
            "platform_config": pdk_path("DLL_PDK_PLATFORM_CONFIG"),
            "tech_lef": pdk_path("DLL_PDK_TECH_LEF"),
            "cell_lef": pdk_path("DLL_PDK_CELL_LEF"),
            "liberty": [str(Path(item).expanduser().resolve()) for item in _lines(_required(environment, "DLL_PDK_LIBERTY"))],
            "gds": [str(Path(item).expanduser().resolve()) for item in _lines(_required(environment, "DLL_PDK_GDS"))],
            "cdl": [str(Path(item).expanduser().resolve()) for item in _lines(_required(environment, "DLL_PDK_CDL"))],
            "klayout_tech": pdk_path("DLL_PDK_KLAYOUT_TECH"),
            "layer_properties": pdk_path("DLL_PDK_LAYER_PROPERTIES"),
            "tapcell_script": pdk_path("DLL_PDK_TAPCELL_SCRIPT"),
            "cells": _cells(_required(environment, "DLL_PDK_CELLS")),
        }
        path_values = {
            "project_root": str(project_root),
            "frontend_root": str(Path(_required(environment, "DLL_FRONTEND_ROOT")).expanduser().resolve()),
            "case_catalog": str(Path(_required(environment, "DLL_CASE_CATALOG")).expanduser().resolve()),
            "runtime_root": str(runtime_root), "jobs_root": str(jobs_root), "reports_root": str(reports_root),
            "logs_root": str(logs_root), "exports_root": str(exports_root),
            "environment_report": str(reports_root / "environment.json"),
            "library_index": str(reports_root / "library.json"),
            "service_unit": str(exports_root / "device-layout-lab.service"),
            "orfs_root": str(orfs_root), "flow_home": str(flow_home), "platforms_root": str(platforms_root),
            "pdk_root": str(pdk_root),
            "service_template": str(Path(_required(environment, "DLL_SERVICE_TEMPLATE")).expanduser().resolve()),
        }
        self.source = source
        self.raw: dict[str, Any] = {
            "schema_version": 1,
            "paths": path_values,
            "server": {"host": _required(environment, "DLL_HOST"), "port": self._int(environment, "DLL_PORT")},
            "tools": {
                "python": tool("python", "--version"), "make": tool("make"),
                "openroad": tool("openroad", "-version"), "yosys": tool("yosys", "-V"),
                "klayout": tool("klayout", "-v"), "blender": tool("blender"),
            },
            "environment": {
                "variables": {"QT_QPA_PLATFORM": environment.get("DLL_QT_QPA_PLATFORM", "offscreen")},
                "executable_paths": self._path_list(environment.get("DLL_EXECUTABLE_PATHS", "")),
                "library_paths": self._path_list(environment.get("DLL_LIBRARY_PATHS", "")),
            },
            "orfs": {
                "makefile": str(flow_home / "Makefile"), "scripts_dir": str(flow_home / "scripts"),
                "utils_dir": str(flow_home / "util"),
                "probe_timeout_seconds": self._int(environment, "DLL_PROBE_TIMEOUT_SECONDS"),
                "worker_count": self._int(environment, "DLL_WORKER_COUNT"),
                "threads_per_run": self._int(environment, "DLL_THREADS_PER_RUN"),
                "job_timeout_seconds": self._int(environment, "DLL_JOB_TIMEOUT_SECONDS"),
            },
            "deployment": {
                "service_user": environment.get("DLL_SERVICE_USER", ""),
                "app_script": str(project_root / "backend" / "app.py"),
                "launcher": str(project_root / "deploy" / "run-with-config.sh"),
                "shell": _required(environment, "DLL_BASH"),
            },
            "pdks": {pdk_id: pdk},
        }
        self._validate()

    @staticmethod
    def _int(env: Mapping[str, str], name: str) -> int:
        value = _required(env, name)
        try:
            return int(value)
        except ValueError as error:
            raise ConfigurationError(f"{name} 必须是整数") from error

    @staticmethod
    def _path_list(value: str) -> list[str]:
        return [str(Path(item).expanduser().resolve()) for item in value.split(os.pathsep) if item]

    def get(self, key: str) -> Any:
        value: Any = self.raw
        for part in key.split("."):
            if not isinstance(value, dict) or part not in value:
                raise ConfigurationError(f"配置字段不存在：{key}")
            value = value[part]
        return value

    def path(self, key: str) -> Path:
        value = self.get(key)
        if not isinstance(value, str) or not value:
            raise ConfigurationError(f"字段不是路径：{key}")
        return Path(value)

    def tool(self, name: str) -> Path | None:
        """按脚本提供的入口定位工具；裸命令只使用继承到的 PATH。"""
        executable = self.get(f"tools.{name}.executable")
        if not executable:
            return None
        if "/" in executable or "\\" in executable:
            path = Path(executable).expanduser()
            return Path(os.path.abspath(path))
        located = shutil.which(executable, path=self.subprocess_environment().get("PATH"))
        return Path(os.path.abspath(located)) if located else None

    def subprocess_environment(self) -> dict[str, str]:
        environment = dict(os.environ)
        environment.update(self.get("environment.variables"))
        for field, variable in (("executable_paths", "PATH"), ("library_paths", "LD_LIBRARY_PATH")):
            entries = self.get(f"environment.{field}")
            if entries:
                environment[variable] = os.pathsep.join([*entries, environment.get(variable, "")]).rstrip(os.pathsep)
        return environment

    def _validate(self) -> None:
        if not self.get("server.host").strip() or any(char.isspace() for char in self.get("server.host")):
            raise ConfigurationError("DLL_HOST 必须为非空主机或监听地址")
        port = self.get("server.port")
        if not 0 <= port <= 65535:
            raise ConfigurationError("DLL_PORT 必须在 0–65535 范围内")
        for field in ("probe_timeout_seconds", "worker_count", "threads_per_run", "job_timeout_seconds"):
            if self.get(f"orfs.{field}") <= 0:
                raise ConfigurationError(f"orfs.{field} 必须为正整数")
        for name in ("python", "make", "openroad", "yosys", "klayout", "blender"):
            entry = self.get(f"tools.{name}")
            if not isinstance(entry["executable"], str) or not all(isinstance(arg, str) for arg in entry["version_args"]):
                raise ConfigurationError(f"tools.{name} 工具入口或版本参数无效")
        pdks = self.get("pdks")
        pdk_id, pdk = next(iter(pdks.items()))
        if not pdk["cells"]:
            raise ConfigurationError(f"DLL_PDK_CELLS 未登记任何单元：{pdk_id}")
        names: set[str] = set()
        for cell in pdk["cells"]:
            if cell["name"] in names:
                raise ConfigurationError(f"单元重复登记：{pdk_id}/{cell['name']}")
            names.add(cell["name"])
        self._validate_output_isolation()
        for file_key, root_key in (("environment_report", "reports_root"), ("library_index", "reports_root"),
                                   ("service_unit", "exports_root")):
            output, root = self.path(f"paths.{file_key}"), self.path(f"paths.{root_key}")
            if output == root or not output.is_relative_to(root):
                raise ConfigurationError(f"paths.{file_key} 必须位于 paths.{root_key} 内")

    def _validate_output_isolation(self) -> None:
        protected = [self.path("paths.orfs_root"), self.path("paths.pdk_root"), self.path("paths.frontend_root"),
                     self.path("paths.case_catalog").parent, self.source.parent,
                     self.path("paths.service_template").parent]
        protected.extend(Path(pdk[field]) for pdk in self.get("pdks").values() for field in PDK_FILE_KEYS)
        protected.extend(Path(item) for pdk in self.get("pdks").values() for field in PDK_LIST_KEYS for item in pdk[field])
        project = self.path("paths.project_root")
        for key in GENERATED_ROOTS:
            output = self.path(f"paths.{key}")
            if project == output or project.is_relative_to(output):
                raise ConfigurationError(f"输出目录不能覆盖项目根目录：paths.{key}")
            for source in protected:
                if output == source or output.is_relative_to(source) or source.is_relative_to(output):
                    raise ConfigurationError(f"生成目录与只读源重叠：paths.{key}")


def load_configuration(env: Mapping[str, str] | None = None) -> ServerConfiguration:
    return ServerConfiguration(env)
