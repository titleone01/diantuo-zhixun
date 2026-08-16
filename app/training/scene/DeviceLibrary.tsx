"use client";

import { componentLibrary } from "./catalog";

const categoryName = {
  "terminal-block": "接线端子",
  "circuit-breaker": "低压断路器",
  contactor: "交流接触器",
} as const;

export function DeviceLibrary({
  onPickUp,
  onAdd,
}: {
  onPickUp: (assetId: string, x: number, y: number) => void;
  onAdd: (assetId: string) => void;
}) {
  return (
    <aside className="component-library" aria-label="电气器件库">
      <header>
        <b>电气器件库</b>
        <span>单击放到空位，或拖到目标导轨</span>
      </header>
      <div className="component-library-list">
        {componentLibrary.map((asset) => (
          <button
            type="button"
            className={`component-library-item asset-${asset.category}`}
            key={asset.assetId}
            data-asset-id={asset.assetId}
            aria-label={`添加 ${asset.manufacturer} ${asset.model} ${asset.name}`}
            onClick={() => onAdd(asset.assetId)}
            onPointerDown={(event) => {
              event.preventDefault();
              onPickUp(asset.assetId, event.clientX, event.clientY);
            }}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "copy";
              event.dataTransfer.setData("application/x-electrical-asset", asset.assetId);
              event.dataTransfer.setData("text/plain", asset.assetId);
            }}
          >
            <i aria-hidden="true"><span /></i>
            <span><b>{asset.model}</b><small>{asset.name}</small></span>
            <em>{categoryName[asset.category]}</em>
          </button>
        ))}
      </div>
      <footer>库定义与场景实例完全分离，可持续增加正泰及其他品牌模型。</footer>
    </aside>
  );
}
