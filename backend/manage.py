"""以同一个配置执行只读检查、工艺库读取和部署模板渲染。"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from backend.configuration import ConfigurationError, ServerConfiguration, load_configuration
from backend.environment import inspect_environment
from backend.library import LibraryStore, LibraryUnavailable


def render_service(config: ServerConfiguration) -> str:
    """从唯一配置渲染 systemd 参数；只生成文本，不修改系统或启动服务。"""
    user = config.get("deployment.service_user")
    if not user or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.-]*\$?", user):
        raise ConfigurationError("先填写 deployment.service_user，再生成 systemd 文件")
    executable = config.tool("python")
    if not executable or not executable.is_file():
        raise ConfigurationError("tools.python.executable 不可读，无法生成 systemd 文件")

    def quoted(value: str) -> str:
        # systemd 对 % 进行 specifier 展开；配置中的普通字符应按字面保留。
        return json.dumps(value.replace("%", "%%"), ensure_ascii=False)

    replacements = {
        "{{service_user}}": user,
        "{{project_root}}": quoted(str(config.path("paths.project_root"))),
        "{{python_executable}}": quoted(str(executable)),
        "{{app_script}}": quoted(str(config.path("deployment.app_script"))),
        "{{config_file}}": quoted(str(config.source)),
    }
    template = config.path("paths.service_template").read_text(encoding="utf-8")
    for token, value in replacements.items():
        template = template.replace(token, value)
    if "{{" in template:
        raise ConfigurationError("systemd 模板存在未知占位符")
    return template


def main() -> None:
    parser = argparse.ArgumentParser(description="DeviceLayoutLab 环境与库管理")
    parser.add_argument("--config", type=Path, required=True, help="唯一配置文件，路径以其目录为基准")
    commands = parser.add_subparsers(dest="command", required=True)
    doctor = commands.add_parser("doctor", help="只读检查已登记路径，按需运行工具版本查询")
    doctor.add_argument("--probe-tools", action="store_true", help="执行配置中的版本查询，绝不启动设计流程")
    doctor.add_argument("--write-report", action="store_true", help="保存到配置的 paths.environment_report")
    library = commands.add_parser("library", help="读取登记的真实单元 LEF/Liberty，不运行外部工具")
    library.add_argument("--pdk", required=True, help="已登记的工艺 ID")
    library.add_argument("--write-report", action="store_true", help="保存到配置的 paths.library_index")
    service = commands.add_parser("render-service", help="渲染 systemd 单元，不安装或启动")
    service.add_argument("--write", action="store_true", help="保存到配置的 paths.service_unit")
    arguments = parser.parse_args()
    try:
        config = load_configuration(arguments.config)
        if arguments.command == "doctor":
            result = inspect_environment(config, arguments.probe_tools)
            output_key = "paths.environment_report" if arguments.write_report else None
        elif arguments.command == "library":
            registrations = config.get("pdks")
            if arguments.pdk not in registrations:
                raise ConfigurationError(f"工艺未登记：{arguments.pdk}")
            store = LibraryStore(config)
            result = {"pdk_id": arguments.pdk, "cells": [store.cell(arguments.pdk, cell["name"]) for cell in registrations[arguments.pdk]["cells"]]}
            output_key = "paths.library_index" if arguments.write_report else None
        else:
            result = render_service(config)
            output_key = "paths.service_unit" if arguments.write else None
        serialized = result if isinstance(result, str) else json.dumps(result, ensure_ascii=False, indent=2)
        if output_key:
            destination = config.path(output_key)
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(serialized + "\n", encoding="utf-8")
            print(f"已写入配置指定位置：{destination}")
        else:
            print(serialized)
        if arguments.command == "doctor" and not result["input_paths_ready"]:
            parser.exit(1)
    except (ConfigurationError, LibraryUnavailable, OSError, ValueError) as error:
        parser.exit(2, f"检查失败：{error}\n")


if __name__ == "__main__":
    main()
