import './styles/main.css';
import { initFilm } from './lib/film';
import { initHelmet } from './lib/helmet';
import { initCopy, initNav, initScenes } from './lib/scenes';

const hero = document.getElementById('hero')!;
const armor = document.getElementById('armor')!;

let scenes: ReturnType<typeof initScenes> | null = null;
const film = initFilm(hero, () => scenes?.setActive());
scenes = initScenes({ visor: () => film.info().visor });
film.ready.then(() => scenes?.refresh());
const helmet = initHelmet(armor);
initNav();
initCopy();

// handy for tests and for trying the release from the console
(window as unknown as { __helmet: typeof helmet }).__helmet = helmet;
