import React, { lazy, Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import ErrorBoundary from './ErrorBoundary.jsx'
import './themes.css'

const App = lazy(() => import('./App.jsx'))

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary><Suspense fallback={<main className="app-shell"><div className="container card" role="status" style={{ padding: 24 }}>Loading StudyLoop…</div></main>}><App /></Suspense></ErrorBoundary>
  </React.StrictMode>,
)
