export const TUTORIAL_STEPS = [
  { target: "addModule", interaction: true, screen: "dashboard", title: "Create your first module", body: "Click the highlighted button to start with a real university module." },
  { target: "moduleName", screen: "add", title: "Name the module", body: "Use the course name you recognise from your timetable. The module code and semester are optional." },
  { target: "fileUpload", screen: "add", title: "Add your lecture notes", body: "Upload one or more lecture-note PDFs. These become the source for lessons and practice questions." },
  { target: "examUpload", screen: "add", title: "Past papers are optional", body: "Add past papers or problem sets if you have them. They guide question style and mark structure." },
  { target: "buildCurriculum", interaction: true, screen: "add", title: "Build the module", body: "When the name and lecture notes are ready, click the highlighted button. The tour will resume inside your real module." },
  { target: "subtopicCard", screen: "subject", title: "Choose a class-sized lesson", body: "Your PDFs are organised into topics and smaller lessons. Open one to generate source-grounded notes and practice." },
  { target: "askNotes", screen: "subject", title: "Ask your uploaded notes", body: "Use this whenever a lecture explanation is unclear. Answers cite the source file and page whenever possible." },
  { target: "moduleExam", screen: "subject", title: "Build a focused exam", body: "Choose any topics from this module. Past papers guide the format, while your lecture notes control what can be tested." },
  { target: "deadlines", screen: "dashboard", title: "Plan around real deadlines", body: "Add assignments, tests, and exams here. StudyLoop works backwards to suggest manageable study sessions." },
  { target: "pomodoro", screen: "dashboard", title: "Use the focus timer", body: "Adjust the focus and break length, then run a study session without leaving the dashboard." },
  { target: "settings", screen: "dashboard", title: "You are ready", body: "Settings contains study modes, appearance, GPA scale, privacy tools, and the option to replay this tour." },
];

export const tutorialStepFor = (target) => TUTORIAL_STEPS.findIndex((step) => step.target === target);

export function tutorialScreenForStep(step) {
  return TUTORIAL_STEPS[step]?.screen || "dashboard";
}
