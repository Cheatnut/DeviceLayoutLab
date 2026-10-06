"""读取配置登记的真实 LEF/Liberty 抽象，保留文件身份与未解析能力。

当前实现是教学所需的有限子集：宏边界、SITE/SYMMETRY、引脚矩形和基本
Liberty 属性。时序表、复杂几何、LVS 和 GDS 器件重建均不在本解析器能力内。
"""

from __future__ import annotations

import hashlib
import re
import threading
from pathlib import Path
from typing import Any

from backend.configuration import ServerConfiguration


NUMBER = r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?"


class LibraryUnavailable(ValueError):
    """登记的资产缺失或本教学读取器无法解析所需结构。"""


def source_identity(path: Path, content: bytes | None = None) -> dict[str, Any]:
    """只对已读取资产计算身份；不向浏览器泄露服务器绝对路径。"""
    content = path.read_bytes() if content is None else content
    return {"file": path.name, "sha256": hashlib.sha256(content).hexdigest(), "bytes": len(content)}


def _statement(text: str, keyword: str) -> str | None:
    match = re.search(rf"\b{re.escape(keyword)}\s+([^;]+);", text)
    return match.group(1).strip() if match else None


def parse_lef_cell(text: str, name: str) -> dict[str, Any] | None:
    match = re.search(rf"^\s*MACRO\s+{re.escape(name)}\s*$([\s\S]*?)^\s*END\s+{re.escape(name)}\s*$", text, re.MULTILINE)
    if not match:
        return None
    body = match.group(1)
    size = re.search(rf"\bSIZE\s+({NUMBER})\s+BY\s+({NUMBER})\s*;", body)
    if not size:
        raise LibraryUnavailable(f"LEF 单元 {name} 缺少可读取的 SIZE")
    pins: list[dict[str, Any]] = []
    unsupported: set[str] = set()
    for pin_match in re.finditer(r"^\s*PIN\s+(\S+)\s*$([\s\S]*?)^\s*END\s+\1\s*$", body, re.MULTILINE):
        pin_name, pin_body = pin_match.group(1), pin_match.group(2)
        layer: str | None = None
        geometry: list[dict[str, Any]] = []
        for line in pin_body.splitlines():
            layer_match = re.match(r"\s*LAYER\s+(\S+)\s*;", line)
            if layer_match:
                layer = layer_match.group(1)
            rectangle = re.match(rf"\s*RECT\s+({NUMBER})\s+({NUMBER})\s+({NUMBER})\s+({NUMBER})\s*;", line)
            if rectangle and layer:
                geometry.append({"layer": layer, "rect": [float(value) for value in rectangle.groups()]})
            elif re.match(r"\s*(RECT|POLYGON|PATH|VIA)\s", line):
                unsupported.add(line.strip().split()[0])
        pins.append({"name": pin_name, "direction": _statement(pin_body, "DIRECTION"),
                     "use": _statement(pin_body, "USE"), "geometry": geometry,
                     "antenna_statements": re.findall(r"\bANTENNA\w+\s+[^;]+;", pin_body)})
    # 宏的 CLASS/SITE/SYMMETRY 只从第一个 PIN 之前读取，避免误读端口内部内容。
    header = re.split(r"\bPIN\s", body, maxsplit=1)[0]
    return {
        "name": name, "unit": "µm", "width": float(size.group(1)), "height": float(size.group(2)),
        "class": _statement(header, "CLASS"), "site": _statement(header, "SITE"),
        "symmetry": (_statement(header, "SYMMETRY") or "").split(), "pins": pins,
        "unsupported_geometry": sorted(unsupported),
        "scope": "LEF 后端抽象：边界与引脚矩形；不包含完整器件内部与 OBS 可视化。",
    }


