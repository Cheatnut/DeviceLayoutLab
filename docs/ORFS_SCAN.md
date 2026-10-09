# WSL ORFS 只读扫描记录

日期：2026-09-29。运行环境：WSL Ubuntu-22.04。扫描对象由用户指定；本记录中的绝对路径是观察结果，**不是运行代码默认值**。服务器实际位置由唯一 shell 配置脚本填写。

实际找到 `/home/cheatnut/OpenROAD-flow-scripts`，结构如下：

```text
ORFS_ROOT/
├── env.sh
├── tools/install/
│   ├── OpenROAD/bin/openroad
│   └── yosys/bin/yosys
└── flow/
    ├── Makefile
    ├── scripts/variables.mk
    ├── util/
    ├── designs/
    ├── platforms/sky130hd/
    │   ├── config.mk
    │   ├── tapcell.tcl
    │   ├── lef/sky130_fd_sc_hd.tlef
    │   ├── lef/sky130_fd_sc_hd_merged.lef
    │   ├── lib/sky130_fd_sc_hd__tt_025C_1v80.lib
    │   ├── gds/sky130_fd_sc_hd.gds
    │   ├── cdl/sky130hd.cdl
    │   ├── sky130hd.lyt
    │   └── sky130hd.lyp
    ├── results/
    ├── reports/
    ├── logs/
    └── objects/
```

现有 ORFS 下已有结果目录，但本项目没有修改或使用它们作为自己的运行结果。项目输出写到独立配置的工作区。

## 工具入口与版本

| 工具 | 本次观察入口 | 查询结果 |
| --- | --- | --- |
| OpenROAD | `ORFS_ROOT/tools/install/OpenROAD/bin/openroad` | `26Q3-18-g5c5380c49a` |
| ORFS 自带 Yosys | `ORFS_ROOT/tools/install/yosys/bin/yosys` | `0.64`，提交 `8449dd470` |
| 系统 Yosys | `/usr/bin/yosys` | `0.9`，提交 `1979e0b` |
| KLayout | `/usr/bin/klayout` | `0.30.7` |
| Python | `/usr/bin/python3` → Python 3.10 | `3.10.12` |
| make | `/usr/bin/make` | `4.3` |

不能依据 `command -v yosys` 选择 ORFS 工具：系统与 ORFS 安装版本不同。OpenROAD 不在当时的裸命令 PATH 中。配置示例因此显式引用 ORFS 的安装入口；KLayout、Python、make 允许填写完整路径以固定版本。

该 ORFS 目录没有可读取的 Git 元数据，不能声明已核验 ORFS 自身的提交号。OpenROAD 与 Yosys 的版本查询不替代 ORFS 脚本版本；后续运行记录应保存所用脚本/配置身份。

## 已读取的路径机制

本次依据本地 `flow/Makefile` 与 `flow/scripts/variables.mk`：

- `FLOW_HOME` 用于流程目录；`SCRIPTS_DIR`、`UTILS_DIR` 可配置。
- 平台路径允许 `PLATFORM_DIR`，或经 `PLATFORM_HOME` 与平台名组合。配置中的工艺资产根与流程根可以分离。
- `WORK_HOME` 参与 `results/logs/reports/objects/<platform>/<design>/<variant>` 组织。后续执行必须重定向到项目任务工作区，不写入共享流程目录。
- 支持显式 `OPENROAD_EXE`、`YOSYS_EXE`、`KLAYOUT_CMD`。后续适配器应从同一个配置生成这些参数，不依赖自动加载 `env.sh`。
- `sky130hd/config.mk` 登记 tap、filler、tie 对象；天线二极管身份来自单元 LEF 的 `CLASS CORE ANTENNACELL` 与 `DIODE` 引脚的 `ANTENNADIFFAREA`，不是该平台配置中的 `DIODE_CELL`。本项目的角色映射分别引用这些来源。tap 脚本含工艺特定距离，该值未复制到应用代码中，也未运行该脚本。

以上是当前 WSL 文件的行为，服务器需再运行配置检查；未执行 make 目标、综合、放置、路由或任何专项修复。

## 真实单元读取结果

| 单元 | LEF 边界，µm | 本次读取的 Liberty |
| --- | --- | --- |
| `sky130_fd_sc_hd__inv_1` | 1.38 × 2.72 | `Y = (!A)` |
| `sky130_fd_sc_hd__nand2_1` | 1.38 × 2.72 | `Y = (!A) \| (!B)` |
| `sky130_fd_sc_hd__tapvpwrvgnd_1` | 0.46 × 2.72 | 无对应条目 |
| `sky130_fd_sc_hd__fill_1` | 0.46 × 2.72 | 无对应条目 |
| `sky130_fd_sc_hd__conb_1` | 1.38 × 2.72 | `HI = 1`、`LO = 0` |
| `sky130_fd_sc_hd__diode_2` | 0.92 × 2.72 | 条目可读；没有逻辑输出函数 |

技术 LEF 读取到 nwell、pwell、li1、mcon、met1、via、met2、via2、met3、via3、met4、via4、met5。SITE 和数据库单位来自该文件；没有由节点名称推算三维高度。

库读取保留文件名、SHA-256 和尺寸单位。GDS/CDL 目前只检查已登记文件存在性，没有解析内部器件、建立 LVS 映射或生成 Blender 模型。

机器检查记录保存在配置指定的独立目录并被 Git 忽略；本记录保存可审查的结论，不把 WSL 验证当成服务器或制造签核验收。
