/* Точка входа. Вся логика приложения — src/app.js. Карта проекта — в CLAUDE.md. */
import './styles.css';
import { app } from './app.js';
import { TYPES } from './core/elements.js';
import { SAMPLES } from './core/samples.js';
import { Trainer, buildTopo, compute } from './core/engine.js';

// Для отладки и автотестов: в консоли браузера доступно TS.app, TS.app.tr и т.д.
window.TS = { app, Trainer, SAMPLES, TYPES, buildTopo, compute };
app.init();