def parse_tech_lef(text: str) -> dict[str, Any]:
    layers: list[dict[str, Any]] = []
    for match in re.finditer(r"^LAYER\s+(\S+)\s*$([\s\S]*?)^END\s+\1\s*$", text, re.MULTILINE):
        name, body = match.groups()
        layers.append({"name": name, "type": _statement(body, "TYPE"), "direction": _statement(body, "DIRECTION"),
                       "width": _statement(body, "WIDTH"), "pitch": _statement(body, "PITCH"),
                       "antenna_statements": re.findall(r"\bANTENNA\w+\s+[^;]+;", body)})
    sites: list[dict[str, Any]] = []
    for match in re.finditer(r"^SITE\s+(\S+)\s*$([\s\S]*?)^END\s+\1\s*$", text, re.MULTILINE):
        size = re.search(rf"\bSIZE\s+({NUMBER})\s+BY\s+({NUMBER})\s*;", match.group(2))
        sites.append({"name": match.group(1), "width": float(size.group(1)) if size else None,
                      "height": float(size.group(2)) if size else None, "unit": "µm"})
    units = re.search(r"\bDATABASE\s+MICRONS\s+(\d+)\s*;", text)
    return {"database_units_per_micron": int(units.group(1)) if units else None, "layers": layers, "sites": sites,
            "scope": "工艺 LEF 元数据；天线条款仅展示原文，不作为天线求解或签核。"}


def _remove_comments(text: str) -> str:
    # 保留双引号中的字符，不能把引号内的 // 当作注释。
    return re.sub(r'"(?:\\.|[^"\\])*"|/\*[\s\S]*?\*/|//[^\n]*',
                  lambda match: match.group() if match.group().startswith('"') else "", text)


def _brace_body(text: str, start: int) -> tuple[str, int]:
    depth, quoted, escaped = 1, False, False
    for position in range(start + 1, len(text)):
        char = text[position]
        if quoted:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                quoted = False
        elif char == '"':
            quoted = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start + 1:position], position + 1
    raise LibraryUnavailable("Liberty 存在未闭合的组")


def _named_group(text: str, kind: str, name: str) -> str | None:
    pattern = rf'\b{re.escape(kind)}\s*\(\s*(?:"{re.escape(name)}"|{re.escape(name)})\s*\)\s*\{{'
    match = re.search(pattern, text)
    return _brace_body(text, match.end() - 1)[0] if match else None


def _top_level_text(text: str) -> str:
    """剔除嵌套组，再读取属性，避免将 timing 组属性当作 pin 或 cell 属性。"""
    segments: list[str] = []
    position = 0
    pattern = re.compile(r'"(?:\\.|[^"\\])*"|\{')
    while position < len(text):
        match = pattern.search(text, position)
        if not match:
            segments.append(text[position:])
            break
        if match.group() == "{":
            segments.append(text[position:match.start()])
            _, position = _brace_body(text, match.start())
        else:
            segments.append(text[position:match.end()])
            position = match.end()
    return "".join(segments)


def _attribute(text: str, name: str) -> str | None:
    match = re.search(rf'\b{re.escape(name)}\s*:\s*("(?:\\.|[^"\\])*"|[^;]+)\s*;', text)
    return match.group(1).strip().strip('"') if match else None


def parse_liberty_cell(text: str, name: str) -> dict[str, Any] | None:
    body = _named_group(text, "cell", name)
    if body is None:
        return None
    pins: list[dict[str, Any]] = []
    for match in re.finditer(r'\bpin\s*\(\s*(?:"([^"\n]+)"|([\w\[\].-]+))\s*\)\s*\{', body):
        pin_name = match.group(1) or match.group(2)
        pin_body, _ = _brace_body(body, match.end() - 1)
        attributes = _top_level_text(pin_body)
        pins.append({"name": pin_name, "direction": _attribute(attributes, "direction"),
                     "function": _attribute(attributes, "function"), "capacitance": _attribute(attributes, "capacitance")})
    header = _top_level_text(body)
    return {"name": name, "area": _attribute(header, "area"), "pins": pins,
            "scope": "Liberty 基本属性；尚未计算时序表、PVT 下的延迟或模拟行为。"}


