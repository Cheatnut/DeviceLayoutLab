"""测试使用显式临时配置，不依赖任何开发者机器或真实工具路径。"""

import json
import sys
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_document(root: Path) -> dict[str, Any]:
    document = json.loads((PROJECT_ROOT / "config" / "server.example.json").read_text(encoding="utf-8"))
    document["paths"].update({"project_root": str(PROJECT_ROOT), "runtime_root": str(root / "output"),
                              "orfs_root": str(root / "orfs")})
    document["tools"]["python"]["executable"] = sys.executable
    document["server"]["port"] = 0
    return document


def write_test_configuration(root: Path, document: dict[str, Any] | None = None) -> Path:
    path = root / "config" / "test.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document if document is not None else test_document(root), ensure_ascii=False), encoding="utf-8")
    return path
