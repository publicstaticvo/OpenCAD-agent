import {defineConfig} from '@playwright/test';
import base from './playwright.config.ts';
import {resolve} from 'node:path';
if(process.env.RUN_LIVE_CAD!=='1')throw new Error('真实模型测试需要 RUN_LIVE_CAD=1');
process.env.CAD_LIVE_DATA_DIR??=resolve(`.work/live-data-${Date.now()}`);
const port=process.env.CAD_LIVE_PORT??'4175';
export default defineConfig({...base,testDir:'./tests/live',outputDir:process.env.CAD_LIVE_OUTPUT_DIR??'.work/live-browser',timeout:2400000,expect:{timeout:20000},use:{...base.use,baseURL:`http://127.0.0.1:${port}`,trace:'off',screenshot:'off',video:'off'},webServer:{command:'npm run build && npx tsx scripts/live-gateway.ts',url:`http://127.0.0.1:${port}/api/health`,timeout:60000,reuseExistingServer:false,env:{PORT:port,CAD_PROVIDER:'live',CAD_ACCESS_TOKEN:'live-local-access-0123456789abcdef',CAD_MODEL_CONFIG:'',CAD_DATA_DIR:process.env.CAD_LIVE_DATA_DIR}}});
