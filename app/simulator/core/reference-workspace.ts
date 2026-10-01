import type { CircuitComponent, CircuitDocument, ComponentType } from './types';
import { getReferenceDrawing } from './reference-drawings';

/** Choosing a reference changes the teaching context, never the electrical graph. */
export function selectReferenceDrawing(document: CircuitDocument, id: number): CircuitDocument {
  if (!getReferenceDrawing(id)) throw new Error('未找到此参考图纸');
  if (document.referenceDiagramId === id) return document;
  const { lessonId, roles, drawingMediaId, drawingMediaType, projectDrawings, drawingKind, trainingProjectId, ...graph } = document;
  return { ...graph, referenceDiagramId: id };
}

/** Source configuration entry uses the same unwired starter objects for every drawing. */
export function createReferenceDocument(id: number): CircuitDocument {
  const drawing = getReferenceDrawing(id);
  if (!drawing) throw new Error('未找到此参考图纸');
  const components: CircuitComponent[] = [];
  // Public source module 53707, desktop layout (Mh.laptop = 3).
  const items: [string, ComponentType, string, number, number][] = [
    ['source', 'supply', '电源', 0, 0], ['qs', 'knife-switch3', 'QS1', 0, 202],
    ['fu1', 'fuse3', 'FU1', 0, 693.5], ['km', 'contactor380', 'KM1', 0, 1062.3],
    ['motor', 'motor', 'M1', -150, 1433.5], ['fu2', 'fuse', 'FU2', 600, 693.5],
    ['sb', 'push-nc', 'SB1', 390, 1062.3],
  ];
  for (const [componentId, type, label, x, y] of items) components.push({ id: componentId, type, label, position: { x, y } });
  return { schemaVersion: 1, title: drawing.title, referenceDiagramId: id, components, wires: [] };
}

