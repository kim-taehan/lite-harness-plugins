// UI-AUTO(Playwright MCP)가 띄운 브라우저임을 탭 아이콘으로 표시한다. 페이지 제목과 본문은 건드리지 않는다.
(() => {
  if (window.top !== window) return;
  const href =
    'data:image/svg+xml,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#2d4fd6"/><text x="32" y="44" font-size="30" font-weight="700" font-family="Arial,sans-serif" text-anchor="middle" fill="#fff">UA</text></svg>',
    );
  const apply = () => {
    if (!document.head) return;
    document.querySelectorAll('link[rel~="icon"]:not([data-ui-auto])').forEach((el) => el.remove());
    if (!document.querySelector('link[data-ui-auto]')) {
      const link = document.createElement('link');
      link.rel = 'icon';
      link.href = href;
      link.setAttribute('data-ui-auto', '');
      document.head.appendChild(link);
    }
  };
  // SPA가 head를 다시 그려도 유지한다.
  new MutationObserver(apply).observe(document, { childList: true, subtree: true });
  apply();
})();
