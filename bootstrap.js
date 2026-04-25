(async () => {
  const pdfjsModule = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@5.6.205/build/pdf.min.mjs');
  window.pdfjsLib = pdfjsModule;

  const scripts = ['storage.js', 'pdf-handler.js', 'ui.js', 'app.js'];
  for (const src of scripts) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.body.appendChild(script);
    });
  }
})().catch(err => {
  console.error(err);
  alert('Failed to initialize PDF viewer. Please refresh the page.');
});
