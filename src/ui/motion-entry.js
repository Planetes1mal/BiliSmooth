import { animate } from 'motion/mini';
import { spring } from 'motion';

// A single local animation engine shared by the page and extension surfaces.
globalThis.BiliSmoothMotion = Object.freeze({ animate, spring, version: '13.2.0' });
