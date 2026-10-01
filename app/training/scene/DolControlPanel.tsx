"use client";

import { useState } from "react";
import { useWiringSceneStore } from "./store";

function MomentaryControl({ instanceId, label, disabled }: { instanceId?: string; label: string; disabled: boolean }) {
  const press = useWiringSceneStore((state) => state.pressPushbutton);
  const release = useWiringSceneStore((state) => state.releasePushbutton);
  return (
    <button
      type="button"
      disabled={disabled || !instanceId}
      onPointerDown={(event) => {
        if (!instanceId || event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        press(instanceId);
      }}
      onPointerUp={() => instanceId && release(instanceId)}
      onPointerCancel={() => instanceId && release(instanceId)}
      onLostPointerCapture={() => instanceId && release(instanceId)}
      onBlur={() => instanceId && release(instanceId)}
      onKeyDown={(event) => {
        if (event.key !== " " && event.key !== "Enter") return;
        event.preventDefault();
        if (!event.repeat && instanceId) press(instanceId);
      }}
      onKeyUp={(event) => {
        if (event.key !== " " && event.key !== "Enter") return;
        event.preventDefault();
        if (instanceId) release(instanceId);
      }}
    >{label}</button>
  );
}

export function DolControlPanel() {
  const [confirmingPower, setConfirmingPower] = useState(false);
  const instances = useWiringSceneStore((state) => state.instances);
  const powerState = useWiringSceneStore((state) => state.powerState);
  const contactorEngaged = useWiringSceneStore((state) => state.contactorEngaged);
  const motorRunning = useWiringSceneStore((state) => state.motorRunning);
  const overloadTripped = useWiringSceneStore((state) => state.overloadTripped);
  const protectiveEarthConnected = useWiringSceneStore((state) => state.protectiveEarthConnected);
  const phaseAtMotor = useWiringSceneStore((state) => state.phaseAtMotor);
  const dangers = useWiringSceneStore((state) => state.dangers);
  const warnings = useWiringSceneStore((state) => state.warnings);
  const assessment = useWiringSceneStore((state) => state.wiringAssessment);
  const assessmentVisible = useWiringSceneStore((state) => state.assessmentVisible);
  const confirmPowerOn = useWiringSceneStore((state) => state.confirmPowerOn);
  const switchPowerOff = useWiringSceneStore((state) => state.switchPowerOff);
  const resetProtection = useWiringSceneStore((state) => state.resetProtection);
  const tripOverload = useWiringSceneStore((state) => state.tripOverload);
  const resetOverload = useWiringSceneStore((state) => state.resetOverload);
  const checkWiring = useWiringSceneStore((state) => state.checkWiring);
  const toggleBreaker = useWiringSceneStore((state) => state.toggleBreaker);
  const breaker = instances.find((instance) => instance.reference === "QF1");
  const breakerClosed = breaker?.operatingState === "closed";
  const startButton = instances.find((instance) => instance.reference === "SB2");
  const stopButton = instances.find((instance) => instance.reference === "SB1");
  const powerLabel = powerState === "energized"
    ? "仿真中 · 已供电"
    : powerState === "tripped"
      ? "保护跳闸"
      : "训练电源断开";

  return (
    <aside className={`dol-control-panel is-${powerState}`} aria-label="DOL 直接启动运行控制">
      <header><b>DOL 直接启动</b><span>三相 380V · 2.2kW · NC1-0910 / NRE8-25</span></header>
      <div className="dol-state-grid">
        <span className={powerState === "energized" ? "is-on" : powerState === "tripped" ? "is-danger" : ""}><i />电源<em>{powerLabel}</em></span>
        <span className={breakerClosed ? "is-on" : ""}><i />QF1<em>{breakerClosed ? "ON" : "OFF"}</em></span>
        <span className={contactorEngaged ? "is-on" : ""}><i />KM1<em>{contactorEngaged ? "吸合" : "释放"}</em></span>
        <span className={overloadTripped ? "is-danger" : "is-on"}><i />FR1<em>{overloadTripped ? "已动作" : "正常"}</em></span>
        <span className={motorRunning ? "is-running" : ""}><i />M1<em>{motorRunning ? "运行" : "停止"}</em></span>
        <span className={protectiveEarthConnected ? "" : "is-danger"}><i />PE1<em>{protectiveEarthConnected ? "端子内导通" : "端子未导通"}</em></span>
      </div>
      <div className="dol-motor-interface">
        <b>M1 外部电机接口</b>
        <span>X2：L1/L2/L3 → U/V/W</span>
        <span>相序：{phaseAtMotor.join(" / ")} · 外部接地未验</span>
      </div>
      <div className="dol-actions">
        {powerState === "off" && <button type="button" className="primary" onClick={() => setConfirmingPower(true)}>开始仿真</button>}
        {powerState === "energized" && <button type="button" onClick={switchPowerOff}>结束仿真 / 断电</button>}
        {powerState === "tripped" && <button type="button" className="danger" onClick={resetProtection}>复位保护</button>}
        <button type="button" disabled={!breaker} onClick={() => breaker && toggleBreaker(breaker.id)}>QF1 {breakerClosed ? "分闸" : "合闸"}</button>
        <MomentaryControl instanceId={startButton?.id} label="SB2 启动（按住）" disabled={powerState !== "energized" || overloadTripped} />
        <MomentaryControl instanceId={stopButton?.id} label="SB1 停止（按住）" disabled={powerState !== "energized"} />
        <button type="button" disabled={powerState !== "energized" || overloadTripped} onClick={tripOverload}>教学过载测试</button>
        <button type="button" disabled={!overloadTripped} onClick={resetOverload}>FR1 RESET</button>
        <button type="button" onClick={checkWiring}>检查标准答案</button>
      </div>
      {dangers.length > 0 && <div className="dol-alert danger" role="alert"><b>{powerState === "tripped" ? "短路 / 保护提醒：已切断仿真电源" : "危险接线"}</b>{dangers.map((danger) => <span key={danger}>{danger}</span>)}</div>}
      {warnings.length > 0 && <div className="dol-alert"><b>运行提示</b>{warnings.map((warning) => <span key={warning}>{warning}</span>)}</div>}
      {assessmentVisible && (
        <div className={`dol-assessment ${assessment.correct ? "is-correct" : ""}`}>
          <b>标准答案 {assessment.completed}/{assessment.total}</b>
          <span>{assessment.correct ? "主回路、控制回路和自锁支路均正确" : `缺少 ${assessment.missing.length} · 多余 ${assessment.unexpected.length} · 线类错误 ${assessment.wrongKinds.length}`}</span>
          <small>标准答案评分不限制安全非标准接线上电。</small>
        </div>
      )}
      {confirmingPower && (
        <div className="dol-confirm-layer" role="dialog" aria-modal="true" aria-label="开始接线仿真">
          <div className="dol-confirm-card">
            <b>开始接线仿真</b>
            <p>系统会检查相间短路、对地短路和保护触点短接。上电后合上 QF1，再按住 SB2 启动；松开 SB2 可验证自锁，按 SB1 停止。合闸或启动时发现短路会立即切断仿真电源并提醒。</p>
            <div>
              <button type="button" onClick={() => setConfirmingPower(false)}>取消</button>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  confirmPowerOn();
                  setConfirmingPower(false);
                }}
              >确认上电</button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
