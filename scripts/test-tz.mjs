import { spawnSync } from 'node:child_process';

const zones = ['UTC', 'America/Toronto', 'Asia/Kolkata', 'Australia/Lord_Howe'];
const failed = [];

for (const zone of zones) {
  console.log(`\n=== TZ=${zone} ===`);
  const run = spawnSync('npx', ['vitest', 'run'], {
    stdio: 'inherit',
    env: { ...process.env, TZ: zone },
  });
  if (run.status !== 0) failed.push(zone);
}

if (failed.length > 0) {
  console.error(`\ntest:tz failed under: ${failed.join(', ')}`);
  process.exitCode = 1;
} else {
  console.log(`\ntest:tz passed under: ${zones.join(', ')}`);
}
