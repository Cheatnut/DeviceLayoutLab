"""加载唯一部署配置并解析字段引用。

所有路径在配置文件中登记。相对路径以配置文件所在目录为基准，引用字段的
路径先解析为绝对路径，再拼接后续目录；这样改变根目录不会产生二次相对解析。
不自动扫描用户目录、不叠加环境配置，也不加载第二份配置覆盖当前值。
"""

from __future__ import annotations

import json
import os
import re
import shutil
from pathlib import Path
from typing import Any


class ConfigurationError(ValueError):
    """部署配置无效；启动前返回字段名而不是继续猜测。"""


REFERENCE = re.compile(r"\$\{([A-Za-z0-9_.-]+)\}")
GENERATED_ROOTS = ("runtime_root", "jobs_root", "reports_root", "logs_root", "exports_root")
PDK_FILE_KEYS = ("platform_config", "tech_lef", "cell_lef", "klayout_tech", "layer_properties", "tapcell_script")
PDK_LIST_KEYS = ("liberty", "gds", "cdl")


def _is_path_field(key: str) -> bool:
    parts = key.split(".")
    if parts[0] == "paths":
        return True
    if parts[0] == "pdks" and len(parts) == 3:
        return parts[2] in (*PDK_FILE_KEYS, *PDK_LIST_KEYS, "root")
    return key in {"orfs.makefile", "orfs.scripts_dir", "orfs.utils_dir", "deployment.app_script",
                   "environment.executable_paths", "environment.library_paths"}


