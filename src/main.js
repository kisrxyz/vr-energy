/* Точка входа. Вся логика приложения — src/app.js. Карта проекта — в CLAUDE.md. */
import './styles.css';
import { Diag } from './ui/diag.js';
import { app } from './app.js';
import { TYPES } from './core/elements.js';
import { SAMPLES } from './core/samples.js';
import { Trainer, buildTopo, compute } from './core/engine.js';
import * as Plan from './core/plan.js';
import * as ExamCore from './core/exam.js';

// Журнал ошибок (справка → «Журнал ошибок») — до запуска приложения, чтобы поймать и ошибки старта
Diag.install();
// Для отладки и автотестов: в консоли браузера доступно TS.app, TS.app.tr и т.д.
window.TS = { app, Trainer, SAMPLES, TYPES, buildTopo, compute, Diag, Plan, ExamCore };
app.init();
