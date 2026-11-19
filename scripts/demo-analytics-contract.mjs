import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

// Public ingestion-key fingerprints. clipwall-demo 87718cfd approved this
// route; rollback requires deliberately reviewing this build contract too.
const DESTINATION_KEY_SHA256 = 'd5abbc7f304d7d1dcd76b3a3716632c27a665cf1d9073dc7c7e84257a5aad398'; // Labs 526843
const LEGACY_KEY_SHA256 = '0484063e91e693cc0f1490721718e57f270065c1b9618fd1e6469c49b837fcb4'; // Consent for 673826
const sha = value => createHash('sha256').update(value).digest('hex');

export function assertDemoAnalytics(source) {
  const win = {
    URL, URLSearchParams, console,
    location: { hostname: 'andyed.github.io', search: '', hash: '' },
    navigator: { webdriver: false }, performance: { now: () => 0 },
    setTimeout() {}, clearTimeout() {}, addEventListener() {},
    document: { visibilityState: 'visible', createElement: () => ({}), head: { appendChild() {} }, addEventListener() {} },
  };
  win.window = win; win.top = win;
  // No browser, network or timers: inspect the SDK's queued init only.
  vm.runInNewContext(source.replace(/^export /gm, ''), win, { timeout: 1000 });
  const init = win.posthog?._i?.[0];
  assert.ok(init, 'Demo analytics must initialize on its production host');
  const [key, config] = init;
  assert.equal(sha(key), DESTINATION_KEY_SHA256, 'Demo build would revert the approved Labs destination');
  assert.equal(config.api_host, 'https://us.i.posthog.com');
  assert.equal(config.persistence, 'memory');
  assert.equal(config.persistence_name, 'labs_wunderkammer');
  assert.equal(config.get_device_id('build-fixture'), 'wunderkammer:build-fixture');
  assert.ok(config.consent_persistence_name.startsWith('__ph_opt_in_out_'));
  assert.equal(sha(config.consent_persistence_name.slice('__ph_opt_in_out_'.length)), LEGACY_KEY_SHA256, 'Legacy consent record changed');
  assert.equal(config.disable_session_recording, true);
  for (const name of ['autocapture', 'capture_performance', 'capture_dead_clicks', 'enable_heatmaps']) assert.equal(config[name], false, name);
  assert.equal(config.disable_surveys, true);
  assert.equal(config.disable_capture_url_hashes, true);
  assert.equal(config.mask_personal_data_properties, true);
  const event = config.before_send({ event: '$pageview', properties: {} });
  assert.equal(event.properties.app_id, 'wunderkammer');
  assert.equal(event.properties.environment, 'production');
  assert.equal(event.properties.platform, 'web');
}
