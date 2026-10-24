import type {Authorization,Budget} from './evaluation.ts';import type {PiProvider} from './pi-adapter.mjs';
export function evaluationProvider(authorization:Authorization,apiKey:string,budget:Budget,options?:{transport?:typeof fetch}):PiProvider;
