# DeviceLayoutLab

独立的后端物理实现教学项目，通过器件、单元、工艺库、版图和电路的联动展示，帮助学生理解数字集成电路物理设计。

当前阶段：首版开发已启动。Windows 侧维护网页与服务代码，Linux 服务器通过 GitHub SSH 拉取并运行。已实现二维/三维教学工作台、案例 API、服务器统一配置、只读环境检查和真实 LEF/Liberty 资料读取；未执行真实 ORFS 设计流程或生成 Blender 模型。

已确认方向：面向课堂和自主探索；覆盖平面 MOS、FinFET、GAA；采用 Blender + Three.js；前端教学网页、独立后端调用 ORFS，后期接入 Agent，不连接同级教学平台。重心是认识工艺库、标准/物理单元、金属层、走线、闩锁与天线效应；暂不做空间电场求解。

产品形式：工程工作台为主，配预设案例；用户直接选择、操作、运行与对比，不包含答题、测验或评分。

- [项目规则](AGENTS.md)
- [首轮讨论与可行性分析](docs/BRAINSTORM.md)
- [后端物理教学方案与用户场景](docs/PLAN.md)
- [首版验收草案与已确认取舍](docs/V1_ACCEPTANCE.md)
- [服务器唯一配置与字段说明](config/README.md)
- [WSL ORFS 扫描与库读取记录](docs/ORFS_SCAN.md)

已逐项确认首版产品取舍：桌面 Chrome/Edge、二维/三维并排、局部版图、双轨预设案例、三类教学结构、SKY130 首条真实闭环、个人提交、少量参数与专项配方、预先真实运行加按需重跑，以及现有 Linux 服务器部署。后期 Agent 优先场景操控与对象讲解，通过用户密钥调用 API。

开发切片一：浏览 `标准单元行：INV 与 NAND2` 教学案例，在二维和 Three.js 三维间联动选择对象，按图层筛选，并使用展示性拆解滑块。真实 ORFS 案例会明确标为待 Linux 环境核验，运行接口不会伪造工具结果。

Windows 浏览教学场景可直接使用示例配置：

```powershell
python -m backend.app --config config/server.example.json
```

也可使用 `npm start -- --config config/server.example.json`；启动脚本没有隐式配置文件选择。

按配置中的地址和端口在桌面 Chrome/Edge 打开服务。服务器复制示例为 `config/server.local.json` 填写 ORFS、工具、工艺和输出路径；启动与检查都显式传入该文件。详细 Linux 部署说明见 [deploy/README.md](deploy/README.md)。

当前“工艺库”面板会读取配置登记的实际库文件，展示单元边界、引脚矩形、逻辑函数、库条件与文件来源；路径缺失时明确提示。六个 SKY130 单元已在 WSL 的真实资产上验证读取。局部三维仍为教学抽象，真实 GDS 内部结构和 ORFS 参数实验是后续切片。
