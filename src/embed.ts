const XLINK = 'http://www.w3.org/1999/xlink';

export function embedSrc(url: string | null) {
  if (!url) return null;
  try {
    const src = new URL(url);
    if (src.protocol === 'https:' && src.hostname === 'earth.nullschool.net') return src.href;
  } catch {}
  let m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,})/);
  if (m) return `https://www.youtube.com/embed/${m[1]}`;
  if (/bilibili\.com/i.test(url)) {
    m = url.match(/(?:\/video\/|[?&]bvid=)(BV[\w]+)/i);
    if (m) {
      return `https://www.bilibili.com/blackboard/html5mobileplayer.html?bvid=${m[1]}&page=1&high_quality=1&danmaku=0`;
    }
  }
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
    iframe.style.cssText = 'width:100%;height:100%;border:0;background:#fff';
    if (src.startsWith('https://earth.nullschool.net/')) {
      const frame = document.createElement('div');
      frame.className = 'embed-frame';
      const fullscreen = document.createElement('button');
      fullscreen.type = 'button';
      fullscreen.className = 'embed-fullscreen';
      fullscreen.title = '全屏';
      fullscreen.setAttribute('aria-label', '全屏');
      fullscreen.innerHTML =
        '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 9V3h6v2H5v4H3zm12-6h6v6h-2V5h-4V3zM5 15v4h4v2H3v-6h2zm14 4v-4h2v6h-6v-2h4z"/></svg>';
      fullscreen.addEventListener('click', async () => {
        try {
          if (document.fullscreenElement) await document.exitFullscreen();
          else await frame.requestFullscreen();
        } catch (error) {
          console.warn('无法全屏', error);
        }
      });
      frame.append(iframe, fullscreen);
      fo.appendChild(frame);
    } else {
      fo.appendChild(iframe);
    }
    a.replaceWith(fo);
  }
}
