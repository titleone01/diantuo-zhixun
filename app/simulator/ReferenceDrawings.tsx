import CourseLibrary from './CourseLibrary';
import type { Project } from './TrainingProjects';

export default function ReferenceDrawings({ onProjectPractice }: { onProjectPractice: (project: Project, wired: boolean) => void }) {
  return <main className="dt-reference-library"><h2>课程图纸 · 10 个接线课程</h2><CourseLibrary onPractice={onProjectPractice}/></main>;
}
