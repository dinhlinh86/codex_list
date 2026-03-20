import plugin from './index.js';

const registered = [];
plugin.register({
  registerCommand(def) {
    registered.push(def);
  },
});

const command = registered.find((x) => x.name === 'codex_list');
if (!command) {
  throw new Error('codex_list command not registered');
}

const result = await command.handler({
  args: '',
  channel: 'telegram',
  config: { defaultAgent: 'main' },
});

console.log('registered commands:', registered.map((x) => x.name).join(', '));
console.log('has text:', Boolean(result?.text));
console.log('has telegram buttons:', Boolean(result?.channelData?.telegram?.buttons?.length));
console.log('preview:\n' + String(result?.text || '').split('\n').slice(0, 6).join('\n'));

if (!String(result?.text || '').includes('OpenAI Codex OAuth Profiles')) {
  throw new Error('list output missing expected heading');
}

console.log('smoke test ok');
