import { useState } from "react";

type Props = { numbers: string[]; target: string; disabled: boolean; onNumber: (number: string) => void };

export default function WireNumberToolbar({ numbers, target, disabled, onNumber }: Props) {
  const [custom, setCustom] = useState(numbers.length === 1 ? numbers[0] : "");
  return <form className="sim-wire-number-toolbar" aria-label="导线线号标注" onSubmit={event => { event.preventDefault(); if (!disabled) onNumber(custom); }}>
    <span className="sim-wire-number-heading">线号</span>
    <div className="sim-wire-number-choices" role="group" aria-label="线号1至10">{Array.from({ length: 10 }, (_, index) => String(index + 1)).map(number => <button key={number} type="button" aria-label={`标注线号 ${number}`} aria-pressed={numbers.length === 1 && numbers[0] === number} disabled={disabled} onClick={() => onNumber(number)}>{number}</button>)}</div>
    <input aria-label="自定义线号" placeholder="0、U1…" value={custom} disabled={disabled} maxLength={48} onChange={event => setCustom(event.target.value)} />
    <button type="submit" disabled={disabled || !custom.trim()}>标注</button>
    <button type="button" disabled={disabled || !numbers.length} onClick={() => onNumber("")}>清除</button>
    <output aria-label="当前线号目标" title={target}>{target}</output>
  </form>;
}
