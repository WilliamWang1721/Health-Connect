# v0.2.0 — 三内核模式（实验）& 趋势预测

本版本引入 **三内核模式**：在不破坏现有可解释主干（Core）的前提下，增加一个基于历史数据训练的轻量趋势内核（Trend），并用第三内核（Hybrid）按权重融合两者输出（默认 **90% : 10%**）。

> 目标：在保持“像 Garmin 一样稳定可解释”的同时，让 BB 在长期趋势、个体节律上更贴合真实数据；并支持可选的短期预测（实验）。

## 亮点

- **Core（内核 1）**：完全沿用现有规则主干，对输入 epoch 逐步推算 BB。
- **Trend（内核 2）**：分析前序数据（含“睡眠概率基线”等节律特征），训练一个轻量神经网络来预测下一步 BB 变化趋势。
- **Hybrid（内核 3）**：将 Core 与 Trend 进行加权融合（默认 `weightCore=0.9`、`weightTrend=0.1`），输出最终 BB。

## 新增能力

### 1) 新 API：`computeSeriesThreeKernel(cfg)`

- 开启后会在每个 epoch 行上额外输出：
  - `bbCoreNext`：规则主干输出（Core）
  - `bbTrendNext`：趋势内核输出（Trend）
  - `bbNext`：融合输出（Hybrid）
- 结果对象新增：
  - `summaryCore`：融合前（纯 Core）汇总
  - `threeKernel`：训练状态、权重、预测配置等元信息

### 2) 可选预测（Forecast，实验）

- `threeKernel.forecastHours > 0` 时，会在序列尾部追加 `context.kind = "FORECAST"` 的预测行（目前仅提供 Reserve/BB 预测，不推 Comfort/Fatigue）。

## 测试页更新

- 新增「Three-kernel mode」参数面板：开关、权重、预测时长。
- Tooltip 支持显示 `Core` / `Trend` / `Reserve(Hybrid)`，便于对比与调参。

## 配置示例（JSON）

```json
{
  "epochMinutes": 5,
  "initialBB": 70,
  "threeKernel": {
    "enabled": true,
    "weightCore": 0.9,
    "weightTrend": 0.1,
    "forecastHours": 0
  },
  "epochs": []
}
```

## 兼容性说明

- 默认行为不变：不启用 `threeKernel` 时仍走 `computeSeries(cfg)`，输出与之前保持一致。
- 启用三内核时，`bb/bbNext` 会变为融合后的值；纯主干值仍可通过 `bbCore/bbCoreNext` 获取。

## 注意事项 / 已知限制

- Trend 训练需要足够的历史样本；样本不足时会退化为基于“日内 bin 均值”的简单趋势。
- 预测行仅用于实验与可视化，不建议用于严肃决策；且目前不预测 Comfort/Fatigue。

## 验证

本版本新增并通过：

- `node scripts/three-kernel-smoke-test.js`
- `node scripts/model-smoke-test.js`
- `node scripts/behavior-baseline-smoke-test.js`

