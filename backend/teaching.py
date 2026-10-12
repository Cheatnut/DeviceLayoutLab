"""将理想 CMOS 案例参数转成共享几何；所有坐标、层高和颜色来自案例数据。

这些形状用于解释电路，并非 GDS、掩膜或工艺仿真结果。二维的有源区
是连续的设计区域；三维掺杂区在栅下留出沟道，避免把沟道画成重掺杂区。
"""

from copy import deepcopy


def subtract_rect(rect, cut):
    """轴对齐矩形差集，用于场氧化层窗口及有源区的沟道留空。"""
    x, y, w, h = rect
    a, b, cw, ch = cut
    left, right = max(x, a), min(x + w, a + cw)
    top, bottom = max(y, b), min(y + h, b + ch)
    if left >= right or top >= bottom:
        return [rect]
    candidates = [[x, y, w, top-y], [x, bottom, w, y+h-bottom],
                  [x, top, left-x, bottom-top], [right, top, x+w-right, bottom-top]]
    return [r for r in candidates if r[2] > 0 and r[3] > 0]


def wire_rects(points, width):
    """每个正交线段生成带端点覆盖的矩形，转弯处保持实体连通。"""
    result = []
    for (x1, y1), (x2, y2) in zip(points, points[1:]):
        if x1 != x2 and y1 != y2:
            raise ValueError("教学互连必须为正交线段")
        result.append([min(x1, x2)-width/2, min(y1, y2)-width/2,
                       abs(x1-x2)+width, abs(y1-y2)+width])
    return result


def build_teaching_case(case, defaults):
    result = deepcopy(case)
    if "teaching" not in result:
        return result
    spec = {**deepcopy(defaults), **result["teaching"]}
    result["teaching"] = spec
    entities = []

    def add(identity, name, layer, rects, explanation, net="—", **extra):
        entities.append({"id": identity, "name": name, "type": "teachingPart",
                         "layer": layer, "role": spec["layers"][layer]["name"],
                         "net": net, "rects": rects, "color": spec["layers"][layer]["color"],
                         "explanation": explanation, **extra})

    add("substrate", "P 衬底", "SUBSTRATE", [spec["substrate"]], "NMOS 位于 P 型衬底中；P+ 衬底接触把体端接到 GND。三维深度为教学比例。", "GND")
    add("nwell", "N-well", "NWELL", [spec["well"]], "PMOS 位于 N 阱中；N+ 阱接触把阱接到 VDD。阱的平面边界与深度均为教学参数。", "VDD")
    active_windows = [a["rect"] for a in spec["active"] + spec["taps"]]
    field_rects = [spec["field"]]
    for window in active_windows:
        field_rects = [piece for rect in field_rects for piece in subtract_rect(rect, window)]
    add("field", "场区", "FIELD", [spec["field"]], "有源区以外的隔离区域；二维用虚线描出范围，三维以带有源窗口的隔离层示意。", modelRects=field_rects)
    for active in spec["active"]:
        model_rects = [active["rect"]]
        for gate in spec["gates"]:
            cut = [gate["x"]-spec["polyWidth"]/2, gate["top"], spec["polyWidth"], gate["bottom"]-gate["top"]]
            model_rects = [piece for rect in model_rects for piece in subtract_rect(rect, cut)]
        add(active["id"], active["name"], active["layer"], [active["rect"]], "实线边界表示有源区。多晶硅跨越有源区的位置形成 MOS 栅；三维在栅下保留沟道位置，源漏区位于两侧。", modelRects=model_rects)
    for tap in spec["taps"]:
        add(tap["id"], tap["name"], tap["layer"], [tap["rect"]], "通过接触孔和 M1 将体端固定到电源；这是体接触，不是逻辑晶体管。", tap["net"])
    for gate in spec["gates"]:
        rects = [[gate["x"]-spec["polyWidth"]/2, gate["top"], spec["polyWidth"], gate["bottom"]-gate["top"]]]
        for device in [d for d in spec["devices"] if d["gate"] == gate["net"]]:
            active = next(a for a in spec["active"] if a["layer"] == ("PAA" if device["type"] == "pmos" else "NAA"))
            r = [gate["x"]-spec["polyWidth"]/2, active["rect"][1], spec["polyWidth"], active["rect"][3]]
            rects = [piece for rect in rects for piece in subtract_rect(rect, r)]
            add(device["id"], f'{device["name"]} · {device["type"].upper()}', "POLY", [r],
                f'栅 {device["gate"]}；源 {device["source"]}；漏 {device["drain"]}；体 {device["body"]}。该栅位于多晶硅与有源区交叠处。', device["gate"], device=device)
            add(f'oxide-{device["id"]}', f'{device["name"]} 栅氧', "OXIDE", [r], "栅与沟道之间的绝缘层。厚度仅为教学显示参数。", list=False, planar=False)
        add(gate["id"], f'{gate["net"]} · 多晶硅', "POLY", rects, "连续多晶硅将同一输入接到上下两只 MOS 的栅。与 M1 交叉而没有接触孔时不连接。", gate["net"])
    for net, paths in spec["wires"].items():
        paths = ([spec["rails"][net]] if net in spec["rails"] else []) + paths
        rects = [rect for path in paths for rect in wire_rects(path, spec["metalWidth"])]
        merged = []
        for rect in rects:
            pieces = [rect]
            for existing in merged:
                pieces = [part for piece in pieces for part in subtract_rect(piece, existing)]
            merged.extend(pieces)
        # 去除转弯处重复体积，避免三维共面闪烁及二维透明叠色。
        add(f'metal-{net}', f'{net} · M1', "M1", merged, "同层相接的金属连通；金属与有源区之间通过接触孔连接。所有金属均为 M1，以标签区分网络。", net, paths=paths)
    for net, points in spec["contacts"].items():
        size = spec["contactSize"]
        add(f'contact-{net}', f'{net} · 接触孔', "CONTACT", [[x-size/2,y-size/2,size,size] for x,y in points], "深色方孔表示有源区到 M1 的接触连接；不表示 M1/M2 通孔。", net)
    # 从下到上绘制，接触孔最后显示，保证其连接语义在二维中可辨认。
    order = list(spec["layers"])
    entities.sort(key=lambda e: (order.index(e["layer"]) if e["layer"] != "CONTACT" else len(order)))
    result["entities"] = entities
    return result
