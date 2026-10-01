/** Public reference drawings, independent of course assessment and private media. */
export type ReferenceDrawing = {
  id: number;
  title: string;
  imageFilename: string;
  category: "industrial" | "lighting";
  level: "basic" | "intermediate" | "advanced";
};

export const REFERENCE_DRAWINGS: readonly ReferenceDrawing[] = [
  { id: 32, title: "自动往返电动机控制电路", imageFilename: "reference-32.png", category: "industrial", level: "intermediate" },
  { id: 31, title: "时间继电器控制的顺序起动电路", imageFilename: "reference-31.png", category: "industrial", level: "intermediate" },
  { id: 29, title: "星三角降压启动电路五", imageFilename: "reference-29.png", category: "industrial", level: "advanced" },
  { id: 28, title: "点动加长动混合控制电路", imageFilename: "reference-28.png", category: "industrial", level: "basic" },
  { id: 23, title: "星三角降压启动电路2", imageFilename: "reference-23.png", category: "industrial", level: "advanced" },
  { id: 22, title: "顺序启动控制电路", imageFilename: "reference-22.png", category: "industrial", level: "advanced" },
  { id: 20, title: "顺序控制二个电动机启动控制电路二", imageFilename: "reference-20.png", category: "industrial", level: "intermediate" },
  { id: 19, title: "顺序控制二个电动机启动控制电路", imageFilename: "reference-19.png", category: "industrial", level: "intermediate" },
  { id: 17, title: "电动机互锁正反转", imageFilename: "reference-17.png", category: "industrial", level: "intermediate" },
  { id: 16, title: "星三角电路", imageFilename: "reference-16.png", category: "industrial", level: "intermediate" },
  { id: 15, title: "电气互锁控制电路", imageFilename: "reference-15.png", category: "industrial", level: "basic" },
  { id: 14, title: "电动机自锁控制", imageFilename: "motor-self-hold.png", category: "industrial", level: "basic" },
  { id: 13, title: "电机点动控制电路", imageFilename: "motor-jog.png", category: "industrial", level: "basic" },
  { id: 3, title: "小车位置控制自动往返", imageFilename: "reference-3.jpg", category: "industrial", level: "intermediate" },
  { id: 2, title: "按钮和接触器双重联锁正反转", imageFilename: "reference-2.jpg", category: "industrial", level: "intermediate" },
  { id: 1, title: "三相异步电动机正反转", imageFilename: "reference-1.jpg", category: "industrial", level: "intermediate" },
  { id: 12, title: "双开关控制照明电路", imageFilename: "lighting-two-way.png", category: "lighting", level: "intermediate" },
  { id: 11, title: "电度表接线与照明电路", imageFilename: "lighting-single.png", category: "lighting", level: "intermediate" },
];

export function getReferenceDrawing(id: number): ReferenceDrawing | undefined {
  return REFERENCE_DRAWINGS.find(drawing => drawing.id === id);
}

/** The base belongs to the caller's build environment; the filename is allowlisted. */
export function referenceDrawingImageUrl(id: number, base = "/"): string | undefined {
  const drawing = getReferenceDrawing(id);
  if (!drawing) return undefined;
  return `${base.replace(/\/?$/, "/")}sim-assets/${drawing.imageFilename}`;
}
