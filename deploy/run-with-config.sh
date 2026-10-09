#!/usr/bin/env bash
# systemd 启动入口：加载与交互式启动相同的本地配置脚本。
set -euo pipefail

config_script="${1:?需要传入 server.local.sh 路径}"
shift
source "${config_script}"
exec "${DLL_PYTHON:?DLL_PYTHON 未设置}" "$@"