class ServerConfiguration:
    def __init__(self, config_path: Path | str):
        self.source = Path(config_path).resolve()
        try:
            # utf-8-sig 兼容服务器及 Windows 编辑器写入的 UTF-8 BOM。
            self.raw = json.loads(self.source.read_text(encoding="utf-8-sig"))
        except (OSError, ValueError) as error:
            raise ConfigurationError(f"无法读取配置：{self.source}：{error}") from error
        if not isinstance(self.raw, dict) or type(self.raw.get("schema_version")) is not int or self.raw.get("schema_version") != 1:
            raise ConfigurationError("schema_version 必须为 1")
        self._cache: dict[str, Any] = {}
        self._resolving: list[str] = []
        self._validate()

    def get(self, key: str) -> Any:
        """解析点分隔字段，检测引用环和指向不存在字段的引用。"""
        if key in self._cache:
            return self._cache[key]
        if key in self._resolving:
            raise ConfigurationError(f"配置引用循环：{' -> '.join([*self._resolving, key])}")
        value: Any = self.raw
        for part in key.split("."):
            if not isinstance(value, dict) or part not in value:
                raise ConfigurationError(f"配置字段不存在：{key}")
            value = value[part]
        self._resolving.append(key)
        try:
            resolved = self._resolve_value(key, value)
            self._cache[key] = resolved
            return resolved
        finally:
            self._resolving.pop()

    def _resolve_value(self, key: str, value: Any) -> Any:
        if isinstance(value, list):
            return [self._resolve_value(key, item) for item in value]
        if isinstance(value, dict):
            return {name: self._resolve_value(f"{key}.{name}", item) for name, item in value.items()}
        if not isinstance(value, str):
            return value

        def replace_reference(match: re.Match[str]) -> str:
            referenced = self.get(match.group(1))
            if not isinstance(referenced, str) or not referenced:
                raise ConfigurationError(f"{key} 引用的字段必须为非空字符串：{match.group(1)}")
            return referenced

        expanded = REFERENCE.sub(replace_reference, value)
        if "${" in expanded:
            raise ConfigurationError(f"字段引用格式无效：{key}")
        if _is_path_field(key):
            if not expanded.strip():
                raise ConfigurationError(f"路径字段不能为空：{key}")
            # 禁止把另一操作系统的绝对路径误解析为本机相对路径。
            if os.name != "nt" and re.match(r"^[A-Za-z]:[\\/]", expanded):
                raise ConfigurationError(f"Linux 配置中不能使用 Windows 盘符：{key}")
            path = Path(expanded).expanduser()
            if not path.is_absolute():
                path = self.source.parent / path
            return str(path.resolve())
        if key.startswith("tools.") and key.endswith(".executable"):
            if expanded and ("/" in expanded or "\\" in expanded):
                if os.name != "nt" and re.match(r"^[A-Za-z]:[\\/]", expanded):
                    raise ConfigurationError(f"Linux 工具入口不能使用 Windows 盘符：{key}")
                path = Path(expanded).expanduser()
                # 工具入口保留符号链接，尤其不能把 venv/bin/python 转成系统 Python。
                return os.path.abspath(path if path.is_absolute() else self.source.parent / path)
        return expanded

    def path(self, key: str) -> Path:
        value = self.get(key)
        if not isinstance(value, str) or not value:
            raise ConfigurationError(f"字段不是路径：{key}")
        return Path(value)

    def tool(self, name: str) -> Path | None:
        """入口有目录时按显式路径读取；裸命令只在配置指定的 PATH 环境中定位。"""
        executable = self.get(f"tools.{name}.executable")
        if not executable:
            return None
        if Path(executable).is_absolute():
            return Path(executable)
        located = shutil.which(executable, path=self.subprocess_environment().get("PATH"))
        return Path(os.path.abspath(located)) if located else None

    def subprocess_environment(self) -> dict[str, str]:
        """只对子进程应用配置，不 source ORFS 脚本或修改系统环境。"""
        environment = dict(os.environ)
        environment.update(self.get("environment.variables"))
        for field, variable in (("executable_paths", "PATH"), ("library_paths", "LD_LIBRARY_PATH")):
            entries = self.get(f"environment.{field}")
            if entries:
                environment[variable] = os.pathsep.join([*entries, environment.get(variable, "")]).rstrip(os.pathsep)
        return environment

    def _validate(self) -> None:
        required_paths = (*GENERATED_ROOTS, "project_root", "frontend_root", "case_catalog", "orfs_root",
                          "flow_home", "platforms_root", "pdk_root", "service_template")
        for key in required_paths:
            if not isinstance(self.get(f"paths.{key}"), str):
                raise ConfigurationError(f"paths.{key} 必须是字符串")
        host, port = self.get("server.host"), self.get("server.port")
        if not isinstance(host, str) or not host.strip() or any(char.isspace() for char in host):
            raise ConfigurationError("server.host 必须为非空主机或监听地址")
        if type(port) is not int or not 0 <= port <= 65535:
            raise ConfigurationError("server.port 必须在 0–65535 范围内；0 用于测试时分配端口")
        for name in ("python", "make", "openroad", "yosys", "klayout", "blender"):
            executable = self.get(f"tools.{name}.executable")
            args = self.get(f"tools.{name}.version_args")
            if not isinstance(executable, str) or not isinstance(args, list) or not all(isinstance(arg, str) for arg in args):
                raise ConfigurationError(f"tools.{name} 必须包含字符串入口和字符串参数列表")
        for field in ("executable_paths", "library_paths"):
            entries = self.get(f"environment.{field}")
            if not isinstance(entries, list) or not all(isinstance(item, str) for item in entries):
                raise ConfigurationError(f"environment.{field} 必须为路径列表")
        variables = self.get("environment.variables")
        if not isinstance(variables, dict) or not all(isinstance(key, str) and isinstance(value, str) for key, value in variables.items()):
            raise ConfigurationError("environment.variables 必须是字符串键值表")
        for field in ("probe_timeout_seconds", "worker_count", "threads_per_run", "job_timeout_seconds"):
            value = self.get(f"orfs.{field}")
            if type(value) is not int or value <= 0:
                raise ConfigurationError(f"orfs.{field} 必须为正整数")
        for field in ("makefile", "scripts_dir", "utils_dir"):
            self.path(f"orfs.{field}")
        self.path("deployment.app_script")
        if not isinstance(self.get("deployment.service_user"), str):
            raise ConfigurationError("deployment.service_user 必须为字符串")
        pdks = self.get("pdks")
        if not isinstance(pdks, dict) or not pdks:
            raise ConfigurationError("pdks 必须至少登记一个工艺配置")
        for pdk_id, pdk in pdks.items():
            if not re.fullmatch(r"[A-Za-z0-9_-]+", pdk_id):
                raise ConfigurationError(f"工艺 ID 无效：{pdk_id}")
            for field in ("title", "device_family", "platform_name", "root", *PDK_FILE_KEYS):
                if not isinstance(pdk.get(field), str) or not pdk[field]:
                    raise ConfigurationError(f"pdks.{pdk_id}.{field} 必须为非空字符串")
            for field in PDK_LIST_KEYS:
                if not isinstance(pdk.get(field), list) or not all(isinstance(item, str) for item in pdk[field]):
                    raise ConfigurationError(f"pdks.{pdk_id}.{field} 必须为路径列表")
            cells = pdk.get("cells")
            if not isinstance(cells, list):
                raise ConfigurationError(f"pdks.{pdk_id}.cells 必须为列表")
            names: set[str] = set()
            for cell in cells:
                if not isinstance(cell, dict) or not all(isinstance(cell.get(key), str) and cell[key] for key in ("name", "role", "evidence")):
                    raise ConfigurationError(f"pdks.{pdk_id}.cells 每项需要 name / role / evidence")
                if cell["name"] in names:
                    raise ConfigurationError(f"单元重复登记：{pdk_id}/{cell['name']}")
                names.add(cell["name"])
        self._validate_output_isolation()
        for file_key, root_key in (("environment_report", "reports_root"), ("library_index", "reports_root"), ("service_unit", "exports_root")):
            output = self.path(f"paths.{file_key}")
            root = self.path(f"paths.{root_key}")
            if output == root or not output.is_relative_to(root):
                raise ConfigurationError(f"paths.{file_key} 必须位于 paths.{root_key} 内")

    def _validate_output_isolation(self) -> None:
        # 输出根与外部工具/PDK、原始静态资料、配置目录均不可重叠；解析符号链接后比较。
        protected = [self.path("paths.orfs_root"), self.path("paths.pdk_root"), self.path("paths.frontend_root"),
                     self.path("paths.case_catalog").parent, self.source.parent, self.path("paths.service_template").parent]
        protected.extend(self.path(f"pdks.{pdk_id}.root") for pdk_id in self.get("pdks"))
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


def load_configuration(config_path: Path | str) -> ServerConfiguration:
    return ServerConfiguration(config_path)
