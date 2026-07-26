# StudyLoop

StudyLoop is a source-grounded AI study workspace for university STEM students. It builds module maps, lessons, practice questions, and mock exams from lecture PDFs while retaining source references and applying deterministic checks to numerical work.

## Local development

Requirements: a current Node.js LTS release and a Firebase project with anonymous authentication and Firestore enabled.

1. Copy `.env.example` to `.env.local`.
2. Fill in the Firebase client and server project values.
3. Install dependencies with `npm install`.
4. Run `npm run dev`.

For explicitly unauthenticated local API development, set `ALLOW_LOCAL_UNAUTHENTICATED=true`. The API rejects this mode in production.

## Validation

- `npm test` runs the unit and security regression suite.
- `npm run build` creates the production bundle.
- `npm run check` runs both.
- `npm audit` should report no known dependency vulnerabilities before deployment.

## Security and privacy

- Firestore access is restricted to `users/{uid}` by `firestore.rules`.
- API routes verify Firebase ID tokens and fail closed if production authentication is not configured.
- Student-provided Gemini keys are kept only in `sessionStorage` and are removed when the browser session ends.
- Uploaded PDFs stay in the browser's IndexedDB. Cloud records contain PDF metadata, not PDF bytes.
- AI output is validated before becoming curriculum, lesson, question, grading, calculation, or visual data.
- Generated Mermaid SVG is rendered in strict mode and sanitized before insertion.
- Production response headers are defined in `vercel.json`.

Do not log API keys, authorization headers, uploaded documents, or full student answers. Treat all uploaded and student-authored text as untrusted input to AI prompts.

## Architecture

- `App.jsx`: application shell and feature screens.
- Domain modules such as `practiceEngine.js`, `studyEngine.js`, `gradebook.js`, and `validation.js`: deterministic learning and validation logic.
- `studyStore.js` and `localPdfStore.js`: local IndexedDB persistence.
- `AuthContext.jsx` and `firebase.js`: authentication and cloud settings.
- `api/`: authenticated serverless provider and content-resolution routes.

New business logic should be added to a focused domain module with tests rather than expanding `App.jsx`. Feature UI should be extracted into `features/<feature>` as it is changed.

## Deployment checklist

- Configure `FIREBASE_PROJECT_ID`; missing production authentication makes the API return 503.
- Deploy `firestore.rules`.
- Confirm anonymous authentication is enabled.
- Configure provider keys or document session-only BYOK usage.
- Run `npm run check` and `npm audit`.
- Verify CSP headers and critical upload, lesson, practice, and exam journeys in the deployed environment.
