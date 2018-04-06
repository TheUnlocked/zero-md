class ZeroMd extends HTMLElement {

  get version() { return '1.0.0'; }
  get src() { return this.getAttribute('src'); }
  get manualRender() { return this.hasAttribute('manual-render'); }
  get noShadow() { return this.hasAttribute('no-shadow'); }
  get markedUrl() { return this.getAttribute('marked-url') || 'https://cdnjs.cloudflare.com/ajax/libs/marked/0.3.17/marked.min.js'; }
  get prismUrl() { return this.getAttribute('prism-url') || 'https://cdnjs.cloudflare.com/ajax/libs/prism/1.11.0/prism.min.js'; }
  get cssUrls() {
    let attr = this.getAttribute('css-urls');
    return attr ? JSON.parse(attr) : ['https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/2.10.0/github-markdown.min.css', 'https://cdnjs.cloudflare.com/ajax/libs/prism/1.11.0/themes/prism.min.css'];
  }

  connectedCallback() {
    if (!window.ZeroMdStore) { window.ZeroMdStore = {}; }
    if (!this.manualRender) { this.render(); }
    this._fire('zero-md-ready');
  }

  _fire(eventName) {
    this.dispatchEvent(new CustomEvent(eventName, {bubbles: true, composed: true}));
  }

  _ajaxGet(url) {
    return new Promise((resolve, reject) => {
      if (!url) { reject(url); return; }
      let req = new XMLHttpRequest();
      let handler = err => {
        console.warn('[zero-md] Error getting file', url);
        reject(err);
      };
      req.open('GET', url, true);
      req.onload = () => {
        if (req.status >= 200 && req.status < 400) { resolve(req.responseText); }
        else { handler(req); }
      };
      req.onerror = err => handler(err);
      req.send();
    });
  }

  _loadScript(url, check, evt, ...attrs) {
    return new Promise((resolve, reject) => {
      if (check !== 'undefined') { resolve(); return; }
      // Handle race condition when multiple instances loaded at runtime
      if (window.ZeroMdStore.hasOwnProperty(evt)) {
        window.addEventListener(evt, function handler() {
          window.removeEventListener(evt, handler);
          resolve();
        });
      } else {
        window.ZeroMdStore[evt] = true;
        let el = document.createElement('script');
        for (let attr of attrs) el.setAttribute(attr, '');
        el.onload = () => { this._fire(evt); resolve(); };
        el.onerror = err => { console.warn('[zero-md] Error loading script', url); reject(err); };
        el.src = url;
        document.head.appendChild(el);
      }
    });
  }

  _getStylesheet(url) {
    return new Promise((resolve, reject) => {
      // Check cache if stylesheet already downloaded
      if (window.ZeroMdStore[url]) {
        if (window.ZeroMdStore[url].loaded) {
          resolve(window.ZeroMdStore[url].data);
        } else {
          window.addEventListener(url, function handler() {
            window.removeEventListener(url, handler);
            resolve(window.ZeroMdStore[url].data);
          });
        }
      } else {
        window.ZeroMdStore[url] = { loaded: false, data: '' };
        this._ajaxGet(url).then(data => {
          window.ZeroMdStore[url].data = data;
          window.ZeroMdStore[url].loaded = true;
          this._fire(url);
          resolve(data);
        }, err => reject(err));
      }
    });
  }

  _getInputs() {
    return new Promise((resolve, reject) => {
      // First try reading from light DOM template
      let tpl = this.querySelector('template') && this.querySelector('template').content.querySelector('xmp') || false;
      if (tpl) { resolve(tpl.textContent); return; }
      // Next try reading from `src` attribute
      this._ajaxGet(this.src)
        .then(data => resolve(data))
        .catch(err => reject(err));
    });
  }

  _prismHighlight(code, lang) {
    return window.Prism.highlight(code, this._detectLang(code, lang));
  }

  _detectLang(code, lang) {
    // Dead simple language detection
    if (!lang) { return code.match(/^\s*</) ? window.Prism.languages.markup : window.Prism.languages.javascript; }
    if (window.Prism.languages.hasOwnProperty(lang)) { return window.Prism.languages[lang]; }
    if (lang.substr(0, 2) === 'es') { return window.Prism.languages.javascript; }
    if (lang === 'c') { return window.Prism.langauges.clike; }
    return window.Prism.languages.markup;
  }

  _stampDom(data) {
    let nodes = this.querySelectorAll('[class^=markdown]');
    if (nodes) { nodes.forEach(node => this.removeChild(node)); }
    if (this.shadowRoot) { this.shadowRoot.innerHTML = ''; }
    if (this.noShadow) {
      this.insertAdjacentHTML('afterbegin', data);
    } else {
      let root = this.shadowRoot || this.attachShadow({mode: 'open'});
      root.innerHTML = data;
    }
  }

  _buildMd() {
    return new Promise((resolve, reject) => {
      Promise.all([this._getInputs(),
                   this._loadScript(this.markedUrl, typeof window.marked, 'zero-md-marked-ready', 'async'),
                   this._loadScript(this.prismUrl, typeof window.Prism, 'zero-md-prism-ready', 'async', 'data-manual')])
        .then(data => {
          resolve('<div class="markdown-body">' + window.marked(data[0], { highlight: this._prismHighlight.bind(this) }) + '</div>');
        }, err => { reject(err); });
    });
  }

  _buildStyles() {
    return new Promise(resolve => {
      let start = '<style class="markdown-style">:host{display:block;contain:content;}';
      let end = '</style>';
      // First try reading from light DOM template
      let tpl = this.querySelector('template') && this.querySelector('template').content.querySelector('style') || false;
      if (tpl) { resolve(start + tpl.textContent + end); return; }
      // Next try reading from css-urls
      if (Array.isArray(this.cssUrls) && this.cssUrls.length) {
        Promise.all(this.cssUrls.map(url => this._getStylesheet(url)))
          .then(data => resolve(start + data.join('') + end))
          .catch(() => resolve(start + end));
      } else {
        console.warn('[zero-md] No styles are defined');
        resolve(start + end);
      }
    });
  }

  render() {
    Promise.all([this._buildStyles(), this._buildMd()])
      .then(data => {
        this._stampDom(data[0] + data[1]);
        this._fire('zero-md-rendered');
      });
  }
}
window.customElements.define('zero-md', ZeroMd);
