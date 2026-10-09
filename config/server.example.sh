#!/usr/bin/env bash
# DeviceLayoutLab 服务器配置示例。
# 复制为 server.local.sh 后编辑；启动前在项目根目录 source 此文件。

# 通过本文件位置定位项目，因此项目本身移动后无需手工改项目根目录。
_dll_config_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
_dll_config_file="$(basename -- "${BASH_SOURCE[0]}")"
export DLL_CONFIG_SCRIPT="${_dll_config_dir}/${_dll_config_file}"
export DLL_PROJECT_ROOT="$(cd -- "${_dll_config_dir}/.." && pwd -P)"
unset _dll_config_dir _dll_config_file

# ORFS 与项目平行时只需修改用户名或 ORFS 文件夹路径。
export DLL_ORFS_ROOT="${DLL_PROJECT_ROOT}/../OpenROAD-flow-scripts"
export DLL_FLOW_HOME="${DLL_ORFS_ROOT}/flow"
export DLL_PLATFORMS_ROOT="${DLL_FLOW_HOME}/platforms"

# 首版使用 ORFS 自带的 SKY130 HD。独立安装的 PDK 可在这里改根目录，
# 若其资产布局不同，再分别修改下方 DLL_PDK_* 文件路径。
export DLL_PDK_ID="sky130hd"
export DLL_PDK_TITLE="SKY130 HD"
export DLL_PDK_DEVICE_FAMILY="planar"
export DLL_PDK_PLATFORM_NAME="sky130hd"
export DLL_PDK_ROOT="${DLL_PLATFORMS_ROOT}/sky130hd"
export DLL_PDK_PLATFORM_CONFIG="${DLL_PDK_ROOT}/config.mk"
export DLL_PDK_TECH_LEF="${DLL_PDK_ROOT}/lef/sky130_fd_sc_hd.tlef"
export DLL_PDK_CELL_LEF="${DLL_PDK_ROOT}/lef/sky130_fd_sc_hd_merged.lef"
export DLL_PDK_LIBERTY="${DLL_PDK_ROOT}/lib/sky130_fd_sc_hd__tt_025C_1v80.lib"
export DLL_PDK_GDS="${DLL_PDK_ROOT}/gds/sky130_fd_sc_hd.gds"
export DLL_PDK_CDL="${DLL_PDK_ROOT}/cdl/sky130hd.cdl"
export DLL_PDK_KLAYOUT_TECH="${DLL_PDK_ROOT}/sky130hd.lyt"
export DLL_PDK_LAYER_PROPERTIES="${DLL_PDK_ROOT}/sky130hd.lyp"
export DLL_PDK_TAPCELL_SCRIPT="${DLL_PDK_ROOT}/tapcell.tcl"

# 每行登记一个可浏览单元：单元名 | 教学角色 | 登记依据。
export DLL_PDK_CELLS='
sky130_fd_sc_hd__inv_1|反相器|Liberty 输出引脚 function
sky130_fd_sc_hd__nand2_1|二输入 NAND|Liberty 输出引脚 function
sky130_fd_sc_hd__tapvpwrvgnd_1|Tap|ORFS 平台 config.mk 的 TAP_CELL_NAME
sky130_fd_sc_hd__fill_1|Filler|ORFS 平台 config.mk 的 FILL_CELLS
sky130_fd_sc_hd__conb_1|Tie high / low|ORFS 平台 config.mk 的 tie 单元配置
sky130_fd_sc_hd__diode_2|天线二极管|LEF 的 ANTENNACELL 类与天线属性
'

# 工具入口。ORFS 自带 OpenROAD/Yosys 可锁定版本；KLayout、Python、make
# 可填写绝对路径，也可填 PATH 中的命令名。Blender 当前为可选项。
export DLL_PYTHON="/usr/bin/python3"
export DLL_PYTHON_VERSION_ARGS="--version"
export DLL_MAKE="/usr/bin/make"
export DLL_MAKE_VERSION_ARGS="--version"
export DLL_OPENROAD="${DLL_ORFS_ROOT}/tools/install/OpenROAD/bin/openroad"
export DLL_OPENROAD_VERSION_ARGS="-version"
export DLL_YOSYS="${DLL_ORFS_ROOT}/tools/install/yosys/bin/yosys"
export DLL_YOSYS_VERSION_ARGS="-V"
export DLL_KLAYOUT="/usr/bin/klayout"
export DLL_KLAYOUT_VERSION_ARGS="-v"
export DLL_BLENDER=""
export DLL_BLENDER_VERSION_ARGS="--version"
export DLL_BASH="/usr/bin/bash"

# 网页监听地址。需要让其它电脑访问时使用 0.0.0.0，并开放对应端口。
export DLL_HOST="0.0.0.0"
export DLL_PORT="8080"

# 独立生成目录，不能指向 ORFS 或 PDK 源目录。
export DLL_RUNTIME_ROOT="${DLL_PROJECT_ROOT}/runtime"
export DLL_JOBS_ROOT="${DLL_RUNTIME_ROOT}/jobs"
export DLL_REPORTS_ROOT="${DLL_RUNTIME_ROOT}/reports"
export DLL_LOGS_ROOT="${DLL_RUNTIME_ROOT}/logs"
export DLL_EXPORTS_ROOT="${DLL_RUNTIME_ROOT}/exports"
export DLL_FRONTEND_ROOT="${DLL_PROJECT_ROOT}/frontend"
export DLL_CASE_CATALOG="${DLL_PROJECT_ROOT}/backend/data/cases.json"
export DLL_SERVICE_TEMPLATE="${DLL_PROJECT_ROOT}/deploy/device-layout-lab.service.example"

# 工具版本探测与未来 ORFS 任务资源限制。
export DLL_PROBE_TIMEOUT_SECONDS="15"
export DLL_WORKER_COUNT="1"
export DLL_THREADS_PER_RUN="2"
export DLL_JOB_TIMEOUT_SECONDS="3600"

# 可选：工具子进程需要的环境变量及搜索路径，目录之间用冒号分隔。
export DLL_QT_QPA_PLATFORM="offscreen"
export DLL_EXECUTABLE_PATHS=""
export DLL_LIBRARY_PATHS=""

# 生成 systemd unit 时填写服务账户；仅前台运行时可以留空。
export DLL_SERVICE_USER=""
