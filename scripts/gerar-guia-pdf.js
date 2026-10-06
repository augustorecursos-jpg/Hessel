// Gera public/guia/Guia-Hessel-Domiciliar.pdf a partir de public/guia.html.
// Uso: npm i -D playwright (ou PLAYWRIGHT_PATH=/caminho/para/playwright) e depois: node scripts/gerar-guia-pdf.js
// As imagens ficam em public/guia/img (capturas reais do sistema com dados de demonstração).
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

(async () => {
  const navegador = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const pagina = await navegador.newPage();
  await pagina.goto('file://' + path.join(__dirname, '..', 'public', 'guia.html'), { waitUntil: 'networkidle' });
  await pagina.emulateMedia({ media: 'print' });
  await pagina.evaluate(() => document.fonts.ready);
  // O conteúdo de cada .pagina precisa terminar antes do rodapé (A4 = 297 mm; rodapé a ~18 mm da borda).
  const estouros = await pagina.$$eval('.pagina', (ps) => ps.map((p, i) => {
    const topo = p.getBoundingClientRect().top;
    const limite = p.clientHeight - (p.classList.contains('capa') ? 0 : 68);
    const fundo = Math.max(...[...p.children].filter((c) => !c.classList.contains('rodape') && getComputedStyle(c).position !== 'absolute')
      .map((c) => c.getBoundingClientRect().bottom - topo));
    return { i: i + 1, sobra: Math.round(fundo - limite) };
  }).filter((x) => x.sobra > 0));
  if (estouros.length) {
    console.error('Páginas com conteúdo além da folha (px a mais):', estouros);
    process.exitCode = 1;
  }
  const destino = path.join(__dirname, '..', 'public', 'guia', 'Guia-Hessel-Domiciliar.pdf');
  await pagina.pdf({ path: destino, preferCSSPageSize: true, printBackground: true });
  await navegador.close();
  console.log('PDF gerado em', destino);
})();
