# Workout Connect — Body Battery Sandbox

本目录包含一个 **可解释的 Body Battery（BB）主干模型** + 一个 **离线测试网页**，用于输入模拟数据并推算：

- `Reserve(BB)`（能力储备度 / 主曲线）
- `Comfort`（身体舒适度）
- `Fatigue`（疲劳度）

## 快速开始（推荐：本地静态服务器）

1. 启动本地 server：

```bash
node server.js
```

2. 打开测试页：

- `http://127.0.0.1:8787/web/body-battery-test.html`

## 直接打开 HTML（不启 server 也可以）

用浏览器直接打开：`web/body-battery-test.html`

## 代码位置

- 目标定义：`docs/body-battery.md`
- 主干模型（Layer B + 质量门控/动态权重的规则先验）：`src/bodyBatteryModel.js`
- 测试页：`web/body-battery-test.html`、`web/app.js`

## Apple Health 导入（测试页）

测试页新增「Apple Health 导入」Tab：

- 选择 Apple Health 导出的 `export.xml`（如果拿到的是 `export.zip`，请先解压后再选 `export.xml`）
- 或选择 HealthExportCSV 导出的多个 `*.csv` 文件（可多选；如为 ZIP 也需先解压）
- 设置本地开始/结束时间
- 点击「导入到 JSON」或「导入并计算 BB」

## 输入格式（JSON）

测试页支持粘贴 JSON：

```json
{
  "epochMinutes": 5,
  "initialBB": 70,
  "behaviorBaseline": { "enabled": true, "days": 10 },
  "baselines": { "rhrBpm": 60, "hrvSdnnMs": 55, "spo2Pct": 97, "respRateBrpm": 14, "wristTempC": 36.55 },
  "epochs": [
    { "timestampMs": 1730000000000, "hrBpm": 58, "sleepStage": "core", "steps": 0, "activeEnergyKcal": 0 }
  ]
}
```

说明：

- `epochs` 的最小单位是 **epoch**（例如 5 分钟）；模型会按时间排序计算。
- 缺失项可以省略或写 `null`；模型会通过质量分与门控降权。
- `sleepStage` 建议使用：`deep` / `core` / `rem` / `inBed` / `awake`
- `behaviorBaseline`（可选）：当 `enabled=true` 且数据覆盖至少 `days` 天时，模型会用前 `days` 天游程构建睡眠/训练等“个人行为基线”，并从第 `days+1` 天游程起动态调整动作对 BB 的影响幅度。
