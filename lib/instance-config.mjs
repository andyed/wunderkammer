import path from 'node:path';
import { readFile } from 'node:fs/promises';

/** Every instance owns its config, index, thumbnails and saved view state. */
export async function loadInstanceConfig(defaultFile, args = process.argv.slice(2), env = process.env) {
  const i = args.indexOf('--config');
  if (i >= 0 && (!args[i + 1] || args[i + 1].startsWith('--'))) throw new Error('--config requires a path');
  const file = path.resolve(i >= 0 ? args[i + 1] : env.WUNDERKAMMER_CONFIG || defaultFile);
  const config = JSON.parse(await readFile(file, 'utf8'));
  const directory = path.dirname(file);
  for (const key of ['imageIndex', 'imageCache', 'viewStatePath']) {
    if (config[key]) config[key] = path.resolve(directory, config[key]);
  }
  config.viewStatePath ||= path.join(directory, 'view-state.json');
  return { config, file };
}
