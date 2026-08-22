// PRISM TV - theme engine. Every visual token lives in CSS custom properties
// and every rule consumes them, so switching themes actually works.

import { state, patch } from './state.js';

export const ACCENTS = {
  indigo: '#6366f1',
  cyan: '#22d3ee',
  violet: '#a78bfa',
  lime: '#a3e635',
  amber: '#fbbf24',
  rose: '#fb7185',
};

export function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  const accent = ACCENTS[state.accent] || ACCENTS.indigo;
  document.documentElement.style.setProperty('--accent', accent);
  // readable text color on accent-filled buttons
  document.documentElement.style.setProperty('--on-accent', pickText(accent));
}

function pickText(hex) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 150 ? '#0b0d12' : '#ffffff';
}

export function setTheme(theme) { patch({ theme }); applyTheme(); }
export function setAccent(accent) { patch({ accent }); applyTheme(); }
