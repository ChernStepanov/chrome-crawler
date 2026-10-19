'use strict';
/* updates.js — «Доступно обновление»: сверка версии с GitHub.
 * Расширение, загруженное распакованным, не может само заменить свои файлы (это право есть только у Chrome Web Store),
 * поэтому здесь только проверка и подсказка: версия в main на GitHub новее — панель показывает пилюлю и карточку
 * со ссылкой на ZIP, инструкцией и кнопкой перезапуска. Репозиторий — из homepage_url манифеста.
 * Проверка не чаще раза в CHECK_MS; ошибки сети молча пропускаются (без интернета панель работает как обычно).
 */
const Updates = (() => {
  const CHECK_MS = 6 * 3600 * 1000;

  // «0.6» < «0.6.1» < «0.7»; нечисловые хвосты игнорируются
  function newer(remote, local) {
    const a = String(remote || '').split('.').map((x) => parseInt(x, 10) || 0);
    const b = String(local || '').split('.').map((x) => parseInt(x, 10) || 0);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
    }
    return false;
  }

  // «https://github.com/owner/repo» → «owner/repo»
  function repoOf(url) {
    const m = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(String(url || ''));
    return m ? m[1] : null;
  }

  // deps: { manifest, fetch, storage: { get, set }, now }
  // → null (нет обновления / не проверить) или { version, current, repo, message, zip, page }
  async function check(deps, { force = false } = {}) {
    const repo = repoOf(deps.manifest.homepage_url);
    if (!repo) return null;
    const current = deps.manifest.version;
    const now = deps.now();
    const saved = (await deps.storage.get({ updateInfo: null })).updateInfo;
    let info = saved;
    if (force || !saved || now - saved.checkedAt > CHECK_MS) {
      try {
        const r = await deps.fetch(`https://raw.githubusercontent.com/${repo}/main/manifest.json?t=${now}`, { cache: 'no-store' });
        if (!r.ok) return fromSaved(saved, current, repo);
        const remote = await r.json();
        info = { checkedAt: now, version: String(remote.version || ''), message: '' };
        if (newer(info.version, current)) {
          // что нового — сообщение последнего коммита (необязательно: лимит API, сеть)
          try {
            const c = await deps.fetch(`https://api.github.com/repos/${repo}/commits/main`, { headers: { Accept: 'application/vnd.github+json' } });
            if (c.ok) info.message = String((await c.json()).commit?.message || '').trim().slice(0, 600);
          } catch (e) { /* без описания */ }
        }
        await deps.storage.set({ updateInfo: info });
      } catch (e) { return fromSaved(saved, current, repo); }
    }
    return fromSaved(info, current, repo);
  }
  function fromSaved(info, current, repo) {
    if (!info || !newer(info.version, current)) return null;
    return { version: info.version, current, repo, message: info.message || '',
      zip: `https://github.com/${repo}/archive/refs/heads/main.zip`, page: `https://github.com/${repo}`,
      zipUrl: `https://codeload.github.com/${repo}/zip/refs/heads/main` };   // прямой архив, без переадресации — для «Обновиться»
  }

  return { check, newer, repoOf, CHECK_MS };
})();
if (typeof module !== 'undefined') module.exports = Updates;
