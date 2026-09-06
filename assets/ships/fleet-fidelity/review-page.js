/* Read-only asset checks and reversible control exercise in an Orca review tab.
 * Run as a development/browser-console expression, not in the game bundle.
 */
(async () => {
  const view = document.getElementById('view');
  const reference = document.getElementById('reference');
  const opacity = document.getElementById('opacity');
  const section = document.getElementById('section');
  if (!view || !reference || !opacity || !section) throw new Error('Open the historical review index.html');
  const select = (element, value) => {
    element.value = value;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const decoded = async ids => {
    for (const id of ids) {
      const image = document.getElementById(id);
      await image.decode();
      if (!image.naturalWidth || !image.complete) throw new Error(`Unloaded image: ${id}`);
    }
  };
  const original = { view: view.value, reference: reference.value, opacity: opacity.value, section: section.value };
  const views = [], sections = [], opacities = [];
  try {
    for (const option of view.options) {
      select(reference, 'before');
      select(view, option.value);
      await decoded(['authored-image', 'own-side', 'reference-image', 'ref-side']);
      if (!document.getElementById('reference-image').src.endsWith(`/before/${option.value}.png`)) throw new Error('Before control failed');
      const historical = !reference.options[1].disabled;
      if (historical) {
        select(reference, 'historical');
        await decoded(['reference-image', 'ref-side']);
        if (!document.getElementById('reference-image').src.endsWith(`/historical/${option.value}.png`)) throw new Error('Historical control failed');
      }
      views.push({ id: option.value, before: true, historical });
    }
    for (const value of ['0', '25', '75', '100']) {
      opacity.value = value;
      opacity.dispatchEvent(new Event('input', { bubbles: true }));
      const actual = Number(getComputedStyle(document.getElementById('authored-image')).opacity);
      if (actual !== Number(value) / 100) throw new Error('Opacity control failed');
      opacities.push(actual);
    }
    for (const option of section.options) {
      select(section, option.value);
      await decoded(['section-image']);
      sections.push(option.value);
    }
    const localLinks = [...new Set([...document.querySelectorAll('a[href]')].map(a => a.href).filter(href => {
      const url = new URL(href);
      return url.origin === location.origin && !url.hash && url.pathname.startsWith(location.pathname.replace(/index\.html$/, ''));
    }))];
    for (const href of localLinks) {
      const response = await fetch(href, { method: 'HEAD' });
      if (!response.ok) throw new Error(`Broken download: ${href}`);
    }
    return { title: document.title, url: location.href, checkedAt: new Date().toISOString(), views, sections, opacities, localDownloads: localLinks.length, passed: true };
  } finally {
    select(view, original.view); select(reference, original.reference); select(section, original.section);
    opacity.value = original.opacity; opacity.dispatchEvent(new Event('input', { bubbles: true }));
  }
})()
