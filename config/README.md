# 服务器配置单一事实源

部署时复制 `server.example.json` 为 `server.local.json` 并填写。每个命令只读取 `--config` 明确指定的一份文件；示例与本地配置不会合并，没有 `.env` 覆盖、用户目录自动搜索或工具路径回退表。本地文件被 Git 忽略，后续拉取代码不会覆盖服务器路径。

使用 JSON 是为了兼容当前扫描到的 Python 3.10，不要求服务器额外安装配置解析依赖。文件不支持注释，字段解释在本文。API 密钥不属于本配置。

## 路径规则

1. 所有相对路径以**配置文件所在目录**为基准，与命令工作目录无关。
2. `${paths.orfs_root}` 等表达式引用配置字段。路径引用先变成绝对路径，再拼接后缀；不存在的字段、空路径和引用循环直接报错。
3. 工具入口可以是完整路径，也可以是裸命令名。裸命令仅按服务器的 PATH 及配置中的 `environment.executable_paths` 定位；需要固定版本时填写完整路径。不要写 `source ...`、shell 表达式或多个命令。
4. 输出目录不允许与 ORFS、PDK、原始网页/案例、配置目录重叠；路径会解析符号链接后比较。检查与索引仅在指定生成目录写入。
5. 路径可以包含空格。JSON 中 Windows 反斜线需写为 `\\`，也可使用 `/`；Linux 使用 Linux 路径，不能直接复用 Windows 盘符。

服务器项目与 ORFS 平行时，示例中的关系已经符合要求：

```json
"project_root": "..",
"orfs_root": "${paths.project_root}/../OpenROAD-flow-scripts"
```

若 ORFS 文件夹名字或位置不同，只改 `paths.orfs_root`；`flow_home`、OpenROAD、Yosys 和默认 SKY130 资料会随引用变化。独立安装的 PDK 可以通过 `paths.pdk_root` 或 `pdks.<id>.root` 指向其它位置；各个资产文件也可分别覆盖，代码不假设所有服务器都采用 ORFS 内置库布局。

## 字段说明

| 字段 | 用途 |
| --- | --- |
| `paths.project_root` | 本项目根目录，示例为配置目录的上一级 |
| `paths.frontend_root` / `case_catalog` | 静态网页与预设案例目录/文件 |
| `paths.orfs_root` / `flow_home` | ORFS 根与流程目录 |
| `paths.platforms_root` / `pdk_root` | ORFS 平台集合与默认工艺资产集合；可以不同 |
| `paths.runtime_root` | 项目独立生成根目录，不写入共享 ORFS |
| `paths.jobs_root` | 后续任务工作区，目前不执行设计任务 |
| `paths.reports_root` / `logs_root` / `exports_root` | 检查记录、日志与部署/教学导出 |
| `paths.environment_report` / `library_index` | 检查记录与真实库索引的具体输出文件 |
| `paths.service_template` / `service_unit` | systemd 模板与生成文件 |
| `server.host` / `port` | 服务监听地址与端口；修改此处即可，不在 unit 中复制 |
| `tools.<name>.executable` | Python、make、OpenROAD、Yosys、KLayout、Blender 的入口 |
| `tools.<name>.version_args` | 对应工具的只读版本查询参数数组 |
| `environment.variables` | 对工具子进程应用的环境变量；示例让 Qt 无显示启动 |
| `environment.executable_paths` / `library_paths` | 子进程 PATH / LD_LIBRARY_PATH 前缀目录列表 |
| `orfs.makefile` / `scripts_dir` / `utils_dir` | 流程文件、脚本与 util 目录，供检查及后续适配 |
| `orfs.probe_timeout_seconds` | 工具版本查询超时 |
| `orfs.worker_count` / `threads_per_run` / `job_timeout_seconds` | 后续执行器资源参数；当前没有队列或任务执行器 |
| `deployment.service_user` | 生成 systemd 文件前填写；当前默认留空 |
| `deployment.app_script` | 服务入口源文件，systemd 渲染时引用 |
| `pdks.<id>.platform_name` / `platform_config` | ORFS 平台身份与配置入口 |
| `pdks.<id>.tech_lef` / `cell_lef` | 技术 LEF 与单元 LEF，可分别放置 |
| `pdks.<id>.liberty` / `gds` / `cdl` | 按版本对应登记的文件列表，不能任意混用库版本 |
| `pdks.<id>.klayout_tech` / `layer_properties` | KLayout 技术文件与图层显示文件 |
| `pdks.<id>.tapcell_script` | 已登记平台的 tap 配方文件，仅检查存在性，不执行 |
| `pdks.<id>.cells` | 首批开放读取的单元名单、角色及角色依据 |

示例中的 SKY130 路径和单元名来自本次 WSL 扫描，是可编辑的工艺配置数据。后端不写死这些名称；添加工艺或替换库时改该配置并重新核验。当前解析器仅支持登记的 LEF/Liberty 基础子集，配置存在并不意味着 FinFET/GAA 三维或真实流程已经实现。

## 填写后的检查

在项目根目录运行：

```bash
python3 -m backend.manage --config config/server.local.json doctor --probe-tools --write-report
python3 -m backend.manage --config config/server.local.json library --pdk sky130hd --write-report
python3 -m backend.app --config config/server.local.json
```

检查命令不带 `--write-report` 时只输出终端，不创建目录。`doctor` 返回码 0 表示 Linux 下已登记的必需路径/工具检查通过，1 表示缺失或查询失败，2 表示配置格式或读取错误。Blender 留空时是 `unconfigured`，不阻止当前的库资料展示；不能因此声称建模环境已验收。路径/版本检查通过也不会启用 ORFS 运行。

WSL 验证使用被 Git 忽略的 `wsl.local.json`，只是一份独立的本机配置，不是服务器配置的覆盖层，不会由服务自动读取。服务器使用自己的 `server.local.json`。
