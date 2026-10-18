// Runs inside the sandboxed deck iframe (opaque origin). Receives the deck HTML from the parent once and renders it.
(function () {
  var done = false;
  window.addEventListener('message', function (e) {
    if (done || e.source !== window.parent) return;
    var d = e.data;
    if (!d || d.type !== 'mc-deck' || typeof d.html !== 'string') return;
    done = true;
    document.open();
    document.write(d.html);
    document.close();
  });
  window.parent.postMessage({ type: 'mc-deck-ready' }, '*');
})();
