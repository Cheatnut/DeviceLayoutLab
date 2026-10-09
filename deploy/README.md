# Linux 部署

Windows 侧维护代码，Linux 服务器从 GitHub 通过 SSH 拉取。运行期需要 Python 3.10 及以上，不需要 Node.js 或公网 CDN。服务器路径、工具和 PDK 资料都填写在同一份 shell 配置脚本中，见 [配置说明](../config/README.md)。

首次部署：

```bash
git clone git@github.com:Cheatnut/DeviceLayoutLab.git
cd DeviceLayoutLab
cp config/server.example.sh config/server.local.sh
nano config/server.local.sh
source config/server.local.sh
```

编辑脚本中的 `DLL_ORFS_ROOT` 和工具入口。如果项目与 ORFS 平行，通常保留示例 ORFS 路径即可。要让其它电脑访问，将 `DLL_HOST` 设为 `0.0.0.0`，确认 `DLL_PORT` 与服务器防火墙规则一致。

检查并启动：

```bash
"$DLL_PYTHON" -m backend.manage doctor --probe-tools --write-report
"$DLL_PYTHON" -m backend.manage library --pdk "$DLL_PDK_ID" --write-report
"$DLL_PYTHON" -m backend.app
```

服务在当前终端前台运行，按 `Ctrl+C` 停止；浏览器访问 `http://<服务器IP>:<DLL_PORT>`。重新登录或打开新的 shell 后，先再次运行 `source config/server.local.sh`。网页的工艺库面板展示真实 LEF 边界、引脚矩形、Liberty 函数及来源；核心教学场景仍标为人工编排。

目标服务器还需核验 SSH 权限、防火墙、ORFS 工具版本、SKY130 资产、资源上限和独立输出目录。`doctor` 只检查路径和工具版本，不运行设计流程。当前 `/api/runs` 仍返回 `ORFS_NOT_CONNECTED`，路径核验通过也不代表已启用真实流程。

## 可选 systemd 文件生成

在本地 shell 脚本中设置 `DLL_SERVICE_USER` 与正确的 `DLL_BASH`，然后：

```bash
source config/server.local.sh
"$DLL_PYTHON" -m backend.manage render-service --write
```

该命令生成的 unit 会调用 `deploy/run-with-config.sh`，再加载同一份 `server.local.sh`。生成文件放在 `DLL_EXPORTS_ROOT`；命令不会安装、启用或修改系统服务。

`config/server.local.sh`、运行日志和检查报告被 Git 忽略。更新代码后沿用服务器上的脚本，无需修改 Python、前端或 systemd 源模板。