def parse_liberty_metadata(text: str) -> dict[str, Any]:
    first_cell = re.search(r"\bcell\s*\(", text)
    header = text[:first_cell.start()] if first_cell else text
    conditions: list[dict[str, Any]] = []
    for match in re.finditer(r'\boperating_conditions\s*\(\s*(?:"([^"\n]+)"|([\w.-]+))\s*\)\s*\{', header):
        body, _ = _brace_body(header, match.end() - 1)
        conditions.append({"name": match.group(1) or match.group(2),
                           "voltage": _attribute(body, "voltage"), "temperature": _attribute(body, "temperature"),
                           "process": _attribute(body, "process")})
    capacitance = re.search(r'\bcapacitive_load_unit\s*\(\s*([^,)]+)\s*,\s*("[^"\n]+"|[^)]+)\)', header)
    return {"units": {field: _attribute(header, field) for field in ("time_unit", "voltage_unit", "current_unit", "leakage_power_unit")},
            "capacitive_load_unit": {"scale": capacitance.group(1).strip(), "unit": capacitance.group(2).strip().strip('"')} if capacitance else None,
            "operating_conditions": conditions}


class LibraryStore:
    def __init__(self, config: ServerConfiguration):
        self.config = config
        self._cache: dict[str, tuple[Any, dict[str, Any]]] = {}
        self._lock = threading.Lock()

    def catalog(self) -> list[dict[str, Any]]:
        return [{"id": pdk_id, "title": pdk["title"], "device_family": pdk["device_family"],
                 "abstract_available": Path(pdk["cell_lef"]).is_file(), "cells": pdk["cells"]}
                for pdk_id, pdk in self.config.get("pdks").items()]

    def _load(self, pdk_id: str) -> dict[str, Any]:
        pdks = self.config.get("pdks")
        if pdk_id not in pdks:
            raise KeyError(pdk_id)
        pdk = pdks[pdk_id]
        source_paths = [Path(pdk["cell_lef"]), Path(pdk["tech_lef"]), *map(Path, pdk["liberty"]), *map(Path, pdk["gds"])]
        signature = [(str(path), path.stat().st_mtime_ns, path.stat().st_size) if path.is_file() else (str(path), None) for path in source_paths]
        with self._lock:
            cached = self._cache.get(pdk_id)
            if cached and cached[0] == signature:
                return cached[1]
            cell_lef = Path(pdk["cell_lef"])
            if not cell_lef.is_file():
                raise LibraryUnavailable("配置登记的单元 LEF 不可读；请在服务器核验工艺资产。")
            lef_content = cell_lef.read_bytes()
            lef_text = lef_content.decode("utf-8")
            tech_path = Path(pdk["tech_lef"])
            tech_content = tech_path.read_bytes() if tech_path.is_file() else None
            tech_text = tech_content.decode("utf-8") if tech_content is not None else None
            liberties = []
            for path in map(Path, pdk["liberty"]):
                if path.is_file():
                    content = path.read_bytes()
                    text = _remove_comments(content.decode("utf-8"))
                    liberties.append((text, source_identity(path, content), parse_liberty_metadata(text)))
            result: dict[str, Any] = {"cells": {}, "technology": parse_tech_lef(tech_text) if tech_text else None}
            for registration in pdk["cells"]:
                name = registration["name"]
                lef = parse_lef_cell(lef_text, name)
                electrical = []
                for text, identity, metadata in liberties:
                    parsed = parse_liberty_cell(text, name)
                    if parsed:
                        electrical.append({**parsed, **metadata, "source": identity})
                result["cells"][name] = {"name": name, "pdk_id": pdk_id, "role": registration["role"],
                                          "role_evidence": registration["evidence"], "lef": lef, "liberty": electrical}
            identity = source_identity(cell_lef, lef_content)
            tech_identity = source_identity(tech_path, tech_content) if tech_content is not None else None
            for cell in result["cells"].values():
                cell["sources"] = {"cell_lef": identity, "tech_lef": tech_identity}
                cell["gds"] = [{"file": Path(path).name, "available": Path(path).is_file(), "geometry_parsed": False} for path in pdk["gds"]]
                cell["technology"] = result["technology"]
                cell["status"] = "ready" if cell["lef"] else "cell_missing"
                cell["three_dimensional_reconstruction"] = False
            self._cache[pdk_id] = (signature, result)
            return result

    def cell(self, pdk_id: str, name: str) -> dict[str, Any]:
        # 仅查询登记对象；不能利用参数读取库内任意文件或无边界索引整个库。
        if pdk_id not in self.config.get("pdks") or name not in {cell["name"] for cell in self.config.get(f"pdks.{pdk_id}.cells")}:
            raise KeyError(name)
        return self._load(pdk_id)["cells"][name]
