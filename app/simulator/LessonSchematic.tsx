import { getLesson } from './core/lessons';
/** Original reference-site diagram, kept as a local image rather than redrawn. */
export default function LessonSchematic({ lessonId = 'motor-jog', compact = false }: { lessonId?: string; compact?: boolean }) {
  const base = import.meta.env.BASE_URL || '/';
  const supported = ['motor-jog','motor-self-hold','lighting-single','lighting-two-way'].includes(lessonId);
  return <div className={`dt-schematic ${compact ? 'compact' : ''}`}>
    {supported ? <img src={`${base}sim-assets/${lessonId}.png`} alt={`${getLesson(lessonId)?.title || '电路'}原站参考图`} draggable={false}/> : <span>暂无原理图</span>}
  </div>;
}
