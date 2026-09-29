# Linux 部署草案

首个切片不需要 Node.js 运行时，也不需要 ORFS。服务器只需 Python 3.11 或更高版本，以仓库根目录为工作目录运行：

```bash
python3 backend/app.py --host 0.0.0.0 --port 8080
```

部署前应完成以下核验：

1. Linux 主机已用 SSH 访问 `git@github.com:Cheatnut/DeviceLayoutLab.git`。
2. 防火墙、反向代理和监听端口符合课程网络边界。
3. ORFS 的版本、运行入口、SKY130 资产、资源上限和独立输出目录已核验。

在第 3 项完成前，`/api/runs` 会明确返回 `ORFS_NOT_CONNECTED`，不会运行命令或产生工具结果。

`device-layout-lab.service.example` 是 systemd 模板。复制并替换占位变量后再启用；不要把真实路径、主机名、用户名或密钥提交到仓库。
