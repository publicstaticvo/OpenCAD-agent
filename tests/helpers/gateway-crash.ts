import {RevisionStore} from '../../gateway/revision-store.ts';import {Supervisor} from '../../gateway/supervisor.ts';
import {approvedProgram} from './approved-program.ts';
const store=new RevisionStore(process.argv[2]);const s=await Supervisor.start(store,{observe(phase){if(phase==='opened')process.kill(process.pid,'SIGKILL');}});
approvedProgram(s,'plate',1,'crash',JSON.parse(process.argv[3]));await s.waitForJob('plate','crash');
