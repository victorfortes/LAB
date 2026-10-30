import { Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';

/** Se a interface quebrar, nunca fica tela em branco: mostra o erro e permite recarregar. */
class Boundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div style={{ maxWidth: 560, margin: '12vh auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
        <h2 style={{ marginTop: 0 }}>A tela encontrou um erro</h2>
        <p>Seus dados estão salvos. Recarregue a página; se repetir, envie esta mensagem ao suporte:</p>
        <pre style={{ whiteSpace: 'pre-wrap', background: '#f3f5f9', padding: 12, borderRadius: 6 }}>{String(this.state.err.message)}</pre>
        <button onClick={() => location.reload()} style={{ height: 38, padding: '0 16px' }}>Recarregar</button>
      </div>
    );
  }
}

createRoot(document.getElementById('root')!).render(<Boundary><App /></Boundary>);

// Brilho âmbar que acompanha o mouse nos cartões (como no NGA Lab).
document.addEventListener('mousemove', (e) => {
  const el = (e.target as HTMLElement | null)?.closest?.('.st, .panel, .sug, .sec') as HTMLElement | null;
  if (!el) return;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--mx', `${e.clientX - r.left}px`); el.style.setProperty('--my', `${e.clientY - r.top}px`);
});
