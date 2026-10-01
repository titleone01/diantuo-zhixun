"use client";

import { componentLibrary } from "./catalog";
import { libraryScope } from "./library-scope";

export function DeviceLibrary({
  onPickUp,
  onAdd,
}: {
  onPickUp: (assetId: string, x: number, y: number) => void;
  onAdd: (assetId: string) => void;
}) {
  return (
    <aside className="component-library" aria-label="器件库">
      <header>
        <b>器件库</b>
        <span>导轨器件自动吸附；按钮按螺钉安装</span>
        <span>开发预览 · 正式标定尚未完成</span>
      </header>
      <div className="component-library-list">
        {libraryScope.map((group) => (
          <section key={group.id} data-library-category={group.id} style={{ display: "grid", gap: 6 }}>
            <h3 style={{ margin: 0, fontSize: 12, color: "#263744" }}>{group.name}</h3>
            <p style={{ margin: 0, color: "#5e6e79", fontSize: 10, lineHeight: 1.5 }}>{group.description}</p>
            {group.status && (
              <button type="button" disabled aria-label={`${group.name}：${group.status === "board" ? "板面已配置" : "待标定，暂不可添加"}`}
                style={{ border: "1px dashed #aab7c1", borderRadius: 6, padding: "6px 8px", textAlign: "left", fontSize: 10, color: "#627280", background: "#e8edf0", cursor: "not-allowed" }}>
                {group.status === "board" ? "板面已配置" : group.status === "interface" ? "当前为外部接口 · 模型待标定" : "待选型 / 待标定 · 暂不可添加"}
              </button>
            )}
            {group.assetIds?.map((assetId) => componentLibrary.find((item) => item.assetId === assetId)).filter((asset) => asset !== undefined).map((asset) => (
          <button
            type="button"
            className={`component-library-item asset-${asset.category}`}
            key={asset.assetId}
            data-asset-id={asset.assetId}
            aria-label={`开发预览：添加 ${asset.manufacturer} ${asset.model} ${asset.name}`}
            title="既有开发资产：可以验证放置与接线，尚未通过全部正式标定门禁。"
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
            <em>开发预览 · 待标定</em>
          </button>
            ))}
          </section>
        ))}
      </div>
      <footer>仅列出当前训练范围。待标定品类不可拖入；既有模型保留供开发验证，不代表正式器件验收通过。</footer>
    </aside>
  );
}
