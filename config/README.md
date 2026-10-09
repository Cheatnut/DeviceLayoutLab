# Linux 服务器单一配置脚本

服务器只维护 `server.local.sh`。首次部署复制 `server.example.sh`，编辑脚本中的 ORFS、工具、PDK 和监听地址，然后在同一个 shell 中 `source`。Python 程序只读取该 shell 继承的 `DLL_*` 环境变量，不会搜索另一份配置、读取 JSON 覆盖项或猜测服务器路径。

```bash
cp config/server.example.sh config/server.local.sh
nano config/server.local.sh
source config/server.local.sh
```

示例默认假设项目与 ORFS 并排：项目根目录由配置脚本所在位置计算，ORFS 路径由 `DLL_ORFS_ROOT` 设置。若 ORFS 名称/位置不同，只需修改这一行：

```bash
export DLL_ORFS_ROOT="${DLL_PROJECT_ROOT}/../OpenROAD-flow-scripts"
```

项目移动时脚本会重新定位项目根。若 PDK 仍使用 ORFS 标准 SKY130 HD 目录结构，改 ORFS 根后，`DLL_FLOW_HOME`、`DLL_PDK_ROOT` 及库文件路径会跟着派生。其它安装方式就修改对应的 `DLL_PDK_*` 路径。工具可填写完整路径；也可填写命令名，此时仅从当前 shell 的 PATH 查找。Blender 目前可留空。

## 关键变量

| 变量组 | 用途 |
| --- | --- |
| `DLL_PROJECT_ROOT` | 项目根目录；由脚本位置计算，不需要手工填 |
| `DLL_ORFS_ROOT` / `DLL_FLOW_HOME` / `DLL_PLATFORMS_ROOT` | ORFS 根、flow 和平台目录 |
| `DLL_PDK_*` | 工艺 ID、资料文件与可浏览单元登记；单元每行写成 `name|role|evidence` |
| `DLL_PYTHON`、`DLL_MAKE`、`DLL_OPENROAD`、`DLL_YOSYS`、`DLL_KLAYOUT`、`DLL_BLENDER` | 工具路径或 PATH 中的命令名 |
| `DLL_HOST` / `DLL_PORT` | 服务监听地址和端口；供其它电脑访问时通常将 host 设为 `0.0.0.0` |
| `DLL_RUNTIME_ROOT` 及其子目录 | 任务、报告、日志和导出目录，必须独立于 ORFS/PDK/源文件 |
| `DLL_EXECUTABLE_PATHS` / `DLL_LIBRARY_PATHS` | 子进程的 PATH 与 LD_LIBRARY_PATH 前缀，多个目录用冒号分隔 |
| `DLL_PROBE_TIMEOUT_SECONDS`、`DLL_WORKER_COUNT`、`DLL_THREADS_PER_RUN`、`DLL_JOB_TIMEOUT_SECONDS` | 工具核验超时与未来任务资源参数；当前没有任务执行器 |
| `DLL_SERVICE_USER` / `DLL_BASH` | 可选 systemd 渲染使用的服务账户和 Bash 入口 |

`DLL_PDK_LIBERTY`、`DLL_PDK_GDS` 和 `DLL_PDK_CDL` 支持每行一个文件。`DLL_PDK_CELLS` 支持每行一个单元，字段间使用竖线。请保留每个库文件的 PDK 和版本对应关系。当前版本登记一个 PDK；SKY130 单元名只在示例脚本中出现，后端不预设这些名字。

## 检查与启动

每次打开新的 shell 时先加载脚本：

```bash
source config/server.local.sh
"$DLL_PYTHON" -m backend.manage doctor --probe-tools --write-report
"$DLL_PYTHON" -m backend.manage library --pdk "$DLL_PDK_ID" --write-report
"$DLL_PYTHON" -m backend.app
```

`doctor` 只检查已登记路径并按要求查询工具版本，不运行 ORFS 设计流程。退出码 0 表示必需路径与工具入口可用，1 表示检查有缺项，2 表示配置格式或读取错误。报告只写到 `DLL_REPORTS_ROOT` 下。

前台启动的进程继承当前 shell 环境；退出该 shell 后变量不会留在系统中。systemd 模板渲染也从同一份本地脚本获取配置：

```bash
"$DLL_PYTHON" -m backend.manage render-service --write
```

此命令只生成 unit 文件，不安装、不启用 systemd 服务。API 密钥不属于本配置。`server.local.sh` 被 Git 忽略；请不要提交本地服务器路径或凭据。
