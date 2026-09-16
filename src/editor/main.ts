/**
 * Editor entry point. Placeholder shell: the editor worker replaces the body
 * of this file (and owns everything under `src/editor/`).
 */
import '../styles/base.css';

const app = document.getElementById('app');
if (app) {
  app.style.cssText = 'display:grid;place-items:center;height:100vh;color:var(--text-dim);font-size:18px;';
  app.textContent = 'Editor loading...';
}
