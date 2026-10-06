# Linux 部署

Windows 侧开发代码，Linux 服务器从 GitHub 拉取。运行期不需要 Node.js 或公网 CDN，当前后端兼容 Python 3.10 及以上。所有服务器路径、工具和监听参数只在一份 JSON 中填写，详见 [配置说明](../config/README.md)。

在服务器的项目父目录克隆（已经克隆则在仓库中正常拉取）：

```bash
git clone git@github.com:Cheatnut/DeviceLayoutLab.git
cd DeviceLayoutLab
cp config/server.example.json config/server.local.json
```

编辑 `config/server.local.json`。项目与 ORFS 平行时保留示例的相对引用即可；不同安装位置只在配置填写。要允许其它电脑连接，在配置的 `server.host` 填写适合课程网络的监听地址。端口也只填在配置中。

在项目根目录检查并启动：

```bash
python3 -m backend.manage --config config/server.local.json doctor --probe-tools --write-report
python3 -m backend.manage --config config/server.local.json library --pdk sky130hd --write-report
python3 -m backend.app --config config/server.local.json
```

服务只读取该文件，不加载仓库内其它实例配置。网页中的“工艺库”面板显示实际 LEF 边界与引脚矩形、Liberty 函数和来源；核心教学场景仍明确标注人工编排。

首批核验：

1. Linux 主机已用 SSH 访问 `git@github.com:Cheatnut/DeviceLayoutLab.git`。
2. 防火墙、反向代理和监听端口符合课程网络边界。
3. ORFS 的版本、运行入口、SKY130 资产、资源上限和独立输出目录已核验。

`doctor` 只检查已登记路径与工具版本；工具查询可以附加配置中的环境变量和库搜索路径。缺失项会报告出来。当前 `/api/runs` 仍返回 `ORFS_NOT_CONNECTED`，即使路径检查通过也不会自动启用真实流程；任务执行器与配方接入后单独验收。

## 可选 systemd 文件生成

先在同一份配置中填写 `deployment.service_user` 和 `tools.python.executable`，然后运行：

```bash
python3 -m backend.manage --config config/server.local.json render-service --write
```

生成文件位置由 `paths.service_unit` 指定。模板中的项目路径、Python 入口与配置位置全部从该文件渲染；监听地址与端口仍由服务直接读取配置，不写进 unit。此命令仅生成文件，不安装单元、不修改系统配置、不启用服务。

`server.local.json`、运行日志和检查记录被 Git 忽略。真实路径可以留在服务器配置中，API 密钥不要填入这份路径配置。更新代码后沿用同一份实例配置，无需修改 Python、JS 或 systemd 源模板。
