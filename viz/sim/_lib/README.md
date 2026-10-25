# evidence/_lib：共用 3D 回放

所有需要 3D 回放的本地页面都用这里的两个文件，不再每页各写一份播放器。

| 文件 | 作用 |
|---|---|
| `replay3d.js` | 播放器本体 `Replay3D.mount(容器, 选项)`：渲染、视角、时间轴、键盘、图层 |
| `replay_page.js` | 纯回放页的外壳 `ReplayPage({title, intro, cases})`，页面只需列出回合 |

## 统一操作（所有页面一样）
- 鼠标：拖动旋转，滚轮缩放，右键平移
- `W` `A` `S` `D`：前后左右移动；`Q` / `E`：下降 / 上升；按住 `Shift` 加速（按下就切到自由视角）
- `空格`：播放 / 暂停；`←` `→`：逐帧；`1`–`4`：跟随机器人 / 自由视角 / 俯视全场 / 从机器人相机看
- 按钮：完整版 / 简化版、外墙和天花板、相机视野、播放速度

## 两种数据格式
- `kind:'mujoco'`：`parent_scripts/ms2_full_export.py` 导出的 `window.CASES[key]`（带贴图的完整模型，0.1 秒一帧）
- `kind:'boxes'`：`parent_scripts/b_export2.py` 导出的 `window.CASE`（方块模型 + 体素格子，5Hz）

## 叠加图层（动作区、报警格子等）
```js
const v = Replay3D.mount(el, {scene:{kind:'boxes', data:CASE}});
v.addLayer('region', i => Replay3D.cells(CASE.frames[i].region_H2, {color:0x0aa3a3, opacity:.15}), {label:'2 秒动作区'});
v.onFrame(i => { /* 更新分数曲线、说明文字 */ });
```

## 新页面怎么做
- 纯回放：复制 `ms3_full_3d/index.html`（12 行），改 `cases`。
- 带图层、曲线的分析页：自己写外框，播放器部分调用 `Replay3D.mount` 加 `addLayer`。

## 已接入
`ms2_full_3d`、`ms3_full_3d`、`ms4_full_3d`、`ms3_review`（内嵌）。旧页（`ms1_*`）以后改到时再接入；改动前的版本存在 `evidence/archive/replay_pages_pre_lib/`。

## 拆分格式（2026-10-23）
- 回放数据分成两部分：
  - 场景文件 `evidence/_scenes/scene_<hash>.js`：网格和贴图，同一场景版本只存一份；
  - 每条回合一个文件：位姿用 int16 量化，再加上相机、阶段、`scene` 字段。
- 页面一律用 `Replay3D.loadCase(url, key)` 加载，会自动补上场景文件（ReplayPage 已经改好）。旧格式文件照样能读。
- 转换：`python3 parent_scripts/split_replay.py OUT_DIR SCENES_DIR in*.js`。远端也放了一份：4090 在 `~/dave_ms4/tmp_split_replay.py`，5090 在 `parent_scripts/split_replay.py`。
- 推荐流程：远端导出 → 远端拆分 → 用 rsync 只拉新文件（场景文件只拉一次）。
  - 例子：主要场景3 每条回合约 0.6–1MB，场景文件 9.7MB；原来每条 11MB。
