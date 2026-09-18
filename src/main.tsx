import ReactDOM from 'react-dom/client';
import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow/latin-600.css';
import '@fontsource/barlow-condensed/latin-500.css';
import '@fontsource/barlow-condensed/latin-600.css';
import './ui/styles.css';

const root = ReactDOM.createRoot(document.getElementById('root')!);
if (import.meta.env.DEV && new URLSearchParams(location.search).has('propellerPlayground')) {
  void import('./ui/shipbuilding/propeller-playground/PropellerPlayground').then(({ default: Playground }) => root.render(<Playground />));
} else if (import.meta.env.DEV && new URLSearchParams(location.search).has('hullPrototype')) {
  void import('./ui/shipbuilding/hull-prototype/HullPrototype').then(({ default: HullPrototype }) => root.render(<HullPrototype />));
} else {
  void import('./ui/AccountGate').then(({ AccountGate }) => root.render(<AccountGate />));
}
