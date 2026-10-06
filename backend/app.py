"""DeviceLayoutLab 的最小独立教学服务。

本服务只提供首个开发切片所需的静态网页和只读案例 API。ORFS 尚未接入：
任何运行请求都会返回明确的未接入状态，避免把教学示意误写成工具结果。
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import sys
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlsplit


if __package__ in {None, ""}:
    # 仅由当前源文件定位 Python 包，部署资源与工具路径均由唯一配置提供。
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.configuration import ConfigurationError, ServerConfiguration, load_configuration
from backend.environment import public_environment
from backend.library import LibraryStore, LibraryUnavailable


def load_case_catalog(config: ServerConfiguration) -> dict[str, Any]:
    """加载版本化案例数据，并在启动时给出可读的格式错误。"""
    with config.path("paths.case_catalog").open(encoding="utf-8") as case_file:
        catalog = json.load(case_file)
    if not isinstance(catalog.get("cases"), list):
        raise ValueError("cases.json 缺少 cases 列表")
    return catalog


def find_case(config: ServerConfiguration, case_id: str) -> dict[str, Any] | None:
    """按稳定案例 ID 查询案例；前端不能用展示标题作为身份。"""
    for case in load_case_catalog(config)["cases"]:
        if case.get("id") == case_id:
            return case
    return None


class TeachingRequestHandler(BaseHTTPRequestHandler):
    """限定为项目网页和教学 API 的请求处理器。"""

    server_version = "DeviceLayoutLab/0.1"

    @property
    def config(self) -> ServerConfiguration:
        return self.server.configuration

    def do_GET(self) -> None:  # noqa: N802 - HTTP 标准方法名
        request_path = urlsplit(self.path).path
        if request_path == "/api/health":
            self._send_json({"status": "ok", "service": "device-layout-lab"})
            return
        if request_path == "/api/cases":
            self._send_json(load_case_catalog(self.config))
            return
        if request_path == "/api/environment":
            self._send_json(public_environment(self.config))
            return
        if request_path == "/api/library/pdks":
            self._send_json({"pdks": self.server.library.catalog()})
            return
        if request_path.startswith("/api/library/"):
            self._send_library(request_path)
            return
        if request_path.startswith("/api/cases/"):
            case_id = unquote(request_path.removeprefix("/api/cases/"))
            case = find_case(self.config, case_id)
            if case is None:
                self._send_json({"error": "案例不存在", "caseId": case_id}, HTTPStatus.NOT_FOUND)
                return
            self._send_json(case)
            return
        self._send_static(request_path)

    def _send_library(self, request_path: str) -> None:
        segments = request_path.split("/")
        if len(segments) != 6 or segments[4] != "cells":
            self._send_json({"error": "接口不存在"}, HTTPStatus.NOT_FOUND)
            return
        try:
            cell = self.server.library.cell(unquote(segments[3]), unquote(segments[5]))
            self._send_json(cell)
        except KeyError:
            self._send_json({"error": "工艺或单元未登记"}, HTTPStatus.NOT_FOUND)
        except (LibraryUnavailable, OSError, UnicodeError):
            self._send_json({"error": "登记的工艺资产暂不可读，请在服务器执行环境检查。"}, HTTPStatus.SERVICE_UNAVAILABLE)

    def do_POST(self) -> None:  # noqa: N802 - HTTP 标准方法名
        if urlsplit(self.path).path != "/api/runs":
            self._send_json({"error": "接口不存在"}, HTTPStatus.NOT_FOUND)
            return
        self._send_json(
            {
                "code": "ORFS_NOT_CONNECTED",
                "message": "ORFS 适配器尚未完成 Linux 环境核验，当前不能提交真实运行。",
            },
            HTTPStatus.NOT_IMPLEMENTED,
        )

    def _send_static(self, request_path: str) -> None:
        """仅在 frontend 根目录内查找资源，拒绝路径穿越。"""
        relative_path = "index.html" if request_path in {"", "/"} else unquote(request_path).lstrip("/")
        frontend_root = self.config.path("paths.frontend_root")
        candidate = (frontend_root / relative_path).resolve()
        try:
            candidate.relative_to(frontend_root)
        except ValueError:
            self._send_json({"error": "无效资源路径"}, HTTPStatus.BAD_REQUEST)
            return
        if not candidate.is_file():
            self._send_json({"error": "资源不存在"}, HTTPStatus.NOT_FOUND)
            return
        content_type, _ = mimetypes.guess_type(candidate.name)
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type or "application/octet-stream")
        self.send_header("Content-Length", str(candidate.stat().st_size))
        self.end_headers()
        with candidate.open("rb") as static_file:
            self.wfile.write(static_file.read())

    def _send_json(self, payload: Any, status: HTTPStatus = HTTPStatus.OK) -> None:
        encoded_payload = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded_payload)))
        self.end_headers()
        self.wfile.write(encoded_payload)

    def log_message(self, message_format: str, *args: Any) -> None:
        """保留开发期访问日志；生产日志策略在部署时另行配置。"""
        super().log_message(message_format, *args)


def create_server(config: ServerConfiguration) -> ThreadingHTTPServer:
    """创建可供测试和命令行复用的 HTTP 服务。"""
    # 启动前核验基础案例，避免服务健康却无法读取核心资料。
    load_case_catalog(config)
    server = ThreadingHTTPServer((config.get("server.host"), config.get("server.port")), TeachingRequestHandler)
    server.configuration = config
    server.library = LibraryStore(config)
    return server


def main() -> None:
    parser = argparse.ArgumentParser(description="运行 DeviceLayoutLab 教学服务")
    parser.add_argument("--config", required=True, type=Path, help="唯一服务器配置文件")
    arguments = parser.parse_args()
    try:
        config = load_configuration(arguments.config)
        server = create_server(config)
    except (ConfigurationError, OSError, ValueError) as error:
        parser.exit(2, f"启动失败：{error}\n")
    print(f"DeviceLayoutLab 服务已监听 http://{config.get('server.host')}:{server.server_port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("服务已停止")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
