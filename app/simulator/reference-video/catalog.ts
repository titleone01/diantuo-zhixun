import type { CircuitDocument } from '../core/types';

/** Confirmed /diagram/list records, 2026-09-30. No authentication data. */
export type ReferenceVideo = { diagramId: number; title: string; url: string | null };
export const REFERENCE_VIDEOS: readonly ReferenceVideo[] = [
  {
    "diagramId": 32,
    "title": "自动往返电动机控制电路",
    "url": "https://dpv.videocc.net/ee5fd62b6f/3/ee5fd62b6fbbbea48e79221c8986a363_1.mp4?pid=1778818420649X1827838"
  },
  {
    "diagramId": 31,
    "title": "时间继电器控制的顺序起动电路",
    "url": "https://dpv.videocc.net/ee5fd62b6f/5/ee5fd62b6f2261a55146c8c056fc5585_1.mp4?pid=1778818397778X1255758"
  },
  {
    "diagramId": 29,
    "title": "星三角降压启动电路五",
    "url": "https://dpv.videocc.net/ee5fd62b6f/6/ee5fd62b6fe7214270a07f5c57ce3306_1.mp4?pid=1778818361134X1450188"
  },
  {
    "diagramId": 28,
    "title": "点动加长动混合控制电路",
    "url": "https://dpv.videocc.net/ee5fd62b6f/9/ee5fd62b6fcf8892e7bbb316e77a8ab9_1.mp4?pid=1778818486594X1761892"
  },
  {
    "diagramId": 23,
    "title": "星三角降压启动电路2",
    "url": "https://dpv.videocc.net/ee5fd62b6f/f/ee5fd62b6f22658c7b7c0e6ea9c6c16f_1.mp4?pid=1778818814777X1724657"
  },
  {
    "diagramId": 22,
    "title": "顺序启动控制电路",
    "url": "https://dpv.videocc.net/ee5fd62b6f/2/ee5fd62b6f15444164861a66c7bcdc72_1.mp4?pid=1778819506817X1137457"
  },
  {
    "diagramId": 20,
    "title": "顺序控制二个电动机启动控制电路二",
    "url": "https://dpv.videocc.net/ee5fd62b6f/1/ee5fd62b6f0b9894981f3493cf5b2af1_1.mp4?pid=1778818569288X1794077"
  },
  {
    "diagramId": 19,
    "title": "顺序控制二个电动机启动控制电路",
    "url": "https://dpv.videocc.net/ee5fd62b6f/1/ee5fd62b6f0b9894981f3493cf5b2af1_1.mp4?pid=1778818569288X1794077"
  },
  {
    "diagramId": 17,
    "title": "电动机互锁正反转",
    "url": "https://dpv.videocc.net/ee5fd62b6f/e/ee5fd62b6fd078500bddf4210150708e_1.mp4?pid=1778819618891X1971440"
  },
  {
    "diagramId": 16,
    "title": "星三角电路",
    "url": "https://dpv.videocc.net/ee5fd62b6f/0/ee5fd62b6fb88c1e07d7e33e5aecc550_1.mp4?pid=1778818517820X1632556"
  },
  {
    "diagramId": 15,
    "title": "电气互锁控制电路",
    "url": null
  },
  {
    "diagramId": 14,
    "title": "电动机自锁控制",
    "url": "https://dpv.videocc.net/ee5fd62b6f/3/ee5fd62b6f92883ce887cdc6737d1e83_1.mp4?pid=1778819712891X1782360"
  },
  {
    "diagramId": 13,
    "title": "电机点动控制电路",
    "url": "https://dpv.videocc.net/ee5fd62b6f/8/ee5fd62b6f67fc6838764916033ec798_1.mp4?pid=1778819680524X1598935"
  },
  {
    "diagramId": 12,
    "title": "双开关控制照明电路",
    "url": null
  },
  {
    "diagramId": 11,
    "title": "电度表接线与照明电路",
    "url": null
  },
  {
    "diagramId": 3,
    "title": "小车位置控制自动往返",
    "url": "https://dpv.videocc.net/ee5fd62b6f/c/ee5fd62b6f638a43713714ffb416afcc_1.mp4?pid=1778818537934X1006388"
  },
  {
    "diagramId": 2,
    "title": "按钮和接触器双重联锁正反转",
    "url": "https://dpv.videocc.net/ee5fd62b6f/d/ee5fd62b6fc1c6e80346ce3790c3bdfd_1.mp4?pid=1778818439520X1351301"
  },
  {
    "diagramId": 1,
    "title": "三相异步电动机正反转",
    "url": "https://dpv.videocc.net/ee5fd62b6f/f/ee5fd62b6ff5f7857bb70cad8582eccf_1.mp4?pid=1778818456671X1569565"
  }
];

// These four mappings were explicitly confirmed. Do not infer mappings for the ten new courses.
export const LESSON_REFERENCE_DIAGRAMS: Readonly<Record<string, number>> = {
  'motor-jog': 13, 'motor-self-hold': 14, 'lighting-two-way': 12, 'lighting-single': 11,
};
export function referenceVideoForDiagram(diagramId: number): ReferenceVideo | undefined {
  return REFERENCE_VIDEOS.find(item => item.diagramId === diagramId);
}
export function referenceVideoForLesson(lessonId?: string): ReferenceVideo | undefined {
  const diagramId = lessonId ? LESSON_REFERENCE_DIAGRAMS[lessonId] : undefined;
  return diagramId === undefined ? undefined : referenceVideoForDiagram(diagramId);
}

/** Uploaded drawings and member course projects never inherit a legacy reference video. */
type ReferenceVideoDocument = Pick<CircuitDocument, 'lessonId' | 'referenceDiagramId' | 'drawingMediaId' | 'drawingMediaType' | 'drawingKind' | 'trainingProjectId' | 'projectDrawings'>;
const hasPrivateDrawing = (document: ReferenceVideoDocument, hasDrawing: boolean) => hasDrawing || document.drawingMediaId !== undefined || document.drawingMediaType !== undefined || document.drawingKind !== undefined || document.trainingProjectId !== undefined || document.projectDrawings !== undefined;

export function referenceLessonForDocument(document: ReferenceVideoDocument, hasDrawing = false): string | undefined {
  if (hasPrivateDrawing(document, hasDrawing) || document.referenceDiagramId !== undefined) return undefined;
  return document.lessonId;
}

/** Explicit public references take precedence, but never override a private/project preview. */
export function referenceVideoForDocument(document: ReferenceVideoDocument, hasDrawing = false): ReferenceVideo | undefined {
  if (hasPrivateDrawing(document, hasDrawing)) return undefined;
  if (document.referenceDiagramId !== undefined) return referenceVideoForDiagram(document.referenceDiagramId);
  return referenceVideoForLesson(document.lessonId);
}
