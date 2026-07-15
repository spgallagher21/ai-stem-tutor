import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return <main className="app-shell"><section className="container narrow card" style={{ padding: 28 }}><h1 className="heading">StudyLoop hit a problem</h1><p className="muted">Your saved modules are still available. Refresh the page to continue.</p><button className="btn" onClick={() => window.location.reload()}>Refresh StudyLoop</button></section></main>;
  }
}
