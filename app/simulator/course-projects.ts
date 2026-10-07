import projectNames from '../../shared/training-projects.json';
import { isSelectableLesson } from './core/lessons';
import type { Project } from './TrainingProjects';

/** Public course metadata only: private media is supplied by the member API. */
export const COURSE_PROJECTS: Project[] = projectNames.map(project => ({
  id: project.id, name: project.name, title: project.name,
  lessonId: `motor-course-${project.id.slice(-2)}`,
  drawingStatus: 'pending', updatedAt: null, media: null,
}));

export const selectableProjects = (projects: Project[]) => projects.filter(project =>
  COURSE_PROJECTS.some(course => course.id === project.id) && isSelectableLesson(project.lessonId));
