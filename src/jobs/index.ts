import type { ScheduleDef } from './queue';
import type { JobDefinition } from './runner';
import { heartbeat } from './system';

export const jobDefinitions: JobDefinition<never>[] = [heartbeat as JobDefinition<never>];

export const schedules: ScheduleDef[] = [{ name: heartbeat.name, cron: '* * * * *' }];
