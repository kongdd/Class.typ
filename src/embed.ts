const XLINK = 'http://www.w3.org/1999/xlink';

export function embedSrc(url: string | null) {
  if (!url) return null;
  let m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,})/);
  if (m) return `https://www.youtube.com/embed/${m[1]}`;
  m = url.match(/bilibili\.com\/video\/(BV[\w]+)/i);
  if (m) return `https://player.bilibili.com/player.html?bvid=${m[1]}&high_quality=1`;
  if (/player\.bilibili\.com\/player\.html/.test(url)) return url;
  m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (m) return `https://player.vimeo.com/video/${m[1]}`;
  return null;
}

export function embedVideos(root: HTMLElement) {
  const svg = root.querySelector('svg');
  if (!svg) return;
  for (const a of [...svg.querySelectorAll('a')]) {
    const href = a.getAttribute('href') || a.getAttributeNS(XLINK, 'href');
    const src = embedSrc(href);
    if (!src) continue;
    const bbox = (a as unknown as SVGGraphicsElement).getBBox();
    if (bbox.width < 8 || bbox.height < 8) continue;
    const fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    fo.setAttribute('x', String(bbox.x));
    fo.setAttribute('y', String(bbox.y));
    fo.setAttribute('width', String(bbox.width));
    fo.setAttribute('height', String(bbox.height));
    const transform = a.getAttribute('transform');
    if (transform) fo.setAttribute('transform', transform);
    const iframe = document.createElementNS(
      'http://www.w3.org/1999/xhtml',
      'iframe',
    ) as HTMLIFrameElement;
    iframe.src = src;
    iframe.setAttribute('allow', 'fullscreen; encrypted-media');
    iframe.setAttribute('allowfullscreen', '');
    iframe.style.cssText = 'width:100%;height:100%;border:0;background:#111';
    fo.appendChild(iframe);
    a.replaceWith(fo);
  }
}

if (
  embedSrc('https://youtu.be/aqz-KE-bpKQ') !== 'https://www.youtube.com/embed/aqz-KE-bpKQ' ||
  embedSrc('https://www.bilibili.com/video/BV1xx411c7mD') !==
    'https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&high_quality=1'
) {
  throw new Error('embedSrc');
}
